// Integración contra Postgres REAL de la ola [Barber Deuda Técnica]: las
// tablas y columnas que nacieron en sql/barber_*.sql ya están en el schema y
// se leen con el cliente Prisma — y la RED DE SEGURIDAD sigue: con la tabla
// o la columna ausentes, cada pantalla cae a sus valores por defecto, lo
// avisa (storageReady / persisted = false) y guardar dice qué falta, en vez
// de tronar.
//
//   docker run -d --name barber-deuda-pg -e POSTGRES_PASSWORD=x -e POSTGRES_DB=x \
//     -p 54331:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:x@localhost:54331/x \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
//     src/lib/barber/__tests__/deuda-tecnica-integration.test.ts
//
// Sin DATABASE_URL se SALTAN (no fallan). JAMÁS apuntarlas a producción:
// tiran y vuelven a crear tablas y columnas de barber_shops.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberBotStorageError, getBarberBotSettings, saveBarberBotSettings } from "../bot";
import {
  BarberPaymentsError,
  clearBarberPaymentSettingsCache,
  getBarberPaymentSettings,
  saveBarberDepositPolicy,
} from "../payments";
import { listBarberAdminActions } from "../admin";
import { BARBER_CLIENTS_CONFIG_DEFAULTS, getBarberClientsConfig, saveBarberClientsConfig } from "../clients";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const MIGRACION = "prisma/migrations/20260825120000_barber_deuda_tecnica_tablas_sql/migration.sql";
const RUN = `dt${Date.now().toString(36)}`;

const TABLAS = [
  "barber_payment_settings",
  "barber_admin_actions",
  "barber_bot_settings",
  "barber_bot_usage",
  "barber_bot_pauses",
];
const COLUMNAS = [
  "loyaltyEnabled",
  "loyaltyThreshold",
  "loyaltyReward",
  "inactiveDays",
  "campaignCooldownDays",
  "campaignTemplates",
  "bookingPolicy",
];

/**
 * Parte un .sql en sentencias respetando los bloques dollar-quoted
 * ($tag$ … $tag$), que llevan ";" adentro. Quita las líneas de comentario.
 * (Misma receta que ajustes-integration.test.ts.)
 */
function splitSql(text: string): string[] {
  const sinComentarios = text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let buf = "";
  let tag: string | null = null;
  for (let i = 0; i < sinComentarios.length; i++) {
    const ch = sinComentarios[i];
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sinComentarios.slice(i));
      if (m) {
        if (tag === null) tag = m[0];
        else if (tag === m[0]) tag = null;
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (ch === ";" && tag === null) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Aplica la migración sentencia por sentencia (como lo haría el editor SQL). */
async function aplicarMigracion(): Promise<void> {
  for (const statement of splitSql(readFileSync(MIGRACION, "utf8"))) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function nuevaBarberia(sufijo: string): Promise<string> {
  const row = await prisma.barbershop.create({
    data: { name: `Deuda ${sufijo}`, slug: `${RUN}-${sufijo}` },
    select: { id: true },
  });
  return row.id;
}

async function tablaExiste(nombre: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ${nombre}) AS ok
  `;
  return rows[0]?.ok === true;
}

async function columnasPresentes(): Promise<string[]> {
  const all = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'barber_shops'
  `;
  return all.map((r) => r.column_name).filter((c) => COLUMNAS.includes(c)).sort();
}

let shopA = "";

before(async () => {
  if (!HAS_DB) return;
  await aplicarMigracion();
  shopA = await nuevaBarberia("a");
});

after(async () => {
  if (!HAS_DB) return;
  // Pase lo que pase, la base queda alineada con el schema para el siguiente.
  await aplicarMigracion().catch(() => {});
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════
// 1. La migración no hace NADA donde ya existe todo, y crea lo que falta.
// ═══════════════════════════════════════════════════════════════════════

test("la migración es idempotente: aplicarla dos veces deja las 5 tablas y las 7 columnas", { skip }, async () => {
  await aplicarMigracion(); // segunda pasada sobre una base que ya lo tiene todo
  for (const t of TABLAS) assert.equal(await tablaExiste(t), true, `falta la tabla ${t}`);
  assert.deepEqual(await columnasPresentes(), [...COLUMNAS].sort());
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Bot: con tabla guarda y lee; sin tabla cae a APAGADO y lo dice.
// ═══════════════════════════════════════════════════════════════════════

test("bot: sin barber_bot_settings el bot está apagado, storageReady=false y guardar dice qué falta", { skip }, async () => {
  await saveBarberBotSettings(shopA, { enabled: true, aiDailyCapMxn: 30 });
  const con = await getBarberBotSettings(shopA);
  assert.equal(con.storageReady, true);
  assert.equal(con.settings.enabled, true);

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "barber_bot_settings"`);
  const shopB = await nuevaBarberia("bot-sin-tabla"); // id nuevo = sin caché
  const sin = await getBarberBotSettings(shopB);
  assert.equal(sin.storageReady, false, "avisa que falta la tabla");
  assert.equal(sin.settings.enabled, false, "sin almacenamiento el bot NO contesta a ciegas");
  await assert.rejects(
    () => saveBarberBotSettings(shopB, { enabled: true }),
    (e: unknown) => e instanceof BarberBotStorageError && /sql\/barber_bot\.sql/.test((e as Error).message),
  );

  await aplicarMigracion();
  await saveBarberBotSettings(shopB, { enabled: true });
  const otraVez = await getBarberBotSettings(shopB);
  assert.equal(otraVez.storageReady, true);
  assert.equal(otraVez.settings.enabled, true);
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Anticipos: sin tabla, política por defecto y aviso; con tabla, guarda.
// ═══════════════════════════════════════════════════════════════════════

test("anticipos: sin barber_payment_settings cae a la política por defecto y avisa", { skip }, async () => {
  const policy = await saveBarberDepositPolicy(shopA, { enabled: true, mode: "FIXED", fixed: 150 });
  assert.equal(policy.enabled, true);
  clearBarberPaymentSettingsCache();
  const con = await getBarberPaymentSettings(shopA);
  assert.equal(con.storageReady, true);
  assert.equal(con.policy.enabled, true);

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "barber_payment_settings"`);
  clearBarberPaymentSettingsCache();
  const sin = await getBarberPaymentSettings(shopA);
  assert.equal(sin.storageReady, false, "avisa que falta la tabla");
  assert.equal(sin.policy.enabled, false, "sin tabla no se pide anticipo a nadie");
  await assert.rejects(
    () => saveBarberDepositPolicy(shopA, { enabled: true }),
    (e: unknown) => e instanceof BarberPaymentsError && e.code === "SETTINGS_STORAGE_MISSING" && e.status === 503,
  );

  await aplicarMigracion();
  clearBarberPaymentSettingsCache();
  await saveBarberDepositPolicy(shopA, { enabled: true, mode: "FIXED", fixed: 150 });
  const otraVez = await getBarberPaymentSettings(shopA);
  assert.equal(otraVez.storageReady, true);
  assert.equal(otraVez.policy.enabled, true);
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Bitácora del admin: sin tabla la ficha recibe null (y avisa).
// ═══════════════════════════════════════════════════════════════════════

test("admin: sin barber_admin_actions la bitácora es null; con tabla, lista", { skip }, async () => {
  assert.deepEqual(await listBarberAdminActions(shopA), [], "tabla presente, sin filas");
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS barber_admin_actions`);
  assert.equal(await listBarberAdminActions(shopA), null, "sin tabla: null = la ficha avisa");
  await aplicarMigracion();
  assert.deepEqual(await listBarberAdminActions(shopA), []);
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Columnas de barber_shops (ÚLTIMA: la memoria por proceso de
//    clients.ts recuerda "faltan columnas" hasta reiniciar el runtime).
// ═══════════════════════════════════════════════════════════════════════

test("clientes: sin las columnas de fidelidad cae a 10 cortes / 60 días y guardar dice sql_pendiente", { skip }, async () => {
  const ctx = { barbershopId: shopA } as unknown as BarberContext;

  const con = await getBarberClientsConfig(ctx);
  assert.equal(con.persisted, true, "columnas presentes");
  const guardado = await saveBarberClientsConfig(ctx, { loyaltyThreshold: 7 });
  assert.equal(guardado.ok, true);
  assert.equal((await getBarberClientsConfig(ctx)).loyaltyThreshold, 7);

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "barber_shops"
       DROP COLUMN IF EXISTS "loyaltyEnabled",
       DROP COLUMN IF EXISTS "loyaltyThreshold",
       DROP COLUMN IF EXISTS "loyaltyReward",
       DROP COLUMN IF EXISTS "inactiveDays"`,
  );
  const sin = await getBarberClientsConfig(ctx);
  assert.equal(sin.persisted, false, "avisa que faltan las columnas");
  assert.equal(sin.loyaltyThreshold, BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyThreshold);
  assert.equal(sin.inactiveDays, BARBER_CLIENTS_CONFIG_DEFAULTS.inactiveDays);
  const intento = await saveBarberClientsConfig(ctx, { loyaltyThreshold: 5 });
  assert.equal(intento.ok, false);
  assert.equal(intento.reason, "sql_pendiente");

  // Se restauran (con sus CHECK) para quien venga después.
  await aplicarMigracion();
  assert.deepEqual(await columnasPresentes(), [...COLUMNAS].sort());
});
