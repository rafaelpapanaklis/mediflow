/**
 * GUARDIÁN · nadie decide "vencida / en trial" comparando trialEndsAt contra
 * hoy por su cuenta. La regla es UNA (src/lib/plan-status.ts) y la usan el
 * gate de /dashboard, el de /api y todas las pantallas de /admin.
 *
 * Run: npm run test:plan-status
 *
 * Por qué existe: /admin/clinics/[id] pintaba "EXPIRADO" a Menta Dental, que
 * estaba al corriente, porque calculaba `trialEndsAt < new Date()` sin mirar
 * subscriptionStatus. El barrido encontró 30 copias así por todo src/ (cada
 * una con una regla ligeramente distinta). Este test recorre src/ entero y
 * falla si aparece otra.
 *
 * Cómo caza:
 *   1. Borra comentarios (sin mover líneas) — la prosa de varios archivos
 *      menciona el patrón prohibido y daría falsos positivos.
 *   2. Busca en cada línea `trialEndsAt` comparado o restado contra
 *      now / new Date() / Date.now() / today, y los `where` de Prisma
 *      `trialEndsAt: { lt|lte|gt|gte: … }`.
 *   3. Sigue a la variable: `const d = new Date(x.trialEndsAt)` y en las 10
 *      líneas siguientes `d > now` también cuenta.
 *
 * Los archivos PERMITIDOS llevan su "porque" y un contador exacto: si alguien
 * agrega una comparación más en uno de ellos, o si desaparece una (y sobra la
 * entrada), el test lo canta para que la lista siga siendo verdad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

// ── Permitidos, con su porqué y su contador exacto ──────────────────────────
const PERMITIDOS: Array<{ ruta: string; hallazgos: number; porque: string }> = [
  {
    ruta: "src/lib/plan-status.ts",
    hallazgos: 2,
    porque: "ES la regla: isPlanExpired (trialEndsAt < now) e isInTrial (trialEndsAt > now).",
  },
  {
    ruta: "src/lib/billing/manual-subscription-lapse.ts",
    hallazgos: 2,
    porque:
      "SUB-01: caduca al pagador MANUAL (SPEI/OXXO/alta a mano), cuya suscripción se queda en 'active' " +
      "para siempre. Regla distinta A PROPÓSITO (manualPaidUntil < now), con tests propios; escribe " +
      "subscriptionStatus, no decide acceso.",
  },
  {
    ruta: "src/app/api/cron/subscription-lapse/route.ts",
    hallazgos: 1,
    porque: "repite el where de SUB-01 en el updateMany para que una clínica que pague entre el SELECT y el UPDATE no quede suspendida.",
  },
  {
    ruta: "src/lib/affiliates/stats.ts",
    hallazgos: 1,
    porque:
      "'referida activa' del programa de afiliados (funnel, niveles y comisiones): cambiarla mueve dinero. " +
      "Decisión de negocio pendiente, no un fix de pantalla.",
  },
  {
    ruta: "src/app/api/afiliados/reportes/export/route.ts",
    hallazgos: 1,
    porque: "etiqueta 'En prueba / Prueba vencida' del XLSX que descarga el afiliado; mira 4 statuses antes y la fecha solo de fallback.",
  },
  {
    ruta: "src/lib/trial.ts",
    hallazgos: 1,
    porque: "cuenta regresiva de UI (días/horas/urgencia) con `now` inyectable; quien la muestra decide con isInTrial.",
  },
  {
    ruta: "src/components/dashboard/trial-banner.tsx",
    hallazgos: 1,
    porque: "solo pinta los días que quedan; el gate es la prop isInTrial que calcula el layout con plan-status.",
  },
];

// ── Recorrido de src/ ───────────────────────────────────────────────────────
function recorrer(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (nombre === "node_modules" || nombre === ".next" || nombre === "__tests__") continue;
      recorrer(p, out);
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) && !/\.d\.ts$/.test(nombre)) {
      out.push(p);
    }
  }
  return out;
}

/** Borra comentarios sin mover líneas (los números de línea siguen valiendo). */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\"'`])\/\/[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
}

const AHORA = String.raw`(?:\bnow\b|\btoday\b|\bhoy\b|new Date\(\)|Date\.now\(\)|Date\.now\b)`;

const PATRONES: Array<{ id: string; re: RegExp }> = [
  { id: "trialEndsAt <|> now", re: new RegExp(String.raw`trialEndsAt[^\n]*?[<>]=?\s*${AHORA}`) },
  { id: "now <|> trialEndsAt", re: new RegExp(String.raw`${AHORA}\s*[<>]=?[^\n]*?trialEndsAt`) },
  { id: "trialEndsAt.getTime() - now", re: new RegExp(String.raw`trialEndsAt[^\n]*?\.getTime\(\)\s*-\s*${AHORA}`) },
  { id: "now - trialEndsAt", re: new RegExp(String.raw`${AHORA}(?:\.getTime\(\))?\s*-\s*[^\n]*?trialEndsAt`) },
  { id: "where trialEndsAt: { lt/gt }", re: /trialEndsAt\s*:\s*\{\s*(?:not\s*:\s*null\s*,\s*)?(?:lt|lte|gt|gte)\b/ },
];

/** `const d = new Date(x.trialEndsAt)` (o `= x.trialEndsAt`) → nombre de la variable. */
const ALIAS = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new Date\()?[^;\n]*?trialEndsAt\b/;

/** Llamadas a la fuente única: si la línea pasa por ellas, no es una copia. */
const FUENTE_UNICA = /\b(?:isPlanExpired|isInTrial|getPlanStatus|daysUntil|manualPaidUntil|shouldLapseManualSubscription|manualLapseWhere)\s*\(/;

interface Hallazgo { ruta: string; linea: number; patron: string; texto: string }

function buscar(ruta: string, fuente: string): Hallazgo[] {
  const lineas = sinComentarios(fuente).split("\n");
  // Una línea cuenta UNA vez aunque la cacen dos patrones (p. ej. la propia
  // regla, donde la variable se llama trialEndsAt y el alias coincide).
  const porLinea = new Map<number, Hallazgo>();
  const marcar = (i: number, patron: string) => {
    if (!porLinea.has(i + 1)) porLinea.set(i + 1, { ruta, linea: i + 1, patron, texto: lineas[i].trim() });
  };
  lineas.forEach((linea, i) => {
    if (FUENTE_UNICA.test(linea)) return;
    for (const { id, re } of PATRONES) {
      if (re.test(linea)) {
        marcar(i, id);
        break;
      }
    }
    // Alias: la fecha se guarda en una variable y se compara unas líneas después.
    const alias = ALIAS.exec(linea);
    if (alias && alias[1] !== "trialEndsAt") {
      const v = alias[1].replace(/\$/g, "\\$");
      const cmp = new RegExp(String.raw`(?:\b${v}\b(?:\.getTime\(\))?\s*[<>]=?\s*${AHORA}|${AHORA}\s*[<>]=?\s*\b${v}\b|\b${v}\b\.getTime\(\)\s*-\s*${AHORA}|${AHORA}(?:\.getTime\(\))?\s*-\s*\b${v}\b)`);
      for (let j = i + 1; j <= Math.min(i + 10, lineas.length - 1); j++) {
        if (FUENTE_UNICA.test(lineas[j])) continue;
        if (cmp.test(lineas[j])) {
          marcar(j, `alias ${alias[1]} <|> now`);
          break;
        }
      }
    }
  });
  return Array.from(porLinea.values()).sort((a, b) => a.linea - b.linea);
}

const archivos = recorrer(SRC);
const hallazgosPorRuta = new Map<string, Hallazgo[]>();
for (const abs of archivos) {
  const ruta = relative(process.cwd(), abs).split("\\").join("/");
  const h = buscar(ruta, readFileSync(abs, "utf8"));
  if (h.length) hallazgosPorRuta.set(ruta, h);
}

test("el barrido recorre src/ de verdad", () => {
  assert.ok(archivos.length > 500, `solo ${archivos.length} archivos: revisa la ruta`);
  assert.ok(hallazgosPorRuta.has("src/lib/plan-status.ts"), "la fuente única tiene que aparecer (si no, el barrido está roto)");
});

test("ningún archivo compara trialEndsAt contra hoy por su cuenta (fuera de los permitidos)", () => {
  const permitidos = new Set(PERMITIDOS.map((p) => p.ruta));
  const culpables: string[] = [];
  // Array.from y no for-of sobre el Map: el target de tsconfig no itera Maps.
  for (const [ruta, hs] of Array.from(hallazgosPorRuta.entries())) {
    if (permitidos.has(ruta)) continue;
    for (const h of hs) culpables.push(`  ${h.ruta}:${h.linea}  [${h.patron}]  ${h.texto}`);
  }
  assert.equal(
    culpables.length,
    0,
    "Copias a ojo de la regla de vencimiento. Usa isPlanExpired / isInTrial / getPlanStatus / daysUntil " +
      "(src/lib/plan-status.ts) o, si de verdad es otra regla, agrégala a PERMITIDOS con su porqué:\n" +
      culpables.join("\n"),
  );
});

test("los permitidos siguen siendo exactamente los declarados (contador)", () => {
  for (const p of PERMITIDOS) {
    assert.ok(existsSync(join(process.cwd(), p.ruta)), `${p.ruta} ya no existe: quita la entrada`);
    const hs = hallazgosPorRuta.get(p.ruta) ?? [];
    assert.equal(
      hs.length,
      p.hallazgos,
      `${p.ruta}: se esperaban ${p.hallazgos} comparaciones y hay ${hs.length}. ` +
        `Si agregaste una, no: usa plan-status. Si quitaste una, baja el contador.\n` +
        hs.map((h) => `  :${h.linea} [${h.patron}] ${h.texto}`).join("\n"),
    );
  }
});

// ── /admin: la misma insignia y la misma regla, no una copia ────────────────
const ADMIN_CON_ESTADO = [
  { ruta: "src/app/admin/page.tsx", insignia: true },
  { ruta: "src/app/admin/clinics/clinics-client.tsx", insignia: true },
  { ruta: "src/app/admin/clinics/[id]/clinic-detail-client.tsx", insignia: true },
  { ruta: "src/app/admin/payments/page.tsx", insignia: false },
  { ruta: "src/app/admin/churn/page.tsx", insignia: false },
  { ruta: "src/app/api/admin/billing/route.ts", insignia: false },
  { ruta: "src/app/api/admin/reports/route.ts", insignia: false },
  { ruta: "src/lib/admin/clientes.ts", insignia: false },
];

test("cada pantalla de /admin que muestra o cuenta el estado de plan usa plan-status", () => {
  for (const { ruta, insignia } of ADMIN_CON_ESTADO) {
    const fuente = readFileSync(join(process.cwd(), ruta), "utf8");
    assert.match(
      fuente,
      /from "@\/lib\/plan-status"|from "@\/components\/admin\/plan-status-badge"/,
      `${ruta}: no importa la fuente única`,
    );
    if (insignia) {
      assert.match(fuente, /<PlanStatusBadge\b/, `${ruta}: debe pintar el estado con <PlanStatusBadge/>`);
    }
    const limpio = sinComentarios(fuente);
    assert.doesNotMatch(limpio, />\s*(?:Expirado|Trial expirado|Sin plan|Sin trial)\s*</, `${ruta}: insignia de estado escrita a mano`);
  }
});

// ── Escritores: quien mueve nextBillingDate mueve también trialEndsAt ───────
test("todo prisma.clinic.update/updateMany/upsert que escribe nextBillingDate escribe también trialEndsAt", () => {
  const faltantes: string[] = [];
  for (const abs of archivos) {
    const ruta = relative(process.cwd(), abs).split("\\").join("/");
    const fuente = sinComentarios(readFileSync(abs, "utf8"));
    const re = /prisma\.clinic\.(?:update|updateMany|upsert)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fuente)) !== null) {
      const fin = fuente.indexOf("});", m.index);
      const bloque = fuente.slice(m.index, fin > 0 ? fin : m.index + 1500);
      if (!/\bnextBillingDate\s*:/.test(bloque)) continue;
      const bien = /\btrialEndsAt\s*:/.test(bloque) || /\.\.\.(?:subscriptionPeriodFields|manualPeriodFields)\(/.test(bloque);
      if (!bien) {
        const linea = fuente.slice(0, m.index).split("\n").length;
        faltantes.push(`  ${ruta}:${linea}`);
      }
    }
  }
  assert.equal(
    faltantes.length,
    0,
    "Escriben nextBillingDate sin mover trialEndsAt (el 'acceso hasta' del gate). Usa subscriptionPeriodFields " +
      "(eventos de Stripe) o manualPeriodFields (activaciones a mano):\n" + faltantes.join("\n"),
  );
});

test("hay escritores con las dos fechas (si no, el test de arriba no está viendo nada)", () => {
  const webhook = sinComentarios(readFileSync(join(process.cwd(), "src/app/api/webhooks/stripe/route.ts"), "utf8"));
  assert.match(webhook, /const periodFields = subscriptionPeriodFields\(sub\);/);
  assert.match(webhook, /\.\.\.periodFields,/);
  assert.match(webhook, /trialEndsAt:\s*next,\s*\r?\n\s*nextBillingDate:\s*next,/);
  const admin = sinComentarios(readFileSync(join(process.cwd(), "src/app/api/admin/billing/route.ts"), "utf8"));
  assert.equal((admin.match(/\.\.\.manualPeriodFields\(/g) ?? []).length, 2, "verify_payment y activate_clinic");
  const subs = sinComentarios(readFileSync(join(process.cwd(), "src/app/api/admin/subscriptions/route.ts"), "utf8"));
  assert.match(subs, /\.\.\.manualPeriodFields\(/);
});
