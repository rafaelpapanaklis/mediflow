// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1): registrar y anular movimientos contra una base
// REAL (createCashMovement / voidCashMovement / listExpenses).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-movimientos-integration.test.ts
//
// Requiere sql/barber_caja_completa.sql pegado en esa base local.
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberCajaError } from "@/lib/barber/commissions";
import { closeCashSession, getCashState, openCashSession } from "@/lib/barber/cash";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement, listExpenses, voidCashMovement } from "@/lib/barber/caja-movimientos";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cm${Date.now().toString(36)}`;
let skip: false | string = skipDb;
let n = 0;

async function shop(): Promise<BarberContext> {
  n += 1;
  const s = await prisma.barbershop.create({
    data: { name: `Mov ${n}`, slug: `${RUN}-${n}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: s.id, supabaseId: `${RUN}-${n}`, email: `${RUN}-${n}@test.local`, firstName: "Ana", lastName: `T${n}`, role: "OWNER" },
  });
  return { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
}

/** El error que lanza (o falla la prueba). */
async function errorOf(p: Promise<unknown>): Promise<BarberCajaError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BarberCajaError) return e;
    throw e;
  }
  assert.fail("debía fallar");
}

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  if (!(await cashMovementsReady(prisma))) skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  if (ids.length > 0 && !skip) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("monto 0, negativo, letras, vacío o con 3 decimales → 400 con mensaje claro, y no se guarda nada", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 100 });
  const casos: Array<[unknown, RegExp]> = [
    [0, /mayor que \$0/],
    ["0.00", /mayor que \$0/],
    [-5, /número/],
    ["-80", /número/],
    ["ochenta", /número/],
    ["80abc", /número/],
    ["", /Escribe el monto/],
    [null, /Escribe el monto/],
    ["1.234", /número/],
    [Number.NaN, /número/],
    ["99999999", /demasiado grande/],
  ];
  for (const [amount, msg] of casos) {
    const e = await errorOf(createCashMovement(ctx, { type: "EXPENSE", amount }));
    assert.equal(e.status, 400, `monto ${String(amount)}`);
    assert.equal(e.code, "INVALID_AMOUNT");
    assert.match(e.message, msg, `monto ${String(amount)}: ${e.message}`);
  }
  const state = await getCashState(ctx);
  assert.equal(state.open!.movements.length, 0);
  assert.equal(state.open!.expectedCash, 100);
});

test("solo el monto es obligatorio: «$1,000.50» sin categoría ni nota se guarda y baja el esperado", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 2000 });
  const r = await createCashMovement(ctx, { type: "EXPENSE", amount: "$1,000.50" });
  assert.equal(r.outsideSession, false);
  assert.equal(r.movement.amount, 1000.5);
  assert.equal(r.movement.method, "CASH");
  assert.equal(r.movement.category, null);
  assert.equal(r.movement.note, null);
  assert.match(r.movement.createdByName, /Ana/);
  const state = await getCashState(ctx);
  assert.equal(state.open!.expectedCash, 999.5);
});

test("gasto con tarjeta o transferencia se ve pero NO toca el cajón; retiro con tarjeta → 400", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 500 });
  await createCashMovement(ctx, { type: "EXPENSE", amount: 4500, method: "TRANSFER", category: "RENT", note: "Renta nov" });
  const e = await errorOf(createCashMovement(ctx, { type: "WITHDRAWAL", amount: 100, method: "CARD" }));
  assert.equal(e.status, 400);
  const bad = await errorOf(createCashMovement(ctx, { type: "EXPENSE", amount: 10, category: "Cervezas" }));
  assert.equal(bad.code, "INVALID_CATEGORY");
  const state = await getCashState(ctx);
  assert.equal(state.open!.expectedCash, 500);
  assert.equal(state.open!.resumen.expenses.total, 4500);
});

test("sin caja abierta: el gasto queda FUERA de caja (y se avisa); sacar o meter efectivo → 409", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  const r = await createCashMovement(ctx, { type: "EXPENSE", amount: 80, category: "SUPPLIES" });
  assert.equal(r.outsideSession, true);
  assert.equal(r.movement.sessionId, null);
  for (const type of ["WITHDRAWAL", "DEPOSIT"]) {
    const e = await errorOf(createCashMovement(ctx, { type, amount: 100 }));
    assert.equal(e.status, 409);
    assert.equal(e.code, "NO_OPEN_SESSION");
  }
  const gastos = await listExpenses(ctx, {});
  assert.equal(gastos.items.length, 1);
  assert.equal(gastos.resumen.total, 80);
});

test("anular: queda tachado con quién y cuándo, deja de contar; dos veces → 409; con la caja ya cerrada → 409", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 500 });
  const a = await createCashMovement(ctx, { type: "WITHDRAWAL", amount: 300 });
  const b = await createCashMovement(ctx, { type: "DEPOSIT", amount: 50 });
  const v = await voidCashMovement(ctx, a.movement.id, { reason: "me equivoqué" });
  assert.ok(v.voidedAt);
  assert.match(v.voidedByName ?? "", /Ana/);
  assert.equal(v.voidReason, "me equivoqué");
  let state = await getCashState(ctx);
  assert.equal(state.open!.expectedCash, 550, "500 + 50; el retiro anulado no cuenta");
  assert.equal(state.open!.movements.length, 2, "el anulado sigue en la lista");
  const twice = await errorOf(voidCashMovement(ctx, a.movement.id, {}));
  assert.equal(twice.code, "ALREADY_VOIDED");

  await closeCashSession(ctx, { countedAmount: 550 });
  const closed = await errorOf(voidCashMovement(ctx, b.movement.id, {}));
  assert.equal(closed.status, 409);
  assert.equal(closed.code, "SESSION_CLOSED");
  state = await getCashState(ctx);
  assert.equal(state.history[0].expectedAmount, 550);
});

test("un movimiento o barbero de OTRA barbería por id → 404 (sin tocar nada)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const a = await shop();
  const b = await shop();
  await openCashSession(a, { openingAmount: 0 });
  await openCashSession(b, { openingAmount: 0 });
  const ajeno = await createCashMovement(b, { type: "EXPENSE", amount: 10 });
  const e = await errorOf(voidCashMovement(a, ajeno.movement.id, {}));
  assert.equal(e.status, 404);
  const barberoAjeno = await prisma.barber.create({ data: { barbershopId: b.barbershopId, name: "Ajeno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } });
  const e2 = await errorOf(createCashMovement(a, { type: "BARBER_PAYOUT", amount: 100, barberId: barberoAjeno.id }));
  assert.equal(e2.status, 404);
  const e3 = await errorOf(createCashMovement(a, { type: "EXPENSE", amount: 10, receiptPath: `cash/${b.barbershopId}/2026-11/x.webp` }));
  assert.equal(e3.code, "INVALID_RECEIPT");
  const bState = await getCashState(b);
  assert.equal(bState.open!.movements[0].voidedAt, null, "el de la otra barbería sigue vivo");
});

test("pago a barbero: pide barbero; adelanto queda con su periodo; comisión/sueldo por aquí → 400 (van por Comisiones)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 1000 });
  const juan = await prisma.barber.create({ data: { barbershopId: ctx.barbershopId, name: "Juan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } });
  const sin = await errorOf(createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 200 }));
  assert.equal(sin.code, "BARBER_REQUIRED");
  for (const payoutKind of ["COMMISSION", "SALARY"]) {
    const e = await errorOf(createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 200, barberId: juan.id, payoutKind }));
    assert.equal(e.code, "USE_COMMISSIONS_PAYOUT");
  }
  const r = await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 200, barberId: juan.id });
  assert.equal(r.movement.payoutKind, "ADVANCE");
  assert.match(r.movement.periodKey ?? "", /^\d{4}-\d{2}$/);
  assert.equal(r.movement.barberName, "Juan");
  const state = await getCashState(ctx);
  assert.equal(state.open!.expectedCash, 800);
});
