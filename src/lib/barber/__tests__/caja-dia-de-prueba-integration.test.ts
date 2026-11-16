// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1), punto 7: EL DÍA DE PRUEBA DEL DUEÑO, de punta a
// punta contra una base REAL, con las funciones de verdad (las mismas que
// usan las APIs). Lo pidió el prompt: ¿cuadra cada número en Caja, en el
// corte impreso y en el CSV?
//
//   Abrir con $500 · cobrar 3 tickets: efectivo $850 (corte $800 + $50 de
//   propina), tarjeta $300 ($270 + $30), transferencia $180 · gasto $80
//   garrafón · adelanto $200 a Pepe · sacar $1,000 para el banco · meter
//   $200 de cambio · cerrar contando billete por billete.
//
//   Esperado = 500 + 850 + 200 − 80 − 1,000 − 200 = $270.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-dia-de-prueba-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { closeCashSession, createSale, getCashSessionSummary, getCashState, listCortes, openCashSession } from "@/lib/barber/cash";
import { currentPeriodKey, getCommissionSummary } from "@/lib/barber/commissions";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { createCashMovement, listExpenses } from "@/lib/barber/caja-movimientos";
import { cortesCsv, type CortesCsvLabels } from "@/lib/barber/caja-csv";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { closeExpectedView } from "@/components/barber/cash/close-expected";
import { corteWhatsappText } from "@/components/barber/cash/corte-core";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `dia${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
let skip: false | string = skipDb;
let ctx: BarberContext;
let juan: string;
let pepe: string;

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  if (!(await cashMovementsReady(prisma))) {
    skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
    return;
  }
  const s = await prisma.barbershop.create({ data: { name: "Barbería del Día", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ } });
  const user = await prisma.barberUser.create({ data: { barbershopId: s.id, supabaseId: `${RUN}-o`, email: `${RUN}@test.local`, firstName: "Juan", lastName: "Dueño", role: "OWNER" } });
  ctx = { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
  juan = (await prisma.barber.create({ data: { barbershopId: s.id, name: "Juan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  pepe = (await prisma.barber.create({ data: { barbershopId: s.id, name: "Pepe", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  if (ids.length > 0 && !skip) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("el día del dueño cuadra en Caja, en el corte impreso/WhatsApp y en el CSV", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const svc = async (name: string, price: number) => (await prisma.barberService.create({ data: { barbershopId: ctx.barbershopId, name, durationMin: 30, price: new Prisma.Decimal(price) } })).id;
  const completo = await svc("Corte + barba + cera", 800);
  const fade = await svc("Fade", 270);
  const corte = await svc("Corte", 180);

  const open = await openCashSession(ctx, { openingAmount: 500 });
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: completo }], tip: 50, paymentMethod: "CASH" }, FEATURES);
  await createSale(ctx, { barberId: pepe, items: [{ kind: "service", id: fade }], tip: 30, paymentMethod: "CARD" }, FEATURES);
  await createSale(ctx, { barberId: juan, items: [{ kind: "service", id: corte }], paymentMethod: "SPEI" }, FEATURES);
  await createCashMovement(ctx, { type: "EXPENSE", amount: 80, category: "SUPPLIES", note: "Garrafón" });
  await createCashMovement(ctx, { type: "BARBER_PAYOUT", amount: 200, barberId: pepe, payoutKind: "ADVANCE", note: "Vale" });
  await createCashMovement(ctx, { type: "WITHDRAWAL", amount: 1000, note: "Al banco" });
  await createCashMovement(ctx, { type: "DEPOSIT", amount: 200, note: "Cambio" });

  // ── En Caja (lo que pinta la pantalla) ──
  const state = await getCashState(ctx);
  const r = state.open!.resumen;
  assert.equal(state.open!.expectedCash, 270, "Debe haber en caja");
  assert.equal(r.income.total, 1330, "Ingresos");
  assert.deepEqual([r.income.byMethod.CASH.total, r.income.byMethod.CARD.total, r.income.byMethod.SPEI.total], [850, 300, 180]);
  assert.equal(r.tips.total, 80, "Propinas");
  assert.deepEqual(r.tips.byBarber.map((b) => [b.barberName, b.total]), [["Juan", 50], ["Pepe", 30]]);
  assert.equal(r.expenses.total, 80, "Gastos");
  assert.equal(r.payouts.total, 200);
  assert.deepEqual([r.withdrawals.total, r.deposits.total], [1000, 200], "Retiros / entradas");
  assert.equal(r.tickets.count, 3);
  assert.equal(r.tickets.average, 416.67, "(800 + 270 + 180) / 3");
  assert.equal(state.open!.movements.length, 4);
  assert.equal(state.open!.sales.length, 3);

  // Comisiones ve el adelanto de Pepe.
  const pepeRow = (await getCommissionSummary(ctx, currentPeriodKey(TZ))).rows.find((x) => x.barberId === pepe)!;
  assert.equal(pepeRow.advances, 200);

  // ── Cerrar contando billete por billete: 1×200 + 1×50 + 1×20 = 270 ──
  const closed = await closeCashSession(ctx, { sessionId: open.session.id, countedBreakdown: { "200": 1, "50": 1, "20": 1 }, leftForNext: 200 });
  assert.equal(closed.session.expectedAmount, 270);
  assert.equal(closed.session.countedAmount, 270);
  assert.equal(closed.session.difference, 0, "Cuadra");

  // ── El corte impreso / WhatsApp ──
  const corte2 = await getCashSessionSummary(ctx, open.session.id);
  const v = closeExpectedView(corte2);
  assert.deepEqual(
    [v.opening, v.cashCharged, ...v.extras.map((x) => `${x.sign}${x.key}:${x.amount}`), v.expected],
    [500, 850, "+cashIn:200", "−cashExpenses:80", "−withdrawals:1000", "−cashPayouts:200", 270],
  );
  const dict = (getBarberDict("es") as unknown as { barber: { caja: Dictionary } }).barber.caja;
  const texto = corteWhatsappText(corte2, { shopName: "Barbería del Día", tz: TZ, t: makeBarberT(dict), categoryLabel: (c) => c });
  for (const linea of ["= Esperado en efectivo: $270.00", "Contado: $270.00", "Diferencia: Cuadra", "Fondo para mañana: $200.00", "*Ingresos: $1,330.00*"]) {
    assert.ok(texto.includes(linea), `falta «${linea}» en el corte:\n${texto}`);
  }

  // ── El CSV de Cortes ──
  const tEs = getBarberT("es");
  const L = new Proxy({}, { get: (_x, k) => tEs(`barber.caja.csv.cortes.${String(k)}`) }) as CortesCsvLabels;
  const csv = cortesCsv(await listCortes(ctx, currentPeriodKey(TZ)), L, TZ).replace("﻿", "").trim().split("\r\n");
  const head = csv[0].split(",");
  const fila = csv[1].split(",");
  const col = (name: string) => fila[head.indexOf(name)];
  assert.equal(col("Fondo"), "500");
  assert.equal(col("Efectivo cobrado"), "850");
  assert.equal(col("Entradas"), "200");
  assert.equal(col("Gastos en efectivo"), "80");
  assert.equal(col("Retiros"), "1000");
  assert.equal(col("Pagos a barberos en efectivo"), "200");
  assert.equal(col("Esperado"), "270");
  assert.equal(col("Contado"), "270");
  assert.equal(col("Diferencia"), "0");
  assert.equal(col("Fondo para mañana"), "200");
  assert.equal(col("Ingresos"), "1330");
  assert.equal(col("Propinas"), "80");

  // ── Gastos del mes y el fondo sugerido para mañana ──
  const gastos = await listExpenses(ctx, {});
  assert.equal(gastos.resumen.total, 80);
  assert.equal((await getCashState(ctx)).suggestedOpening, 200);
});
