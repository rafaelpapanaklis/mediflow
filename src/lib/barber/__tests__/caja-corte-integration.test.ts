// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1), punto 3: el corte contra una base REAL.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-corte-integration.test.ts
//
//   · conteo por billete/moneda: el total sale del conteo (Decimal) y se guarda;
//   · el fondo para mañana se guarda y se sugiere al abrir el siguiente turno;
//   · total escrito que no coincide con el conteo → 400; fondo > contado → 400;
//   · dos cierres A LA VEZ (dos pestañas): uno gana, el otro 409 con el id;
//   · el esperado congelado incluye gastos, retiros, entradas y pagos.
// Requiere sql/barber_caja_completa.sql pegado en esa base local.
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberCajaError } from "@/lib/barber/commissions";
import { BarberForbiddenError } from "@/lib/barber/permissions";
import { closeCashSession, getCashSessionSummary, getCashState, openCashSession } from "@/lib/barber/cash";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement } from "@/lib/barber/caja-movimientos";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cc${Date.now().toString(36)}`;
let skip: false | string = skipDb;
let n = 0;

async function shop(): Promise<BarberContext> {
  n += 1;
  const s = await prisma.barbershop.create({
    data: { name: `Corte ${n}`, slug: `${RUN}-${n}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: s.id, supabaseId: `${RUN}-${n}`, email: `${RUN}-${n}@test.local`, firstName: "Caro", lastName: `C${n}`, role: "OWNER" },
  });
  return { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
}

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

test("conteo por billete/moneda: el total sale del conteo; fondo para mañana guardado y sugerido al abrir", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 500 });
  await createCashMovement(ctx, { type: "DEPOSIT", amount: 200 });
  await createCashMovement(ctx, { type: "EXPENSE", amount: 80.5, category: "SUPPLIES" });
  // Esperado: 500 + 200 − 80.50 = 619.50. Contado: 1×500 + 1×100 + 1×20 (moneda) − falta 0.50 → 620 − 0.50…
  // 500 + 100 + 10 + 5 + 2 + 2×1 + 1×0.50 = 619.50
  const closed = await closeCashSession(ctx, {
    countedBreakdown: { "500": 1, "100": 1, "10": 1, "5": 1, "2": 1, "1": 2, "0.5": 1, "20": 0 },
    leftForNext: "300",
    notes: "todo bien",
  });
  assert.equal(closed.session.countedAmount, 619.5);
  assert.equal(closed.session.expectedAmount, 619.5);
  assert.equal(closed.session.difference, 0);
  assert.deepEqual(closed.session.countedBreakdown, { "500": 1, "100": 1, "10": 1, "5": 1, "2": 1, "1": 2, "0.5": 1 }, "los ceros no se guardan");
  assert.equal(closed.session.leftForNext, 300);
  const state = await getCashState(ctx);
  assert.equal(state.open, null);
  assert.equal(state.suggestedOpening, 300, "al abrir se sugiere el fondo que se dejó");
  assert.equal(state.history[0].leftForNext, 300);
});

test("M3: sin «Sacar efectivo» el fondo para mañana = lo contado; abrir con otro fondo pide confirmar y lo anota", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  const recep = await prisma.barberUser.create({
    data: { barbershopId: ctx.barbershopId, supabaseId: `${RUN}-rec-${n}`, email: `${RUN}-rec-${n}@test.local`, firstName: "Rita", lastName: "R", role: "RECEPTION" },
  });
  const rctx = { ...ctx, barberUserId: recep.id, user: recep, role: "RECEPTION" } as BarberContext;
  await openCashSession(rctx, { openingAmount: 500 });
  // Recepción intenta llevarse $400 dejando $100 (la llamada del dueño repetida
  // con su sesión): 403 y el turno SIGUE ABIERTO (QA de cierre D, 16-nov).
  const sinLlave = await closeCashSession(rctx, { countedAmount: 500, leftForNext: 100 }).then(() => null, (e: unknown) => e);
  assert.ok(sinLlave instanceof BarberForbiddenError && sinLlave.permission === "cash.withdraw", "pedir llevarse efectivo sin cash.withdraw → 403");
  assert.ok((await getCashState(rctx)).open, "el 403 no cierra el turno");
  // Lo que manda su pantalla (sin fondo): cierra y TODO lo contado queda de fondo.
  const closed = await closeCashSession(rctx, { countedAmount: 500, leftForNext: null });
  assert.equal(closed.session.leftForNext, 500, "sin cash.withdraw no se lleva nada");
  // Abrir con $300 cuando se dejaron $500: 409 con la diferencia; confirmado, se anota.
  const e = await errorOf(openCashSession(rctx, { openingAmount: 300 }));
  assert.equal(e.code, "OPENING_DIFFERS");
  assert.deepEqual(e.details, { suggested: 500, difference: -200 });
  const abierta = await openCashSession(rctx, { openingAmount: 300, confirmDifference: true, notes: "faltó cambio" });
  assert.match(abierta.session.notes ?? "", /se dejaron \$500\.00 y se abrió con \$300\.00 \(faltan \$200\.00\)/);
  assert.match(abierta.session.notes ?? "", /faltó cambio/);
  // El dueño (con cash.withdraw) sí puede dejar menos de lo contado.
  const c2 = await closeCashSession(ctx, { countedAmount: 300, leftForNext: 100 });
  assert.equal(c2.session.leftForNext, 100);
  const igual = await openCashSession(ctx, { openingAmount: 100 });
  assert.equal(igual.session.notes, null, "con el mismo fondo no pide nada ni anota");
  await closeCashSession(ctx, { countedAmount: 100 });
});

test("total escrito que no coincide con el conteo → 400; fondo mayor que lo contado → 400; conteo con letras → 400", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 100 });
  assert.equal((await errorOf(closeCashSession(ctx, { countedBreakdown: { "100": 1 }, countedAmount: 150 }))).code, "COUNT_MISMATCH");
  assert.equal((await errorOf(closeCashSession(ctx, { countedAmount: 100, leftForNext: 101 }))).code, "LEFT_TOO_BIG");
  assert.equal((await errorOf(closeCashSession(ctx, { countedBreakdown: { "100": "uno" } }))).code, "INVALID_COUNT");
  assert.equal((await errorOf(closeCashSession(ctx, { countedBreakdown: { "300": 1 } }))).code, "INVALID_COUNT");
  assert.equal((await errorOf(closeCashSession(ctx, { countedBreakdown: { "100": -1 } }))).code, "INVALID_COUNT");
  assert.equal((await errorOf(closeCashSession(ctx, {}))).code, "INVALID_AMOUNT", "sin conteo ni total: el monto es obligatorio");
  const state = await getCashState(ctx);
  assert.ok(state.open, "nada de lo anterior cerró la caja");
});

test("dos pestañas cierran A LA VEZ: una gana; la otra recibe 409 SESSION_CLOSED con el id y ve el MISMO corte", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  const open = await openCashSession(ctx, { openingAmount: 400 });
  await createCashMovement(ctx, { type: "WITHDRAWAL", amount: 100 });
  const sessionId = open.session.id;
  const results = await Promise.allSettled([
    closeCashSession(ctx, { countedAmount: 300, sessionId }),
    closeCashSession(ctx, { countedAmount: 250, sessionId }),
    closeCashSession(ctx, { countedAmount: 280, sessionId }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const bad = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(ok.length, 1, "solo un corte");
  assert.equal(bad.length, 2);
  for (const r of bad) {
    assert.ok(r.reason instanceof BarberCajaError);
    assert.equal(r.reason.code, "SESSION_CLOSED");
    assert.deepEqual(r.reason.details, { sessionId });
  }
  const sessions = await prisma.barberCashSession.findMany({ where: { barbershopId: ctx.barbershopId } });
  assert.equal(sessions.length, 1);
  const s = await getCashSessionSummary(ctx, sessionId);
  assert.equal(s.session.expectedAmount, 300, "400 − 100 de retiro");
  assert.ok([300, 250, 280].includes(s.session.countedAmount!), "quedó el contado de quien ganó");
  // Y cerrar sin id cuando ya no hay caja: 409 NO_OPEN_SESSION.
  assert.equal((await errorOf(closeCashSession(ctx, { countedAmount: 1 }))).code, "NO_OPEN_SESSION");
});

test("un COBRO que llega mientras se cierra tampoco se cuela: o entra antes del corte o se rechaza (sin turno)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  const corte = (await prisma.barberService.create({ data: { barbershopId: ctx.barbershopId, name: "Corte", durationMin: 30, price: 150 } })).id;
  const { createSale } = await import("@/lib/barber/cash");
  const { FALLBACK_BARBER_PLAN_CONFIG } = await import("@/lib/barber/plan-shared");
  for (let i = 0; i < 4; i++) {
    const c = i === 0 ? ctx : await shop();
    const svc = i === 0 ? corte : (await prisma.barberService.create({ data: { barbershopId: c.barbershopId, name: "Corte", durationMin: 30, price: 150 } })).id;
    await openCashSession(c, { openingAmount: 100 });
    const [cobro, cierre] = await Promise.allSettled([
      createSale(c, { items: [{ kind: "service", id: svc }], paymentMethod: "CASH" }, FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features),
      closeCashSession(c, { countedAmount: 100 }),
    ]);
    assert.equal(cierre.status, "fulfilled");
    const closed = (cierre as PromiseFulfilledResult<Awaited<ReturnType<typeof closeCashSession>>>).value;
    if (cobro.status === "rejected") {
      assert.equal((cobro.reason as BarberCajaError).code, "NO_OPEN_SESSION");
      assert.equal(closed.session.expectedAmount, 100);
    } else {
      assert.equal(closed.session.expectedAmount, 250, "el cobro entró antes del corte y está en el esperado");
    }
    const s = await getCashSessionSummary(c, closed.session.id);
    assert.equal(s.expectedCash, closed.session.expectedAmount, "lo congelado = lo que hay en el turno");
  }
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershop: { slug: { startsWith: RUN } } } } });
  await prisma.barberSale.deleteMany({ where: { barbershop: { slug: { startsWith: RUN } } } });
});

test("M2: cancelar un ticket o cambiarle el medio MIENTRAS se cierra no descuadra el corte congelado", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { createSale, cancelSale, changeSalePaymentMethod } = await import("@/lib/barber/cash");
  const { FALLBACK_BARBER_PLAN_CONFIG } = await import("@/lib/barber/plan-shared");
  const F = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
  for (let i = 0; i < 6; i++) {
    const c = await shop();
    const svc = (await prisma.barberService.create({ data: { barbershopId: c.barbershopId, name: "Corte", durationMin: 30, price: 300 } })).id;
    await openCashSession(c, { openingAmount: 100 });
    const sale = await createSale(c, { items: [{ kind: "service", id: svc }], paymentMethod: "CASH" }, F);
    const toque = i % 2 === 0 ? cancelSale(c, sale.id, { reason: "error" }) : changeSalePaymentMethod(c, sale.id, { paymentMethod: "CARD" });
    const [cambio, cierre] = await Promise.allSettled([toque, closeCashSession(c, { countedAmount: 100 })]);
    assert.equal(cierre.status, "fulfilled");
    const closed = (cierre as PromiseFulfilledResult<Awaited<ReturnType<typeof closeCashSession>>>).value;
    if (cambio.status === "rejected") {
      assert.equal((cambio.reason as BarberCajaError).code, "SESSION_CLOSED", String(cambio.reason));
      assert.equal(closed.session.expectedAmount, 400, "el cambio llegó tarde: el ticket sigue en efectivo");
    } else {
      assert.equal(closed.session.expectedAmount, 100, "el cambio entró antes del corte");
    }
    const s = await getCashSessionSummary(c, closed.session.id);
    assert.equal(s.expectedCash, closed.session.expectedAmount, "lo congelado = lo que se recalcula");
  }
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershop: { slug: { startsWith: RUN } } } } });
  await prisma.barberSale.deleteMany({ where: { barbershop: { slug: { startsWith: RUN } } } });
});

test("un gasto que llega mientras se cierra NO se cuela en un corte ya congelado", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const ctx = await shop();
  await openCashSession(ctx, { openingAmount: 1000 });
  const [cierre, gasto] = await Promise.allSettled([
    closeCashSession(ctx, { countedAmount: 1000 }),
    createCashMovement(ctx, { type: "EXPENSE", amount: 50 }),
  ]);
  assert.equal(cierre.status, "fulfilled");
  assert.equal(gasto.status, "fulfilled", "el gasto se registra (dentro o fuera de caja)");
  const g = (gasto as PromiseFulfilledResult<Awaited<ReturnType<typeof createCashMovement>>>).value;
  const closed = (cierre as PromiseFulfilledResult<Awaited<ReturnType<typeof closeCashSession>>>).value;
  if (g.outsideSession) {
    assert.equal(closed.session.expectedAmount, 1000, "llegó después: queda fuera y el corte no lo ve");
  } else {
    assert.equal(closed.session.expectedAmount, 950, "llegó antes: el corte ya lo incluye");
  }
  const s = await getCashSessionSummary(ctx, closed.session.id);
  assert.equal(s.expectedCash, closed.session.expectedAmount, "lo congelado y lo que se recalcula coinciden");
});
