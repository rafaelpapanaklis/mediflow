// Comisiones: «A pagar» es SOLO lo pendiente (G4 de la auditoría ws6-t3).
//
// El caso que se reprodujo en vivo: barbero al 50 % con un corte de $180 y
// $0.01 de propina → se le marca pagado ($90.01). Después hace otro corte de
// $180 con $10 de propina. La pantalla decía «A pagar +$190.01» y el recibo
// «Total a pagar +$190.01»: quien paga cada semana, pagaba dos veces la
// primera. Lo que de verdad se le debe son $100.
//
// Aquí se demuestra que la tabla, el diálogo de pagar (misma fila), el
// recibo y el propio pago dan la MISMA cifra, y que marcar pagado dos veces
// (o dos personas a la vez) no paga doble.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/comisiones-a-pagar-integration.test.ts
//
// La primera parte es pura (corre sin base); la integración se SALTA sin
// DATABASE_URL. JAMÁS apuntarla a producción: crea barberías.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  BarberCajaError,
  D,
  currentPeriodKey,
  getCommissionEntries,
  getCommissionReceipt,
  getCommissionSummary,
  markCommissionsPaid,
  payoutFor,
  splitPayout,
} from "@/lib/barber/commissions";
import { cancelSale, createSale, openCashSession } from "@/lib/barber/cash";

// Solo contra una base LOCAL: ver _base-local.ts (crean y borran barberías).
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import { ALTA_ANTIGUA } from "./_base-local";

// ═══════════════════════════════════════════════════════════════════════
// 0. La cuenta, pura
// ═══════════════════════════════════════════════════════════════════════

test("a pagar + ya pagado = lo del periodo, en los tres esquemas y antes/después de pagar", () => {
  const cases = [
    { type: "COMMISSION" as const, rent: null },
    { type: "CHAIR_RENT" as const, rent: D(1500) },
    { type: "SALARY" as const, rent: null },
  ];
  for (const c of cases) {
    for (const anyPaid of [false, true]) {
      const parts = {
        commissionPending: D("90"),
        commissionPaid: anyPaid ? D("90") : D(0),
        tipsPending: D("10"),
        tipsPaid: anyPaid ? D("0.01") : D(0),
        chairRent: c.rent,
        anyPaid,
      };
      const split = splitPayout(c.type, parts);
      const whole = payoutFor(c.type, {
        commissionTotal: parts.commissionPending.plus(parts.commissionPaid),
        tips: parts.tipsPending.plus(parts.tipsPaid),
        chairRent: c.rent,
      });
      assert.equal(split.toPay.plus(split.paid).toFixed(2), whole.toFixed(2), `${c.type} anyPaid=${anyPaid}`);
    }
  }
});

test("el caso de la auditoría: pagado $90.01, se deben $100 — no $190.01", () => {
  const split = splitPayout("COMMISSION", {
    commissionPending: D(90),
    commissionPaid: D(90),
    tipsPending: D(10),
    tipsPaid: D("0.01"),
    chairRent: null,
    anyPaid: true,
  });
  assert.equal(split.toPay.toFixed(2), "100.00");
  assert.equal(split.paid.toFixed(2), "90.01");
});

test("renta de silla: se descuenta UNA vez, en el primer pago del periodo", () => {
  const first = splitPayout("CHAIR_RENT", {
    commissionPending: D(2000), commissionPaid: D(0), tipsPending: D(50), tipsPaid: D(0), chairRent: D(1500), anyPaid: false,
  });
  assert.equal(first.toPay.toFixed(2), "550.00", "2000 + 50 − 1500");
  assert.equal(first.paid.toFixed(2), "0.00");
  assert.equal(first.rentDiscounted, false);
  assert.equal(first.rentPending?.toFixed(2), "1500.00");

  const later = splitPayout("CHAIR_RENT", {
    commissionPending: D(300), commissionPaid: D(2000), tipsPending: D(0), tipsPaid: D(50), chairRent: D(1500), anyPaid: true,
  });
  assert.equal(later.toPay.toFixed(2), "300.00", "la renta NO vuelve a restarse");
  assert.equal(later.paid.toFixed(2), "550.00", "lo ya pagado incluye la renta descontada");
  assert.equal(later.rentDiscounted, true);
  assert.equal(later.rentPending?.toFixed(2), "0.00");
});

test("sueldo fijo: aquí solo se le deben sus propinas pendientes", () => {
  const split = splitPayout("SALARY", {
    commissionPending: D(0), commissionPaid: D(0), tipsPending: D(40), tipsPaid: D(25), chairRent: null, anyPaid: true,
  });
  assert.equal(split.toPay.toFixed(2), "40.00");
  assert.equal(split.paid.toFixed(2), "25.00");
});

// ═══════════════════════════════════════════════════════════════════════
// Integración
// ═══════════════════════════════════════════════════════════════════════

const RUN = `c${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const TZ = "America/Mexico_City";
const PERIOD = currentPeriodKey(TZ);

let ctx: BarberContext;
let shopId: string;
let uno: string; // 50 %
let dos: string; // renta de silla $1,500
let tres: string; // sueldo fijo
let corte: string; // $180
let paquete: string; // $2,000 (para que la renta salga positiva)
let ctxB: BarberContext;
let barberB: string;

const codeIs = (code: string) => (e: unknown) => e instanceof BarberCajaError && e.code === code;

const sale = (barberId: string, serviceId: string, tip = 0) =>
  createSale(ctx, { barberId, items: [{ kind: "service", id: serviceId }], tip, paymentMethod: "CASH" }, FEATURES);

async function rowOf(barberId: string) {
  const summary = await getCommissionSummary(ctx, PERIOD);
  return { row: summary.rows.find((r) => r.barberId === barberId)!, totals: summary.totals };
}

async function makeShop(tag: string) {
  const shop = await prisma.barbershop.create({
    data: { name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${tag}-owner`, email: `${RUN}-${tag}@test.local`, firstName: "Dueña", lastName: tag, role: "OWNER" },
  });
  const c: BarberContext = { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" };
  return { shop, ctx: c };
}

before(async () => {
  if (!HAS_DB) return;
  const a = await makeShop("A");
  ctx = a.ctx;
  shopId = a.shop.id;
  const [b1, b2, b3] = await Promise.all([
    prisma.barber.create({ data: { barbershopId: shopId, name: "Barbero Uno", nickname: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } }),
    prisma.barber.create({ data: { barbershopId: shopId, name: "Barbero Dos", commissionType: "CHAIR_RENT", chairRent: new Prisma.Decimal(1500), createdAt: ALTA_ANTIGUA } }),
    prisma.barber.create({ data: { barbershopId: shopId, name: "Barbero Tres", commissionType: "SALARY", createdAt: ALTA_ANTIGUA } }),
  ]);
  uno = b1.id; dos = b2.id; tres = b3.id;
  const [s1, s2] = await Promise.all([
    prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } }),
    prisma.barberService.create({ data: { barbershopId: shopId, name: "Paquete novio", durationMin: 120, price: new Prisma.Decimal(2000) } }),
  ]);
  corte = s1.id; paquete = s2.id;
  await openCashSession(ctx, { openingAmount: 0 });

  const b = await makeShop("B");
  ctxB = b.ctx;
  barberB = (await prisma.barber.create({ data: { barbershopId: b.shop.id, name: "Ajeno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("primer corte ($180 + $0.01 de propina, 50 %): a pagar $90.01, pagado $0", { skip }, async () => {
  await sale(uno, corte, 0.01);
  const { row } = await rowOf(uno);
  assert.equal(row.commissionPending, 90);
  assert.equal(row.tipsPending, 0.01);
  assert.equal(row.totalToPay, 90.01);
  assert.equal(row.paidTotal, 0);
  assert.equal(row.periodTotal, 90.01);
  assert.equal(row.paidStatus, "PENDING");
});

test("marcar pagado cubre exactamente lo que decía «A pagar»; después queda en $0", { skip }, async () => {
  const before = (await rowOf(uno)).row;
  const paid = await markCommissionsPaid(ctx, { barberId: uno, periodKey: PERIOD, expectedTotal: before.totalToPay });
  assert.equal(paid.marked, 1);
  assert.equal(paid.paidAmount, 90.01, "el pago = la cifra de la tabla y del diálogo");

  const { row } = await rowOf(uno);
  assert.equal(row.totalToPay, 0);
  assert.equal(row.paidTotal, 90.01);
  assert.equal(row.tipsPaid, 0.01, "la propina de ese ticket también quedó pagada");
  assert.equal(row.tipsPending, 0);
  assert.equal(row.paidStatus, "PAID");
});

test("otro corte con $10 de propina: a pagar $100.00 (no $190.01) y ya pagado $90.01, igual en tabla, recibo y detalle", { skip }, async () => {
  await sale(uno, corte, 10);
  const { row, totals } = await rowOf(uno);
  assert.equal(row.totalToPay, 100, "comisión $90 + propina $10 del ticket nuevo");
  assert.equal(row.paidTotal, 90.01);
  assert.equal(row.periodTotal, 190.01, "el total del periodo se sigue viendo, pero aparte");
  assert.equal(row.commissionPending, 90);
  assert.equal(row.tipsPending, 10);
  assert.equal(row.paidStatus, "PARTIAL");
  assert.equal(totals.totalToPay, 100 + (await rowOf(dos)).row.totalToPay + (await rowOf(tres)).row.totalToPay);

  // El recibo sale de la MISMA fila.
  const receipt = await getCommissionReceipt(ctx, { barberId: uno, periodKey: PERIOD });
  assert.equal(receipt!.row.totalToPay, 100);
  assert.equal(receipt!.row.paidTotal, 90.01);

  // Y el detalle por ticket suma lo mismo: solo las entradas sin pagar.
  const entries = await getCommissionEntries(ctx, { barberId: uno, periodKey: PERIOD });
  const pendingSum = entries.filter((e) => !e.paidAt).reduce((s, e) => s + e.amount + (e.saleTip ?? 0), 0);
  const paidSum = entries.filter((e) => e.paidAt).reduce((s, e) => s + e.amount + (e.saleTip ?? 0), 0);
  assert.equal(Math.round(pendingSum * 100) / 100, 100);
  assert.equal(Math.round(paidSum * 100) / 100, 90.01);
});

test("si la cifra cambió mientras el diálogo estaba abierto, no se marca nada", { skip }, async () => {
  await assert.rejects(
    markCommissionsPaid(ctx, { barberId: uno, periodKey: PERIOD, expectedTotal: 90 }),
    codeIs("PAYOUT_CHANGED"),
  );
  assert.equal((await rowOf(uno)).row.totalToPay, 100, "sigue pendiente");
});

test("marcar pagado dos veces (y dos personas a la vez) no paga doble", { skip }, async () => {
  const results = await Promise.all([
    markCommissionsPaid(ctx, { barberId: uno, periodKey: PERIOD }),
    markCommissionsPaid(ctx, { barberId: uno, periodKey: PERIOD }),
    markCommissionsPaid(ctx, { barberId: uno, periodKey: PERIOD }),
  ]);
  assert.equal(results.reduce((s, r) => s + r.marked, 0), 1, "el ticket pendiente se marca una sola vez");
  assert.equal(
    Math.round(results.reduce((s, r) => s + r.paidAmount, 0) * 100) / 100,
    100,
    "entre los tres pagos se pagan $100, no $300",
  );

  const again = await markCommissionsPaid(ctx, { barberId: uno, periodKey: PERIOD });
  assert.deepEqual({ marked: again.marked, paidAmount: again.paidAmount }, { marked: 0, paidAmount: 0 });

  const { row } = await rowOf(uno);
  assert.equal(row.totalToPay, 0);
  assert.equal(row.paidTotal, 190.01);
  assert.equal(row.paidStatus, "PAID");
});

test("un ticket ya pagado al barbero no se cancela; uno pendiente sí, y deja de deberse", { skip }, async () => {
  const s = await sale(uno, corte, 5);
  assert.equal((await rowOf(uno)).row.totalToPay, 95);
  await cancelSale(ctx, s.id, { reason: "se cobró mal" });
  const { row } = await rowOf(uno);
  assert.equal(row.totalToPay, 0);
  assert.equal(row.paidTotal, 190.01);
});

test("renta de silla $1,500: se descuenta en el primer pago y no vuelve a restarse", { skip }, async () => {
  await sale(dos, paquete, 50);
  let { row } = await rowOf(dos);
  assert.equal(row.totalToPay, 550, "$2,000 + $50 de propina − $1,500 de renta");
  assert.equal(row.chairRentPending, 1500);
  assert.equal(row.chairRentDiscounted, false);
  assert.equal(row.paidTotal, 0);

  const paid = await markCommissionsPaid(ctx, { barberId: dos, periodKey: PERIOD, expectedTotal: 550 });
  assert.equal(paid.paidAmount, 550);

  await sale(dos, corte, 0);
  ({ row } = await rowOf(dos));
  assert.equal(row.totalToPay, 180, "solo el ticket nuevo: la renta ya se descontó");
  assert.equal(row.chairRentPending, 0);
  assert.equal(row.chairRentDiscounted, true);
  assert.equal(row.paidTotal, 550);
  assert.equal(row.periodTotal, 730, "2,180 + 50 − 1,500");
  assert.equal(row.paidStatus, "PARTIAL");
});

test("sueldo fijo: se le deben solo las propinas de tickets sin pagar", { skip }, async () => {
  await sale(tres, corte, 40);
  let { row } = await rowOf(tres);
  assert.equal(row.commissionTotal, 0);
  assert.equal(row.totalToPay, 40);
  assert.equal(row.paidStatus, "PENDING");
  await markCommissionsPaid(ctx, { barberId: tres, periodKey: PERIOD, expectedTotal: 40 });
  await sale(tres, corte, 15);
  ({ row } = await rowOf(tres));
  assert.equal(row.totalToPay, 15);
  assert.equal(row.paidTotal, 40);
});

test("no se paga a un barbero de otra barbería ni desde otra barbería", { skip }, async () => {
  await assert.rejects(markCommissionsPaid(ctx, { barberId: barberB, periodKey: PERIOD }), codeIs("BARBER_NOT_FOUND"));
  await sale(uno, corte, 0);
  await assert.rejects(markCommissionsPaid(ctxB, { barberId: uno, periodKey: PERIOD }), codeIs("BARBER_NOT_FOUND"));
  assert.equal((await rowOf(uno)).row.totalToPay, 90, "lo de A sigue pendiente");
});
