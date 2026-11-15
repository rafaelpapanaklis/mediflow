// RONDA 4 · M9 (revisora ws6-t3, ronda 6): «Producido» es LO MISMO en todas
// partes.
//
// Lo producido por un barbero es el valor de su trabajo. El anticipo aplicado
// al cobrar una cita es una FORMA DE PAGO (la otra parte ya se cobró en el
// mostrador), no un descuento. Antes del arreglo, Reportes → Por barbero y
// «Tu producción de hoy» sumaban el subtotal del ticket (ya con el anticipo
// restado) y Comisiones no:
//
//   Barbero Cuatro, al 50 %, tres cortes de $180:
//     1. cita con anticipo de $100  → ticket de $80
//     2. cubierto por membresía     → ticket de $0 (base de comisión $180)
//     3. normal, con $10 de propina → ticket de $180
//   Comisiones:            Producido $360 · Comisión $270
//   Reportes por barbero:  Producido $260  ← mal (comisión MAYOR que lo producido)
//   Inicio del barbero:    «Tu producción de hoy» $260  ← mal
//
// Y los ingresos de la barbería NO se mueven: $860 ese día (membresía $500 +
// anticipo $100 + $80 + $0 + $180), $10 de propinas, $870 cobrados.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/producido-igual-integration.test.ts
//
// Solo corre contra una base LOCAL: crea y borra una barbería (_base-local.ts).
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { currentPeriodKey, getCommissionSummary } from "@/lib/barber/commissions";
import { createSale, getCashState, openCashSession } from "@/lib/barber/cash";
import { sellMembership } from "@/lib/barber/memberships";
import { markDepositPaidManually } from "@/lib/barber/payments";
import { getInicioSummary, getReportsSummary } from "@/lib/barber/stats";

const RUN = `p${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const TZ = "America/Mexico_City";
const PERIOD = currentPeriodKey(TZ);
const MIN = 60_000;
const DAY = 86_400_000;
const money = (n: number) => new Prisma.Decimal(n);

let shopId = "";
let owner: BarberContext; // dueña: ve toda la barbería
let asCuatro: BarberContext; // rol Barbero: solo ve lo suyo
let cuatro = "";
let otro = "";

before(async () => {
  if (!HAS_DB) return;
  const shop = await prisma.barbershop.create({
    data: { name: "Barbería Ronda 4", slug: `${RUN}-r4`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ },
  });
  shopId = shop.id;
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "R4", role: "OWNER" },
  });
  owner = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber: null, role: "OWNER" };

  const barberCuatro = await prisma.barber.create({
    data: { barbershopId: shopId, name: "Cuatro", commissionType: "COMMISSION", commissionPct: money(50) },
  });
  cuatro = barberCuatro.id;
  otro = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Otro", commissionType: "COMMISSION", commissionPct: money(50) } })).id;
  const userCuatro = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-cuatro`, email: `${RUN}-cuatro@test.local`, firstName: "Cuatro", lastName: "R4", role: "BARBER" },
  });
  asCuatro = { barberUserId: userCuatro.id, barbershopId: shopId, barbershop: shop, user: userCuatro, barber: barberCuatro, role: "BARBER" };

  const corte = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: money(180) } })).id;
  const tel = Date.now().toString().slice(-7);
  const conCita = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Cliente con cita", phone: `551${tel}` } })).id;
  const socio = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Cliente socio", phone: `552${tel}` } })).id;
  const plan = await prisma.barberMembership.create({
    data: { barbershopId: shopId, name: "4 cortes", price: money(500), includedCuts: 4, periodDays: 30 },
  });

  await openCashSession(owner, { openingAmount: 500 });

  // Membresía de $500 en efectivo → ticket de mostrador (sin barbero).
  await sellMembership({ barbershopId: shopId, clientId: socio, membershipId: plan.id, paymentMethod: "CASH", soldByUserId: user.id });

  // 1 · Cita de $180 con anticipo de $100 cobrado en el mostrador → al cobrarla quedan $80.
  const start = new Date(Date.now() + DAY);
  const appt = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, clientId: conCita, barberId: cuatro, status: "CONFIRMED",
      startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId: corte, priceAtBooking: money(180) }] },
    },
  });
  await markDepositPaidManually({ barbershopId: shopId, appointmentId: appt.id, amount: 100, paymentMethod: "CASH", soldByUserId: user.id });
  await prisma.barberAppointment.update({ where: { id: appt.id }, data: { status: "DONE" } });
  const conAnticipo = await createSale(owner, { appointmentId: appt.id, items: [{ kind: "service", id: corte }], paymentMethod: "CASH" }, FEATURES);
  assert.equal(conAnticipo.total, 80, "180 − 100 de anticipo");

  // 2 · Corte cubierto por la membresía → ticket de $0.
  const cubierto = await createSale(
    owner,
    { clientId: socio, barberId: cuatro, items: [{ kind: "service", id: corte }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  assert.equal(cubierto.total, 0);

  // 3 · Corte normal de $180 con $10 de propina.
  await createSale(owner, { barberId: cuatro, items: [{ kind: "service", id: corte }], tip: 10, paymentMethod: "CASH" }, FEATURES);
});

after(async () => {
  if (!HAS_DB || !shopId) return;
  const w = { barbershopId: shopId };
  await prisma.barberCommissionEntry.deleteMany({ where: w });
  await prisma.barberSaleItem.deleteMany({ where: { sale: w } });
  await prisma.barberSale.deleteMany({ where: w });
  await prisma.barberCashSession.deleteMany({ where: w });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: w } });
  await prisma.barberAppointment.deleteMany({ where: w });
  await prisma.barberClientMembership.deleteMany({ where: w });
  await prisma.barberMembership.deleteMany({ where: w });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("Comisiones (la referencia): Cuatro produjo $360 y su comisión es $270", { skip }, async () => {
  const row = (await getCommissionSummary(owner, PERIOD)).rows.find((r) => r.barberId === cuatro)!;
  assert.equal(row.produced, 360, "180 de la cita (80 cobrados + 100 de anticipo) + 0 del cubierto + 180");
  assert.equal(row.commissionBase, 540, "los tres cortes a precio normal");
  assert.equal(row.commissionTotal, 270);
  assert.equal(row.tips, 10);
});

test("Reportes → Por barbero dice lo mismo que Comisiones: Producido $360 (no $260)", { skip }, async () => {
  const comisiones = (await getCommissionSummary(owner, PERIOD)).rows.find((r) => r.barberId === cuatro)!;
  const r = await getReportsSummary(owner, { range: "today", features: FEATURES });
  const fila = r.byBarber.find((b) => b.barberId === cuatro)!;
  assert.equal(fila.produced, 360);
  assert.equal(fila.produced, comisiones.produced, "la MISMA cifra que Comisiones");
  assert.equal(fila.tickets, 3);
  assert.equal(fila.avgTicket, 120, "360 / 3");
  assert.equal(fila.tips, 10);
  assert.equal(fila.commission, 270);
  const sinTrabajo = r.byBarber.find((b) => b.barberId === otro)!;
  assert.equal(sinTrabajo.produced, 0, "el anticipo no se le cuelga a nadie más");
});

test("Inicio del barbero: «Tu producción de hoy» $360, igual que Comisiones", { skip }, async () => {
  const s = await getInicioSummary(asCuatro, { features: FEATURES });
  assert.equal(s.scope.selfOnly, true);
  assert.equal(s.today.produced, 360);
  assert.equal(s.today.tickets, 3);
  assert.equal(s.today.tips, 10);
  const comisiones = (await getCommissionSummary(asCuatro, PERIOD)).rows.find((r) => r.barberId === cuatro)!;
  assert.equal(s.today.produced, comisiones.produced);
});

test("El mismo barbero en Reportes (rol Barbero) también ve Producido $360", { skip }, async () => {
  const r = await getReportsSummary(asCuatro, { range: "today", features: FEATURES });
  assert.equal(r.byBarber.length, 1, "solo se ve a sí mismo");
  assert.equal(r.byBarber[0].produced, 360);
});

test("Los ingresos de la barbería NO se mueven: $860 de ingreso, $10 de propinas, $870 cobrados", { skip }, async () => {
  const inicio = await getInicioSummary(owner, { features: FEATURES });
  assert.equal(inicio.today.revenue, 860, "membresía 500 + anticipo 100 + 80 + 0 + 180");
  assert.equal(inicio.today.tips, 10);
  assert.equal(inicio.today.total, 870);
  assert.equal(inicio.today.tickets, 5);
  assert.equal(inicio.today.avgTicket, 172, "860 / 5: el ticket promedio de la barbería tampoco cambia");
  assert.equal(inicio.today.produced, 360, "lo producido por los barberos: los tickets de mostrador no son de nadie");

  const r = await getReportsSummary(owner, { range: "today", features: FEATURES });
  assert.equal(r.totals.revenue, 860);
  assert.equal(r.totals.tips, 10);
  assert.equal(r.totals.total, 870);
  assert.equal(r.totals.tickets, 5);
  assert.equal(r.totals.services, 360, "los servicios a su precio: 180 + 0 + 180");
  assert.equal(r.totals.other, 500, "membresías y anticipos: 500 + 100 recibido − 100 ya aplicado a la cita");
  assert.equal(r.totals.discounts, 0, "el anticipo aplicado no es un descuento");

  const caja = (await getCashState(owner)).open!;
  assert.equal(caja.session.salesTotal, 860);
  assert.equal(caja.expectedCash, 1370, "fondo 500 + 870 en efectivo");
});
