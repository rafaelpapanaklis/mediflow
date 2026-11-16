// ═══════════════════════════════════════════════════════════════════════
// Revisión ws6-t8 (N4): si el SQL de caja completa se QUITA con el proceso
// corriendo, la caché de cashMovementsReady se olvida en vez de dar 500
// hasta reiniciar.
//
// ⚠️ CÓRRELA SOLA: renombra "barber_cash_movements" durante la prueba (y la
// devuelve al final). Otra suite corriendo a la vez contra la misma base
// vería la tabla desaparecer.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-sql-quitado-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberCajaError } from "@/lib/barber/commissions";
import { getCashState, moneyErrorResponse, openCashSession } from "@/lib/barber/cash";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement } from "@/lib/barber/caja-movimientos";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cq${Date.now().toString(36)}`;
const APARTE = `barber_cash_movements_${RUN}`;
let skip: false | string = skipDb;
let renombrada = false;
let ctx: BarberContext;

async function quitar() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_cash_movements" RENAME TO "${APARTE}"`);
  renombrada = true;
}
async function devolver() {
  if (!renombrada) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "${APARTE}" RENAME TO "barber_cash_movements"`);
  renombrada = false;
}

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  if (!(await cashMovementsReady(prisma))) {
    skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
    return;
  }
  const s = await prisma.barbershop.create({ data: { name: "Quitado", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" } });
  const user = await prisma.barberUser.create({ data: { barbershopId: s.id, supabaseId: `${RUN}-o`, email: `${RUN}@test.local`, firstName: "Q", lastName: "Q", role: "OWNER" } });
  ctx = { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
  await openCashSession(ctx, { openingAmount: 500 });
  await createCashMovement(ctx, { type: "EXPENSE", amount: 80 });
});

after(async () => {
  if (!HAS_DB) return;
  await devolver();
  if (!skip) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" IN (SELECT "id" FROM "barber_shops" WHERE "slug" LIKE ${`${RUN}-%`})`;
  await prisma.barberCashSession.deleteMany({ where: { barbershop: { slug: { startsWith: RUN } } } });
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.$disconnect();
});

test("con la tabla quitada a media marcha: la caja se ve como antes (sin 500) y registrar dice 409", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  assert.equal((await getCashState(ctx)).open!.expectedCash, 420, "con el SQL: 500 − 80");
  await quitar();
  // La caché decía «sí está»: la lectura falla, olvida y se repite ya sin el SQL.
  const state = await getCashState(ctx);
  assert.equal(state.movementsReady, false);
  assert.equal(state.open!.expectedCash, 500, "como antes de pegar el SQL");
  const e = await createCashMovement(ctx, { type: "EXPENSE", amount: 10 }).catch((x) => x);
  assert.ok(e instanceof BarberCajaError && e.code === "CAJA_SQL_PENDING", String(e));
});

test("un error de la tabla quitada que llega a una API sale 409 CAJA_SQL_PENDING, no 500", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  await devolver();
  resetCashMovementsReadyCache();
  assert.equal(await cashMovementsReady(prisma), true, "vuelve a estar y la caché lo ve");
  await quitar();
  const err = await prisma.$queryRawUnsafe(`SELECT 1 FROM "barber_cash_movements"`).catch((x) => x);
  const res = moneyErrorResponse(err);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "CAJA_SQL_PENDING");
  assert.equal(await cashMovementsReady(prisma), false, "la caché se olvidó: ya no dice «sí está»");
  await devolver();
  resetCashMovementsReadyCache();
  assert.equal(await cashMovementsReady(prisma), true);
});
