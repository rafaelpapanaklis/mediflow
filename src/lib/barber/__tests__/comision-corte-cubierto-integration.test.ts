// RONDA 2 (A) — decisión de Rafael, 14-nov-2026: un corte pagado con
// membresía o gratis por lealtad SÍ le genera comisión al barbero, calculada
// sobre el precio normal del servicio.
//
// Antes: la línea cubierta valía $0, así que la base de comisión era $0 y el
// barbero no ganaba nada por un corte que sí hizo.
//
// Lo que tiene que ser verdad:
//   · corte de $180 cubierto, barbero al 50 % → ticket $0, comisión $90;
//   · el ingreso de la barbería NO cambia (ticket, corte del turno y
//     Reportes siguen en $0 por ese corte);
//   · Comisiones y el recibo lo enseñan (base $180 y la marca de «cubierto»).
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/comision-corte-cubierto-integration.test.ts
//
// Sin DATABASE_URL se SALTA. JAMÁS apuntarla a producción: crea barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  currentPeriodKey,
  getCommissionEntries,
  getCommissionReceipt,
  getCommissionSummary,
} from "@/lib/barber/commissions";
import { cancelSale, createSale, getCashState, openCashSession } from "@/lib/barber/cash";
import { getReportsSummary } from "@/lib/barber/stats";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const RUN = `k${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const TZ = "America/Mexico_City";
const PERIOD = currentPeriodKey(TZ);
const DAY = 86_400_000;
const MIN = 60_000;

let ctx: BarberContext;
let shopId: string;
let uno: string; // comisión 50 %
let dos: string; // renta de silla $1,500
let tres: string; // sueldo fijo
let corte: string; // $180
let barba: string; // $140
let socio: string; // cliente con membresía de 8 cortes
let fiel: string; // cliente con 10 visitas (premio listo)
let membershipId: string;

const entryOf = (saleId: string) => prisma.barberCommissionEntry.findFirstOrThrow({ where: { saleId } });

async function rowOf(barberId: string) {
  const summary = await getCommissionSummary(ctx, PERIOD);
  return summary.rows.find((r) => r.barberId === barberId)!;
}

async function money() {
  const open = (await getCashState(ctx)).open!;
  const report = await getReportsSummary(ctx, { range: "today", features: FEATURES });
  return { expectedCash: open.expectedCash, salesTotal: open.session.salesTotal, revenue: report.totals.revenue };
}

before(async () => {
  if (!HAS_DB) return;
  const shop = await prisma.barbershop.create({
    data: { name: "Barbería Ronda 2A", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "R2", role: "OWNER" },
  });
  shopId = shop.id;
  ctx = { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" };

  uno = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  dos = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Dos", commissionType: "CHAIR_RENT", chairRent: new Prisma.Decimal(1500) } })).id;
  tres = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Tres", commissionType: "SALARY" } })).id;
  corte = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  barba = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Barba", durationMin: 20, price: new Prisma.Decimal(140) } })).id;

  socio = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Cliente Socio", phone: `553${Date.now().toString().slice(-7)}` } })).id;
  const plan = await prisma.barberMembership.create({
    data: { barbershopId: shopId, name: "8 cortes", price: new Prisma.Decimal(900), includedCuts: 8, periodDays: 30 },
  });
  membershipId = (
    await prisma.barberClientMembership.create({
      data: { barbershopId: shopId, clientId: socio, membershipId: plan.id, status: "ACTIVE", endAt: new Date(Date.now() + 20 * DAY), cutsUsed: 0 },
    })
  ).id;

  fiel = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Cliente Fiel", phone: `554${Date.now().toString().slice(-7)}` } })).id;
  for (let i = 0; i < 10; i++) {
    const start = new Date(Date.now() - (20 + i) * DAY);
    await prisma.barberAppointment.create({
      data: { barbershopId: shopId, clientId: fiel, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN) },
    });
  }
  await openCashSession(ctx, { openingAmount: 300 });
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: shopId } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberClientMembership.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberMembership.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

let membershipSale: string;

test("corte de $180 cubierto por membresía, barbero al 50 %: ticket $0, comisión $90 — y el ingreso de la barbería no se mueve", { skip }, async () => {
  const before = await money();
  const sale = await createSale(
    ctx,
    { clientId: socio, barberId: uno, items: [{ kind: "service", id: corte }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  membershipSale = sale.id;
  assert.equal(sale.total, 0, "el cliente no paga nada en este ticket");
  assert.equal(sale.subtotal, 0);
  assert.equal(sale.items[0].unitPrice, 0, "la línea del ticket sigue en $0");

  const entry = await entryOf(sale.id);
  assert.equal(entry.base.toFixed(2), "180.00", "base = precio normal del servicio");
  assert.equal(entry.pct?.toFixed(2), "50.00");
  assert.equal(entry.amount.toFixed(2), "90.00");

  assert.deepEqual(await money(), before, "efectivo esperado, vendido del turno e ingreso de Reportes: iguales que antes");
  assert.equal((await prisma.barberClientMembership.findUniqueOrThrow({ where: { id: membershipId } })).cutsUsed, 1);
});

test("Comisiones y el recibo lo enseñan: base $180, a pagar $90 y el ticket marcado como cubierto", { skip }, async () => {
  const row = await rowOf(uno);
  assert.equal(row.commissionBase, 180);
  assert.equal(row.commissionTotal, 90);
  assert.equal(row.totalToPay, 90);
  assert.equal(row.produced, 0, "lo producido (ingreso) sigue en $0: ese dinero entró al vender la membresía");

  const entries = await getCommissionEntries(ctx, { barberId: uno, periodKey: PERIOD });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].coveredCut, true);
  assert.equal(entries[0].base, 180);
  assert.equal(entries[0].amount, 90);
  assert.equal(entries[0].saleTotal, 0);

  const receipt = await getCommissionReceipt(ctx, { barberId: uno, periodKey: PERIOD });
  assert.equal(receipt!.row.totalToPay, 90);
  assert.equal(receipt!.entries[0].coveredCut, true);
});

test("corte gratis por lealtad: ticket $0, comisión sobre el precio normal ($90)", { skip }, async () => {
  const before = await money();
  const sale = await createSale(
    ctx,
    { clientId: fiel, barberId: uno, items: [{ kind: "service", id: corte }], redeemLoyaltyItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  assert.equal(sale.total, 0);
  const entry = await entryOf(sale.id);
  assert.equal(entry.base.toFixed(2), "180.00");
  assert.equal(entry.amount.toFixed(2), "90.00");
  assert.deepEqual(await money(), before, "el ingreso no cambia");
  assert.equal((await rowOf(uno)).totalToPay, 180, "dos cortes cubiertos: $90 + $90");
});

test("cita con precio congelado ($170) cubierta por membresía: comisiona sobre el precio congelado", { skip }, async () => {
  const start = new Date(Date.now() - 60 * MIN);
  const appt = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, clientId: socio, barberId: uno, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId: corte, priceAtBooking: new Prisma.Decimal(170) }] },
    },
  });
  const sale = await createSale(
    ctx,
    { appointmentId: appt.id, items: [{ kind: "service", id: corte }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  assert.equal(sale.total, 0);
  const entry = await entryOf(sale.id);
  assert.equal(entry.base.toFixed(2), "170.00", "el precio normal de ESA cita es el que se congeló al reservar");
  assert.equal(entry.amount.toFixed(2), "85.00");
});

test("ticket mixto: corte cubierto + barba de $140 con $40 de descuento → cobra $100, base $280, comisión $140", { skip }, async () => {
  const before = await money();
  const sale = await createSale(
    ctx,
    {
      clientId: socio, barberId: uno,
      items: [{ kind: "service", id: corte }, { kind: "service", id: barba }],
      membershipItemIndex: 0, discount: 40, tip: 20, paymentMethod: "CASH",
    },
    FEATURES,
  );
  assert.equal(sale.subtotal, 100, "140 − 40; el corte cubierto no se cobra");
  assert.equal(sale.total, 120, "más $20 de propina");
  const entry = await entryOf(sale.id);
  assert.equal(entry.base.toFixed(2), "280.00", "180 (precio normal del corte) + 140 − 40; la propina no entra");
  assert.equal(entry.amount.toFixed(2), "140.00");
  const after = await money();
  assert.equal(after.revenue, before.revenue + 100, "a la barbería le entran solo los $100 cobrados");
  assert.equal(after.expectedCash, before.expectedCash + 120);
});

test("renta de silla y sueldo fijo siguen su esquema: renta = base íntegra ($180), sueldo = $0", { skip }, async () => {
  const chair = await createSale(
    ctx,
    { clientId: socio, barberId: dos, items: [{ kind: "service", id: corte }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  assert.equal(chair.total, 0);
  assert.equal((await entryOf(chair.id)).amount.toFixed(2), "180.00");

  const salary = await createSale(
    ctx,
    { clientId: socio, barberId: tres, items: [{ kind: "service", id: corte }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  const e = await entryOf(salary.id);
  assert.equal(e.base.toFixed(2), "180.00");
  assert.equal(e.amount.toFixed(2), "0.00");
});

test("un corte normal (sin cubrir) comisiona igual que siempre", { skip }, async () => {
  const sale = await createSale(ctx, { barberId: uno, items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, FEATURES);
  assert.equal(sale.total, 180);
  const entry = await entryOf(sale.id);
  assert.equal(entry.base.toFixed(2), "180.00");
  assert.equal(entry.amount.toFixed(2), "90.00");
  const entries = await getCommissionEntries(ctx, { barberId: uno, periodKey: PERIOD });
  assert.equal(entries.find((x) => x.saleId === sale.id)!.coveredCut, false);
});

test("cancelar el ticket cubierto borra su comisión y devuelve el corte a la membresía", { skip }, async () => {
  const before = await rowOf(uno);
  const used = (await prisma.barberClientMembership.findUniqueOrThrow({ where: { id: membershipId } })).cutsUsed;
  await cancelSale(ctx, membershipSale, { reason: "se equivocó de cliente" });
  const after = await rowOf(uno);
  assert.equal(after.totalToPay, before.totalToPay - 90);
  assert.equal(await prisma.barberCommissionEntry.count({ where: { saleId: membershipSale } }), 0);
  assert.equal((await prisma.barberClientMembership.findUniqueOrThrow({ where: { id: membershipId } })).cutsUsed, used - 1);
});
