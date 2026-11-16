// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1), punto 5: pagos a barberos SIN duplicar, contra
// una base REAL. Comisión y sueldo se pagan con el MISMO «Marcar pagado»
// (markCommissionsPaid); «sale de la caja» crea su movimiento en la misma
// transacción. Los adelantos se ven en Comisiones.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-pagos-barberos-integration.test.ts
// Requiere sql/barber_caja_completa.sql (y sql/barber_sueldo.sql para el caso de sueldo).
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BarberCajaError, currentPeriodKey, getCommissionSummary, markCommissionsPaid } from "@/lib/barber/commissions";
import { createSale, getCashState, openCashSession } from "@/lib/barber/cash";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement, voidCashMovement } from "@/lib/barber/caja-movimientos";
import { BarberForbiddenError } from "@/lib/barber/permissions";
import { resetSalaryReadyCache, salaryReady } from "@/lib/barber/sueldo";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cp${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const PERIOD = currentPeriodKey(TZ);
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
let skip: false | string = skipDb;
let hasSalary = false;
let n = 0;

interface Shop {
  ctx: BarberContext;
  juan: string;
  corte: string;
}

async function shop(open = true): Promise<Shop> {
  n += 1;
  const s = await prisma.barbershop.create({ data: { name: `Pagos ${n}`, slug: `${RUN}-${n}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ } });
  const user = await prisma.barberUser.create({ data: { barbershopId: s.id, supabaseId: `${RUN}-${n}`, email: `${RUN}-${n}@test.local`, firstName: "Dueño", lastName: `P${n}`, role: "OWNER" } });
  const ctx = { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
  const juan = (await prisma.barber.create({ data: { barbershopId: s.id, name: "Juan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const corte = (await prisma.barberService.create({ data: { barbershopId: s.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) } })).id;
  if (open) await openCashSession(ctx, { openingAmount: 1000 });
  return { ctx, juan, corte };
}

async function errorOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  assert.fail("debía fallar");
}

async function movementsOf(barbershopId: string) {
  return prisma.$queryRaw<Array<{ type: string; method: string; amount: Prisma.Decimal; payoutKind: string | null; sessionId: string | null; periodKey: string | null }>>`
    SELECT "type", "method", "amount", "payoutKind", "sessionId", "periodKey" FROM "barber_cash_movements" WHERE "barbershopId" = ${barbershopId}`;
}

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  resetSalaryReadyCache();
  if (!(await cashMovementsReady(prisma))) skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
  hasSalary = await salaryReady(prisma);
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  if (ids.length > 0 && !skip) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  if (ids.length > 0 && hasSalary) await prisma.$executeRaw`DELETE FROM "barber_salary_payments" WHERE "barbershopId" = ANY(${ids}::text[])`;
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("«sale de la caja en efectivo»: UN pago (entradas marcadas) + SU movimiento, y el esperado baja", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan, corte } = await shop();
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], tip: 20, paymentMethod: "CASH" }, FEATURES);
  const antes = (await getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === juan)!;
  assert.equal(antes.totalToPay, 120, "50% de 200 + 20 de propina");
  const r = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD, expectedTotal: 120 }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(r.paidAmount, 120);
  assert.ok(r.movementId);
  const movs = await movementsOf(ctx.barbershopId);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].type, "BARBER_PAYOUT");
  assert.equal(movs[0].payoutKind, "COMMISSION");
  assert.equal(new Prisma.Decimal(movs[0].amount).toNumber(), 120);
  assert.equal(movs[0].periodKey, PERIOD);
  const state = await getCashState(ctx);
  assert.equal(state.open!.expectedCash, 1000 + 220 - 120);
  const despues = (await getCommissionSummary(ctx, PERIOD)).rows.find((r2) => r2.barberId === juan)!;
  assert.equal(despues.totalToPay, 0);
  assert.equal(despues.paidStatus, "PAID");

  // Pagar otra vez no duplica nada.
  const otra = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(otra.marked, 0);
  assert.equal((await movementsOf(ctx.barbershopId)).length, 1, "un solo movimiento");

  // N2: anular ese pago desde Caja (caja abierta) lo DESHACE: comisión pendiente otra vez, esperado de vuelta.
  const sinComisiones = { ...ctx, user: { ...ctx.user, permissionsOverride: ["cash.view", "cash.withdraw", "cash.expenses"] } } as BarberContext;
  const e = await errorOf(voidCashMovement(sinComisiones, r.movementId!, {}));
  assert.ok(e instanceof BarberForbiddenError && e.permission === "commissions.manage", "pide la llave de marcar pagado");
  const v = await voidCashMovement(ctx, r.movementId!, { reason: "clic equivocado" });
  assert.ok(v.voidedAt);
  const deshecho = (await getCommissionSummary(ctx, PERIOD)).rows.find((x) => x.barberId === juan)!;
  assert.equal(deshecho.totalToPay, 120, "vuelve a deberse");
  assert.equal(deshecho.paidStatus, "PENDING");
  assert.equal((await getCashState(ctx)).open!.expectedCash, 1000 + 220, "el pago anulado ya no resta");
  // Y se puede volver a pagar, una sola vez.
  const otra2 = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD, expectedTotal: 120 }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(otra2.paidAmount, 120);
});

test("N2: deshacer un pago con adelanto descontado devuelve el adelanto a restar; con sueldo no se deshace (409)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan, corte } = await shop();
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, FEATURES);
  const adelanto = await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 30, barberId: juan });
  const pago = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD, expectedTotal: 70 }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(pago.paidAmount, 70, "100 − 30");
  await voidCashMovement(ctx, pago.movementId!, {});
  const row = (await getCommissionSummary(ctx, PERIOD)).rows.find((x) => x.barberId === juan)!;
  assert.equal(row.advances, 30, "el adelanto vuelve a restarse");
  assert.equal(row.totalToPay, 70);
  const ad = (await getCashState(ctx)).open!.movements.find((m) => m.id === adelanto.movement.id)!;
  assert.equal(ad.settledAt, null);

  if (!hasSalary) return;
  const fijo = (await prisma.barber.create({ data: { barbershopId: ctx.barbershopId, name: "Fijo", commissionType: "SALARY" } })).id;
  await prisma.$executeRaw`UPDATE "barber_barbers" SET "salaryAmount" = 500, "salaryPeriod" = 'MONTHLY' WHERE "id" = ${fijo}`;
  const ps = await markCommissionsPaid(ctx, { barberId: fijo, periodKey: PERIOD }, new Date(), { cashOut: { method: "CASH" } });
  const e = await errorOf(voidCashMovement(ctx, ps.movementId!, {}));
  assert.ok(e instanceof BarberCajaError && e.code === "SALARY_PAID_NOT_UNDOABLE", String(e));
  const sigue = (await getCashState(ctx)).open!.movements.find((m) => m.id === ps.movementId)!;
  assert.equal(sigue.voidedAt, null, "no se tocó nada");
});

test("en efectivo SIN caja abierta → 409 y NO se marca nada; por transferencia sí, fuera de caja", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan, corte } = await shop(true);
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, FEATURES);
  // Cerrar la caja para quedarse sin turno abierto.
  const { closeCashSession } = await import("@/lib/barber/cash");
  await closeCashSession(ctx, { countedAmount: 1000 });
  const e = await errorOf(markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD }, new Date(), { cashOut: { method: "CASH" } }));
  assert.ok(e instanceof BarberCajaError && e.code === "NO_OPEN_SESSION", String(e));
  const row = (await getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === juan)!;
  assert.equal(row.totalToPay, 100, "sigue pendiente: la transacción se deshizo");
  assert.equal((await movementsOf(ctx.barbershopId)).length, 0);

  const ok = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD }, new Date(), { cashOut: { method: "TRANSFER" } });
  assert.equal(ok.paidAmount, 100);
  const movs = await movementsOf(ctx.barbershopId);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].sessionId, null);
  assert.equal(movs[0].method, "TRANSFER");
});

test("sin «sale de la caja» todo es como antes (sin movimiento); sin cash.withdraw no se puede pedir", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan, corte } = await shop();
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], paymentMethod: "CASH" }, FEATURES);
  const sinRetiro = { ...ctx, user: { ...ctx.user, permissionsOverride: ["commissions.manage", "commissions.view", "cash.view"] } } as BarberContext;
  const e = await errorOf(markCommissionsPaid(sinRetiro, { barberId: juan, periodKey: PERIOD }, new Date(), { cashOut: { method: "CASH" } }));
  assert.ok(e instanceof BarberForbiddenError && e.permission === "cash.withdraw");
  const r = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD });
  assert.equal(r.paidAmount, 100);
  assert.equal(r.movementId ?? null, null);
  assert.equal((await movementsOf(ctx.barbershopId)).length, 0);
});

test("adelanto/vale: se RESTA SOLO de «a pagar» y cuenta como ya pagado (el anulado no cuenta)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan } = await shop();
  await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 200, barberId: juan });
  const malo = await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 50, barberId: juan });
  await voidCashMovement(ctx, malo.movement.id, {});
  const row = (await getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === juan)!;
  assert.equal(row.advances, 200);
  assert.equal(row.totalToPay, -200, "sin tickets aún: el adelanto lo deja debiendo $200");
  assert.equal(row.paidTotal, 200);
  assert.equal(row.grossToPay, 0);
});

test("G1 (caso de t8): adelanto $200 y $3,000 a pagar → salen $2,800 de la caja; el corte cuadra; pagado $3,000 = $2,800 + $200", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan } = await shop();
  const caro = (await prisma.barberService.create({ data: { barbershopId: ctx.barbershopId, name: "Paquete", durationMin: 60, price: new Prisma.Decimal(6000) } })).id;
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: caro }], paymentMethod: "CARD" }, FEATURES);
  const adelanto = await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 200, barberId: juan, payoutKind: "ADVANCE" });
  const antes = (await getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === juan)!;
  assert.equal(antes.grossToPay, 3000);
  assert.equal(antes.advances, 200);
  assert.equal(antes.totalToPay, 2800, "a entregar = 3,000 − 200");
  assert.equal(antes.periodTotal, 3000);

  const r = await markCommissionsPaid(ctx, { barberId: juan, periodKey: PERIOD, expectedTotal: 2800 }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(r.paidAmount, 2800);
  assert.equal(r.advancesDeducted, 200);
  const movs = (await movementsOf(ctx.barbershopId)).filter((m) => m.payoutKind === "COMMISSION");
  assert.equal(new Prisma.Decimal(movs[0].amount).toNumber(), 2800, "el movimiento ligado es por lo que de verdad se entrega");

  // El corte: 1,000 de fondo − 200 de adelanto − 2,800 del pago = −2,000 esperado (salió todo lo que se dio).
  const state = await getCashState(ctx);
  assert.equal(state.open!.expectedCash, 1000 - 200 - 2800);
  assert.equal(state.open!.resumen.payouts.total, 3000, "pagos a barberos = 2,800 + 200");

  const despues = (await getCommissionSummary(ctx, PERIOD)).rows.find((x) => x.barberId === juan)!;
  assert.equal(despues.totalToPay, 0);
  assert.equal(despues.paidTotal, 3000, "Pagado $3,000 = $2,800 + $200");
  assert.equal(despues.advances, 0, "ya descontado");
  assert.equal(despues.advancesSettled, 200);

  // Un adelanto ya descontado no se anula suelto ni se vuelve a restar.
  const e = await errorOf(voidCashMovement(ctx, adelanto.movement.id, {}));
  assert.ok(e instanceof BarberCajaError && e.code === "ADVANCE_SETTLED", String(e));
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: caro }], paymentMethod: "CARD" }, FEATURES);
  const otra = (await getCommissionSummary(ctx, PERIOD)).rows.find((x) => x.barberId === juan)!;
  assert.equal(otra.totalToPay, 3000, "el siguiente pago del mismo periodo ya no resta los $200");
});

test("G1: un adelanto de OTRO periodo no se resta en este", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, juan } = await shop();
  await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 300, barberId: juan });
  await prisma.$executeRaw`UPDATE "barber_cash_movements" SET "periodKey" = '2026-01' WHERE "barbershopId" = ${ctx.barbershopId}`;
  const row = (await getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === juan)!;
  assert.equal(row.advances, 0);
  assert.equal(row.totalToPay, 0);
});

test("N3: renta de silla a favor del dueño → «entra a la caja en efectivo» crea una entrada ligada; anularla deshace el pago", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { ctx, corte } = await shop();
  const renta = (await prisma.barber.create({ data: { barbershopId: ctx.barbershopId, name: "Silla", commissionType: "CHAIR_RENT", chairRent: new Prisma.Decimal(1000) } })).id;
  await createSale(ctx, { barberId: renta, items: [{ kind: "service", id: corte }], tip: 50, paymentMethod: "CARD" }, FEATURES);
  const antes = (await getCommissionSummary(ctx, PERIOD)).rows.find((r) => r.barberId === renta)!;
  assert.equal(antes.totalToPay, -750, "renta 1,000 − (corte 200 + propina 50, que son suyos): le debe 750");

  const sinEntradas = { ...ctx, user: { ...ctx.user, permissionsOverride: ["commissions.manage", "commissions.view", "cash.view"] } } as BarberContext;
  const e = await errorOf(markCommissionsPaid(sinEntradas, { barberId: renta, periodKey: PERIOD }, new Date(), { cashIn: true }));
  assert.ok(e instanceof BarberForbiddenError && e.permission === "cash.expenses");

  const r = await markCommissionsPaid(ctx, { barberId: renta, periodKey: PERIOD, expectedTotal: -750 }, new Date(), { cashIn: true });
  assert.ok(r.movementId);
  const dep = (await movementsOf(ctx.barbershopId)).find((m) => m.type === "DEPOSIT")!;
  assert.equal(new Prisma.Decimal(dep.amount).toNumber(), 750);
  assert.equal(dep.periodKey, PERIOD);
  assert.equal((await getCashState(ctx)).open!.expectedCash, 1000 + 750, "entró al cajón");

  await voidCashMovement(ctx, r.movementId!, {});
  const otra = (await getCommissionSummary(ctx, PERIOD)).rows.find((x) => x.barberId === renta)!;
  assert.equal(otra.totalToPay, -750, "el pago se deshizo: vuelve a deberla");
  assert.equal((await getCashState(ctx)).open!.expectedCash, 1000);
});

test("sueldo: el pago desde la caja queda como SALARY con su monto congelado", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  if (!hasSalary) return t.skip("sql/barber_sueldo.sql no está pegado");
  const { ctx } = await shop();
  const fijo = (await prisma.barber.create({ data: { barbershopId: ctx.barbershopId, name: "Fijo", commissionType: "SALARY" } })).id;
  await prisma.$executeRaw`UPDATE "barber_barbers" SET "salaryAmount" = 900, "salaryPeriod" = 'MONTHLY' WHERE "id" = ${fijo}`;
  const r = await markCommissionsPaid(ctx, { barberId: fijo, periodKey: PERIOD, expectedTotal: 900 }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(r.paidAmount, 900);
  const movs = await movementsOf(ctx.barbershopId);
  assert.equal(movs[0].payoutKind, "SALARY");
  assert.equal((await getCashState(ctx)).open!.expectedCash, 100);
});
