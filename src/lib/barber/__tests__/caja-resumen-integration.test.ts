// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1): el resumen del turno y del periodo contra una base
// REAL, con movimientos guardados en "barber_cash_movements".
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-resumen-integration.test.ts
//
// Requiere sql/barber_caja_completa.sql pegado en esa base local (si no, se
// salta y lo dice; la prueba «sin SQL» vive en caja-sin-sql-integration).
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { createSale, getCajaResumenPeriodo, getCashState, openCashSession } from "@/lib/barber/cash";
import { cashMovementsReady, resetCashMovementsReadyCache } from "@/lib/barber/cash-movements";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cr${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;

let skip: false | string = skipDb;
let ctx: BarberContext;
let otro: BarberContext;
let shopId: string;
let sessionId: string;
let barberId: string;
let corte: string;

async function mov(p: { shop?: string; session: string | null; type: string; method?: string; amount: number; category?: string; payoutKind?: string; voided?: boolean; at?: Date }) {
  const id = randomUUID();
  const user = p.shop && p.shop !== shopId ? otro.barberUserId : ctx.barberUserId;
  await prisma.$executeRaw`
    INSERT INTO "barber_cash_movements" ("id", "barbershopId", "sessionId", "type", "method", "amount", "category", "barberId", "payoutKind", "createdByUserId", "createdAt", "voidedAt", "voidedByUserId")
    VALUES (${id}, ${p.shop ?? shopId}, ${p.session}, ${p.type}, ${p.method ?? "CASH"}, ${new Prisma.Decimal(p.amount).toFixed(2)}::numeric, ${p.category ?? null},
            ${p.payoutKind ? barberId : null}, ${p.payoutKind ?? null}, ${user}, ${p.at ?? new Date()}, ${p.voided ? new Date() : null}, ${p.voided ? user : null})
  `;
  return id;
}

async function shop(suffix: string) {
  const s = await prisma.barbershop.create({
    data: { name: `Caja ${suffix}`, slug: `${RUN}-${suffix}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: s.id, supabaseId: `${RUN}-${suffix}`, email: `${RUN}-${suffix}@test.local`, firstName: "Dueño", lastName: suffix, role: "OWNER" },
  });
  return { barberUserId: user.id, barbershopId: s.id, barbershop: s, user, barber: null, role: "OWNER" } as BarberContext;
}

before(async () => {
  if (!HAS_DB) return;
  resetCashMovementsReadyCache();
  if (!(await cashMovementsReady(prisma))) {
    skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
    return;
  }
  ctx = await shop("a");
  otro = await shop("b");
  shopId = ctx.barbershopId;
  barberId = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Juan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  corte = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(800) } })).id;
  const open = await openCashSession(ctx, { openingAmount: 500 });
  sessionId = open.session.id;
  await openCashSession(otro, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  if (ids.length > 0 && !skip) {
    await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  }
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("el turno abierto suma sus movimientos; los anulados, los de otra barbería y los de fuera de caja no", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  await createSale(ctx, { barberId, items: [{ kind: "service", id: corte }], tip: 50, paymentMethod: "CASH" }, FEATURES);
  await createSale(ctx, { barberId, items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, FEATURES);
  await mov({ session: sessionId, type: "EXPENSE", amount: 80, category: "SUPPLIES" });
  await mov({ session: sessionId, type: "BARBER_PAYOUT", amount: 200, payoutKind: "ADVANCE" });
  await mov({ session: sessionId, type: "WITHDRAWAL", amount: 1000 });
  await mov({ session: sessionId, type: "DEPOSIT", amount: 200 });
  await mov({ session: sessionId, type: "EXPENSE", amount: 999, voided: true });
  await mov({ session: null, type: "EXPENSE", amount: 4500, method: "TRANSFER", category: "RENT" });
  await mov({ shop: otro.barbershopId, session: null, type: "WITHDRAWAL", amount: 7777 });

  const state = await getCashState(ctx);
  assert.equal(state.movementsReady, true);
  const open = state.open!;
  // 500 + 850 + 200 − 80 − 1,000 − 200 = 270
  assert.equal(open.expectedCash, 270);
  assert.equal(open.resumen.esperado.expected, 270);
  assert.equal(open.movements.length, 5, "los 4 vivos + el anulado (se enseña tachado)");
  assert.equal(open.resumen.voidedMovements, 1);
  assert.equal(open.resumen.income.total, 1650);
  assert.equal(open.movements.find((m) => m.type === "BARBER_PAYOUT")?.barberName, "Juan");
  assert.match(open.movements[0].createdByName, /Dueño a/);
});

test("el resumen de un periodo trae también el gasto fuera de caja (renta por transferencia), sin tocar el efectivo", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const now = Date.now();
  const { resumen } = await getCajaResumenPeriodo(ctx, { from: new Date(now - 3600_000), to: new Date(now + 3600_000) });
  assert.equal(resumen.expenses.total, 4580);
  assert.deepEqual(resumen.expenses.byCategory.map((c) => c.category), ["RENT", "SUPPLIES"]);
  assert.equal(resumen.withdrawals.total, 1000, "el retiro de la OTRA barbería no se cuela");
  assert.equal(resumen.expectedCash, -230, "sin fondo: flujo neto de efectivo = 850 + 200 − 80 − 1,000 − 200");
});
