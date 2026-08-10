// MIGRACIÓN DE DATOS — el % de un vendedor pasa a ser el % DE LA COMISIÓN DEL
// PADRE (0-100) en vez de un trozo del % del nivel del padre.
//
//     nuevoPct = round(viejoPct / nivelDelPadre × 100)      clamp [0, 100]
//
// Un vendedor al 5 % con un padre en Bronce (10 %) cobraba la MITAD de la
// comisión; tras la conversión queda en 50 y cobra exactamente lo mismo. Sin
// esta conversión pasaría a cobrar el 5 % — dinero prometido que se evapora.
//
// Convierte los DOS lugares donde vive el número:
//   · affiliate_sellers.commissionPct            (la asignación vigente)
//   · affiliate_seller_attributions.sellerPct    (el CONGELADO por clínica —
//     éste es el que decide lo que se paga en cada factura)
//
// NO toca el esquema: ni un ALTER, ni una tabla nueva. Sólo UPDATE de dos
// columnas que ya existen.
//
// Uso (PowerShell):
//   $env:DATABASE_URL = "postgresql://..."
//   npx tsx scripts/migrate-seller-share-pct.mts                  ← informe, no escribe
//   npx tsx scripts/migrate-seller-share-pct.mts --apply --token=<token>
//
// IDEMPOTENCIA sin tabla de control, con DOS candados:
//   1. TOKEN — el informe imprime una huella del estado exacto de las filas a
//      convertir. `--apply` sólo escribe si el estado sigue siendo ese; en
//      cuanto la conversión se aplica el token deja de casar, así que un
//      segundo `--apply` con el mismo token se RECHAZA.
//   2. DETECTOR DE "ya convertido" — bajo el significado viejo ningún % podía
//      superar el nivel del padre, así que si alguna fila ya trae un % por
//      encima del nivel más alto del programa, `--apply` se NIEGA aunque el
//      token case (es lo que pasaría al re-correr el informe DESPUÉS de la
//      conversión y copiar el token nuevo). Sólo `--force` lo salta.

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const db = new PrismaClient();

// Espejo de DEFAULT_PROGRAM_CONFIG (@/lib/affiliate-levels), duplicado a
// propósito: un script suelto no debe arrastrar los alias de Next.
const DEFAULT_PROGRAM_CONFIG = {
  bronzePct: 10,
  silverPct: 12,
  goldPct: 15,
  silverMinActive: 3,
  goldMinActive: 10,
};

const SHARE_MAX = 100;

type ProgramConfig = typeof DEFAULT_PROGRAM_CONFIG;

function levelOf(activeCount: number, cfg: ProgramConfig): "bronze" | "silver" | "gold" {
  if (activeCount >= cfg.goldMinActive) return "gold";
  if (activeCount >= cfg.silverMinActive) return "silver";
  return "bronze";
}

function pctOfLevel(level: "bronze" | "silver" | "gold", cfg: ProgramConfig): number {
  return level === "gold" ? cfg.goldPct : level === "silver" ? cfg.silverPct : cfg.bronzePct;
}

interface Change {
  table: "affiliate_sellers" | "affiliate_seller_attributions";
  id: string;
  who: string; // nombre del vendedor (o su id) para el informe
  affiliateName: string;
  level: string;
  levelPct: number;
  oldPct: number;
  newPct: number;
  /** % de la comisión que cobraba ANTES (viejo/nivel × 100), sin redondear. */
  exactPct: number;
  /** Puntos de comisión que se mueven por el redondeo. */
  driftPp: number;
  /** El % viejo superaba el nivel vigente ⇒ el padre cambió de nivel. */
  overLevel: boolean;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const tokenArg = process.argv.find((a) => a.startsWith("--token="))?.slice("--token=".length) ?? "";

  // ── 1. Config de niveles. Si la tabla no está (programa legacy), el "nivel"
  //      de cada padre es su Affiliate.commissionPct — el mismo respaldo que
  //      usaba currentParentLevelPct() antes de esta ola.
  let cfg: ProgramConfig | null = null;
  try {
    const row = await db.affiliateProgramConfig.findUnique({ where: { id: 1 } });
    cfg = row
      ? {
          bronzePct: row.bronzePct,
          silverPct: row.silverPct,
          goldPct: row.goldPct,
          silverMinActive: row.silverMinActive,
          goldMinActive: row.goldMinActive,
        }
      : DEFAULT_PROGRAM_CONFIG;
  } catch {
    cfg = null; // tabla inexistente → modo legacy
  }
  console.log(
    cfg
      ? `[config] niveles bronce ${cfg.bronzePct}% · plata ${cfg.silverPct}% · oro ${cfg.goldPct}%`
      : "[config] affiliate_program_config no existe → nivel = Affiliate.commissionPct (legacy)",
  );

  // ── 2. Filas a convertir.
  let sellers: { id: string; affiliateId: string; name: string; commissionPct: number }[] = [];
  let attributions: { id: string; affiliateId: string; sellerId: string; clinicId: string; sellerPct: number }[] = [];
  try {
    sellers = await db.affiliateSeller.findMany({
      select: { id: true, affiliateId: true, name: true, commissionPct: true },
      orderBy: { id: "asc" },
    });
    attributions = await db.affiliateSellerAttribution.findMany({
      select: { id: true, affiliateId: true, sellerId: true, clinicId: true, sellerPct: true },
      orderBy: { id: "asc" },
    });
  } catch (err: any) {
    if (err?.code === "P2021") {
      console.log("\nLas tablas de equipos (affiliate_seller_*) no existen en esta BD.");
      console.log("NO HAY NADA QUE CONVERTIR.");
      return;
    }
    throw err;
  }

  if (sellers.length === 0 && attributions.length === 0) {
    console.log("\nNo hay ni un vendedor ni una atribución en esta BD.");
    console.log("NO HAY NADA QUE CONVERTIR: el significado nuevo aplica desde la primera alta.");
    return;
  }

  // ── 3. Nivel vigente de cada padre involucrado.
  const affiliateIds = Array.from(
    new Set([...sellers.map((s) => s.affiliateId), ...attributions.map((a) => a.affiliateId)]),
  );
  const affiliates = await db.affiliate.findMany({
    where: { id: { in: affiliateIds } },
    select: { id: true, name: true, commissionPct: true },
  });
  const affById = new Map(affiliates.map((a) => [a.id, a]));

  const levelById = new Map<string, { level: string; pct: number }>();
  for (const id of affiliateIds) {
    const aff = affById.get(id);
    if (!cfg) {
      levelById.set(id, { level: "legacy", pct: aff?.commissionPct ?? 0 });
      continue;
    }
    const activeCount = await db.clinic.count({ where: { affiliateId: id, subscriptionStatus: "active" } });
    const level = levelOf(activeCount, cfg);
    levelById.set(id, { level: `${level} (${activeCount} activas)`, pct: pctOfLevel(level, cfg) });
  }

  // ── 4. Conversión.
  const changes: Change[] = [];
  const skipped: string[] = [];

  function plan(
    table: Change["table"],
    id: string,
    affiliateId: string,
    who: string,
    oldPct: number,
  ) {
    const lvl = levelById.get(affiliateId);
    const levelPct = lvl?.pct ?? 0;
    const affiliateName = affById.get(affiliateId)?.name ?? affiliateId;

    if (!Number.isFinite(oldPct) || oldPct <= 0) {
      skipped.push(`${table} ${id} (${who}): % = ${oldPct} → sin conversión (0 sigue siendo 0)`);
      return;
    }
    if (!Number.isFinite(levelPct) || levelPct <= 0) {
      skipped.push(
        `${table} ${id} (${who}): el padre "${affiliateName}" no tiene % de nivel utilizable ` +
          `(${levelPct}) → NO se convierte; revisar a mano`,
      );
      return;
    }

    const exactPct = (oldPct / levelPct) * 100;
    const newPct = Math.min(SHARE_MAX, Math.max(0, Math.round(exactPct)));
    changes.push({
      table,
      id,
      who,
      affiliateName,
      level: lvl?.level ?? "?",
      levelPct,
      oldPct,
      newPct,
      exactPct,
      driftPp: newPct - exactPct,
      overLevel: oldPct > levelPct,
    });
  }

  const sellerNameById = new Map(sellers.map((s) => [s.id, s.name]));
  for (const s of sellers) plan("affiliate_sellers", s.id, s.affiliateId, s.name, s.commissionPct);
  for (const a of attributions) {
    plan(
      "affiliate_seller_attributions",
      a.id,
      a.affiliateId,
      `${sellerNameById.get(a.sellerId) ?? a.sellerId} · clínica ${a.clinicId}`,
      a.sellerPct,
    );
  }

  // ── 5. Informe.
  console.log(
    `\n[filas] ${sellers.length} vendedor(es) · ${attributions.length} atribución(es) congelada(s)`,
  );
  console.log(`[convertibles] ${changes.length} · [sin conversión] ${skipped.length}`);

  if (changes.length > 0) {
    console.log("\n  tabla                          | quién                          | nivel   | viejo → nuevo");
    console.log("  ".padEnd(2) + "-".repeat(104));
    for (const c of changes) {
      console.log(
        `  ${c.table.padEnd(30)} | ${c.who.slice(0, 30).padEnd(30)} | ${String(c.levelPct).padEnd(7)} | ` +
          `${fmt(c.oldPct)}% → ${c.newPct}%${Math.abs(c.driftPp) > 0.0001 ? `  (exacto ${fmt(c.exactPct)}%, ajuste ${c.driftPp > 0 ? "+" : ""}${c.driftPp.toFixed(2)} pp)` : ""}`,
      );
    }
  }

  // Casos dudosos: si el padre ya no está en el nivel que tenía al asignar el %,
  // el denominador de la conversión no es el que se usó entonces. En modo legacy
  // no hay niveles que se muevan (el denominador es su commissionPct fijo), así
  // que ahí sólo cuenta `overLevel`.
  const dudosos = changes.filter((c) => c.overLevel || (cfg != null && !c.level.startsWith("bronze")));
  if (dudosos.length > 0) {
    console.log("\n⚠ CASOS DUDOSOS (el padre pudo cambiar de nivel desde que asignó el %):");
    for (const c of dudosos) {
      console.log(
        `  · ${c.table} ${c.id} — ${c.who} · padre "${c.affiliateName}" hoy en ${c.level} (${c.levelPct}%)` +
          (c.overLevel ? ` · el % viejo (${fmt(c.oldPct)}) SUPERA su nivel: bajó de nivel, revisar a mano` : ""),
      );
    }
  }
  if (skipped.length > 0) {
    console.log("\n[sin conversión]");
    for (const s of skipped) console.log(`  · ${s}`);
  }

  // Señal de "esto ya se convirtió": bajo el significado viejo ningún % podía
  // superar el nivel del padre (el endpoint lo clampaba), así que un valor por
  // encima del nivel más alto del programa ya es un % de comisión.
  const topLevel = cfg ? Math.max(cfg.bronzePct, cfg.silverPct, cfg.goldPct) : 100;
  const yaConvertidas = changes.filter((c) => c.oldPct > topLevel);
  if (yaConvertidas.length > 0) {
    console.log(
      `\n⚠ ${yaConvertidas.length} fila(s) ya traen un % por ENCIMA del nivel más alto (${topLevel}%): ` +
        "parece que la conversión ya se aplicó. Revisar antes de escribir nada.",
    );
  }

  if (changes.length === 0) {
    console.log("\nNO HAY NADA QUE CONVERTIR.");
    return;
  }

  // ── 6. Token = huella del estado exacto que este informe acaba de leer.
  const token = createHash("sha256")
    .update(changes.map((c) => `${c.table}:${c.id}:${c.oldPct}:${c.newPct}`).join("|"))
    .digest("hex")
    .slice(0, 16);

  if (!apply) {
    console.log("\n────────────────────────────────────────────────────────────");
    console.log("INFORME (no se escribió nada). Para aplicar EXACTAMENTE esto:");
    console.log(`\n  npx tsx scripts/migrate-seller-share-pct.mts --apply --token=${token}\n`);
    console.log("El token caduca en cuanto los datos cambien: es lo que impide");
    console.log("convertir dos veces las mismas filas.");
    if (yaConvertidas.length > 0) {
      console.log("\n⚠ Con el aviso de arriba, ese comando se NEGARÁ a escribir:");
      console.log("  la conversión parece hecha ya. Revísalo antes de nada.");
    }
    return;
  }

  // Candado 2: no re-convertir lo ya convertido aunque el token case.
  if (yaConvertidas.length > 0 && !force) {
    console.error("\n✖ PARECE QUE LA CONVERSIÓN YA SE APLICÓ — no se escribió nada.");
    console.error(
      `  ${yaConvertidas.length} fila(s) traen un % por encima del nivel más alto (${topLevel}%),\n` +
        "  algo imposible con el significado viejo. Volver a convertirlas dividiría\n" +
        "  otra vez entre el nivel y dispararía los porcentajes.",
    );
    console.error("\n  Si de verdad hace falta escribir, añade --force al comando.");
    process.exitCode = 1;
    return;
  }

  if (tokenArg !== token) {
    console.error("\n✖ TOKEN QUE NO CASA — no se escribió nada.");
    console.error(`  recibido: ${tokenArg || "(ninguno)"}`);
    console.error(`  esperado: ${token}`);
    console.error(
      "\n  O los datos cambiaron desde el informe, o la conversión YA se aplicó.\n" +
        "  Corre el script sin --apply, revisa el informe y usa el token nuevo.",
    );
    process.exitCode = 1;
    return;
  }

  // ── 7. Escritura, todo o nada.
  await db.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.table === "affiliate_sellers") {
        await tx.affiliateSeller.update({ where: { id: c.id }, data: { commissionPct: c.newPct } });
      } else {
        await tx.affiliateSellerAttribution.update({ where: { id: c.id }, data: { sellerPct: c.newPct } });
      }
    }
  });

  const porTabla = {
    affiliate_sellers: changes.filter((c) => c.table === "affiliate_sellers").length,
    affiliate_seller_attributions: changes.filter((c) => c.table === "affiliate_seller_attributions").length,
  };
  console.log(
    `\n✔ CONVERTIDAS ${changes.length} fila(s): ` +
      `${porTabla.affiliate_sellers} en affiliate_sellers · ` +
      `${porTabla.affiliate_seller_attributions} en affiliate_seller_attributions.`,
  );
  if (dudosos.length > 0) {
    console.log(`⚠ ${dudosos.length} quedaron APROXIMADAS (ver casos dudosos arriba) — revisar a mano.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
