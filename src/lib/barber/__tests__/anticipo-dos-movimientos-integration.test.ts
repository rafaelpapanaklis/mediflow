// D2 de Rafael (15-nov-2026): «debe estar el ticket con el pago del anticipo
// y luego que fue reembolsado, o sea ambos movimientos».
//
// Un anticipo de $100 cobrado en mostrador y luego devuelto son DOS
// movimientos, con el mismo conteo en Caja, Inicio y Reportes, y los dos se
// ven en la ficha del cliente con su nombre (Anticipo +$100, Devolución −$100).
// El ingreso neto cuadra al centavo: +100 − 100 = 0.
//
// En panel.108 (QA B, 15-nov) el mismo día Caja decía 9 tickets e Inicio y
// Reportes 8: la devolución no contaba fuera de Caja.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/anticipo-dos-movimientos-integration.test.ts
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const PRO = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const RUN = `ant2${Date.now().toString(36)}`;

let prisma: typeof import("@/lib/prisma")["prisma"];
let shopId: string;
let ctx: BarberContext;
let clientId: string;

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  const cash = await import("@/lib/barber/cash");
  const pay = await import("@/lib/barber/payments");
  const shop = await prisma.barbershop.create({ data: { name: "Barbería Anticipos", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" } });
  shopId = shop.id;
  const user = await prisma.barberUser.create({ data: { barbershopId: shopId, supabaseId: `${RUN}-o`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "Prueba", role: "OWNER" } });
  ctx = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber: null, role: "OWNER" };
  clientId = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: `Cliente ${RUN}`, phone: "5512340000" } })).id;
  const svc = await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } });
  const start = new Date(Date.now() + 2 * 86_400_000);
  const appt = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, clientId, clientName: "Cliente", clientPhone: "5512340000", status: "CONFIRMED",
      startAt: start, endAt: new Date(start.getTime() + 1_800_000),
      services: { create: [{ serviceId: svc.id, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  await cash.openCashSession(ctx, { openingAmount: 0 });
  await pay.markDepositPaidManually({ barbershopId: shopId, appointmentId: appt.id, amount: 100, paymentMethod: "CASH", soldByUserId: user.id });
  await pay.refundDeposit({ barbershopId: shopId, appointmentId: appt.id, actorName: "Dueña", actorUserId: user.id });
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: shopId } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberClient.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberService.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("🔴 Caja, Inicio y Reportes cuentan los DOS movimientos, y el ingreso neto es $0", { skip }, async () => {
  const cash = await import("@/lib/barber/cash");
  const stats = await import("@/lib/barber/stats");
  const caja = await cash.getCashState(ctx);
  assert.equal(caja.open?.session.ticketCount, 2, "Caja: anticipo y devolución");
  assert.equal(caja.open?.session.salesTotal, 0);
  assert.equal(caja.open?.expectedCash, 0, "+100 − 100 en efectivo");
  const ini = await stats.getInicioSummary(ctx, { features: PRO });
  assert.equal(ini.today.tickets, 2, "Inicio: el mismo número que Caja");
  assert.equal(ini.today.revenue, 0);
  assert.equal(ini.cash?.ticketCount ?? 2, 2, "y el recuadro del turno igual");
  const rep = await stats.getReportsSummary(ctx, { range: "today", features: PRO });
  assert.equal(rep.totals.tickets, 2, "Reportes: el mismo número");
  assert.equal(rep.totals.revenue, 0);
  assert.equal(rep.totals.other, 0, "membresías y anticipos: +100 − 100");
});

test("🔴 la ficha del cliente enseña los dos movimientos con su nombre e importe", { skip }, async () => {
  const loyalty = await import("@/lib/barber/loyalty");
  const h = await loyalty.getBarberVisitHistory(ctx, clientId);
  const movs = h.entries.filter((e) => e.kind === "sale").map((e) => [e.movement, e.amount]);
  assert.deepEqual(
    movs.sort((a, b) => Number(b[1]) - Number(a[1])),
    [["deposit", 100], ["refund", -100]],
  );
});
