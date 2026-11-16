// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1), punto 7: SIN sql/barber_caja_completa.sql la caja
// de hoy queda INTACTA. Corre solo contra una base local donde ese SQL NO
// está pegado (si está, se salta y lo dice):
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-sin-sql-integration.test.ts
//
//   · abrir, cobrar, resumen y cerrar funcionan y cuadran como antes
//     (fondo + efectivo); el conteo por billete se acepta (no se guarda);
//   · los botones nuevos no aparecen (movementsReady = false) y sus APIs
//     contestan 409 CAJA_SQL_PENDING sin escribir nada;
//   · Comisiones paga como siempre; «sale de la caja» → 409, no marca nada.
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { closeCashSession, createSale, getCashState, listCortes, openCashSession } from "@/lib/barber/cash";
import { BarberCajaError, currentPeriodKey, getCommissionSummary, markCommissionsPaid } from "@/lib/barber/commissions";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement, listExpenses } from "@/lib/barber/caja-movimientos";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `css${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
let skip: false | string = skipDb;
let ctx: BarberContext;
let juan: string;
let corte: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BarberCajaError) return e.code;
    throw e;
  }
  return "OK";
}

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  if (await cashMovementsReady(prisma)) {
    skip = "sql/barber_caja_completa.sql SÍ está pegado en esta base: esta prueba es para la base sin él";
    return;
  }
  const s = await prisma.barbershop.create({ data: { name: "Sin SQL", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ } });
  const user = await prisma.barberUser.create({ data: { barbershopId: s.id, supabaseId: `${RUN}-o`, email: `${RUN}@test.local`, firstName: "Ana", lastName: "S", role: "OWNER" } });
  ctx = { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
  juan = (await prisma.barber.create({ data: { barbershopId: s.id, name: "Juan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  corte = (await prisma.barberService.create({ data: { barbershopId: s.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) } })).id;
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("sin el SQL: abrir, cobrar, resumen y cerrar como antes; lo nuevo dice 409 y no escribe nada", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  await openCashSession(ctx, { openingAmount: 500 });
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], tip: 20, paymentMethod: "CASH" }, FEATURES);
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, FEATURES);

  const state = await getCashState(ctx);
  assert.equal(state.movementsReady, false, "la pantalla no enseña los botones nuevos");
  assert.equal(state.suggestedOpening, null);
  assert.deepEqual(state.open!.movements, []);
  assert.equal(state.open!.expectedCash, 720, "fondo + efectivo, como siempre");

  for (const body of [{ type: "EXPENSE", amount: 80 }, { type: "WITHDRAWAL", amount: 100 }, { type: "DEPOSIT", amount: 100 }, { type: "BARBER_PAYOUT", amount: 50, barberId: juan }]) {
    assert.equal(await code(createCashMovement(ctx, body)), "CAJA_SQL_PENDING", String(body.type));
  }
  assert.equal(await code(listExpenses(ctx, {})), "CAJA_SQL_PENDING");

  // Comisiones: «sale de la caja» no se puede; pagar normal, sí.
  const period = currentPeriodKey(TZ);
  assert.equal(await code(markCommissionsPaid(ctx, { barberId: juan, periodKey: period }, new Date(), { cashOut: { method: "CASH" } })), "CAJA_SQL_PENDING");
  const row = (await getCommissionSummary(ctx, period)).rows.find((r) => r.barberId === juan)!;
  assert.equal(row.advances ?? 0, 0, "sin SQL no hay «adelantos del periodo»");
  assert.equal(row.totalToPay, 220, "nada se marcó: 50%·400 + 20");

  // Cerrar con conteo por billete: el total cuenta, el conteo no se guarda (no hay columna).
  const closed = await closeCashSession(ctx, { countedBreakdown: { "500": 1, "200": 1, "20": 1 }, leftForNext: 100 });
  assert.equal(closed.session.countedAmount, 720);
  assert.equal(closed.session.expectedAmount, 720);
  assert.equal(closed.session.countedBreakdown, null);
  assert.equal(closed.session.leftForNext, null);
  const cortes = await listCortes(ctx, period);
  assert.equal(cortes.length, 1, "la pestaña Cortes funciona sin el SQL");
  assert.equal(cortes[0].resumen.expectedCash, 720);
});
