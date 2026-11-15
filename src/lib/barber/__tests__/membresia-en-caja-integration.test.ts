// Integración contra Postgres REAL — la membresía cobrada en mostrador pasa
// por la caja (G3 de la auditoría ws6-t3).
//
// Antes: vender o renovar una membresía en efectivo, transferencia o tarjeta
// de mostrador solo creaba/extendía la fila de la membresía. El dinero no
// aparecía en el corte, ni en Inicio, ni en Reportes: al cerrar el turno el
// cajón traía $500 de más que nadie podía explicar.
//
// Ahora, con números:
//   fondo $500 + membresía «4 cortes» de $500 en efectivo → esperado $1,000
//   Inicio y Reportes: +$500 de ingreso, 1 ticket, $0 de comisión
//   cancelar ese ticket → esperado $500 y la membresía queda cancelada
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/membresia-en-caja-integration.test.ts
//
// Sin DATABASE_URL se SALTAN. JAMÁS apuntarlas a producción: crean barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BarberCajaError, currentPeriodKey, getCommissionSummary } from "@/lib/barber/commissions";
import { cancelSale, createSale, getCashState, getSaleDetail, openCashSession } from "@/lib/barber/cash";
import { getInicioSummary, getReportsSummary } from "@/lib/barber/stats";
import { BarberMembershipError, renewClientMembership, sellMembership } from "../memberships";
import {
  BARBER_MEMBERSHIP_RENEWAL_LINE_PREFIX,
  BARBER_MEMBERSHIP_SALE_LINE_PREFIX,
  buildSaleTag,
  isCounterTicketLine,
  isMembershipLine,
  parseSaleTag,
  saleKindOf,
  stripSaleTag,
} from "../memberships-core";

// Solo contra una base LOCAL: ver _base-local.ts (crean y borran barberías).
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const RUN = `v${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const DAY = 86_400_000;

interface Shop {
  id: string;
  ctx: BarberContext;
  barberId: string;
  serviceId: string;
  clients: string[];
  planId: string;
}

let A: Shop;
let B: Shop;

async function makeShop(tag: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: { name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${tag}-owner`, email: `${RUN}-${tag}@test.local`, firstName: "Dueña", lastName: tag, role: "OWNER" },
  });
  const barber = await prisma.barber.create({
    data: { barbershopId: shop.id, name: `Barbero ${tag}`, commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) },
  });
  const service = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal("180.00") },
  });
  const clients: string[] = [];
  for (let i = 0; i < 4; i++) {
    const c = await prisma.barberClient.create({
      data: { barbershopId: shop.id, name: `Cliente ${tag}${i}`, phone: `55${Date.now().toString().slice(-6)}${tag === "A" ? 1 : 2}${i}` },
    });
    clients.push(c.id);
  }
  const plan = await prisma.barberMembership.create({
    data: { barbershopId: shop.id, name: "4 cortes", price: new Prisma.Decimal("500.00"), includedCuts: 4, periodDays: 30 },
  });
  return {
    id: shop.id,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    barberId: barber.id,
    serviceId: service.id,
    clients,
    planId: plan.id,
  };
}

const cajaCode = (code: string) => (e: unknown) => e instanceof BarberCajaError && e.code === code;
const memCode = (code: string) => (e: unknown) => e instanceof BarberMembershipError && e.code === code;

const sell = (shop: Shop, clientId: string, paymentMethod: "CASH" | "SPEI" | "CARD" = "CASH") =>
  sellMembership({ barbershopId: shop.id, clientId, membershipId: shop.planId, paymentMethod, soldByUserId: shop.ctx.barberUserId });

async function cash(shop: Shop) {
  const state = await getCashState(shop.ctx);
  assert.ok(state.open, "hay turno abierto");
  return state.open!;
}

const membership = (id: string) => prisma.barberClientMembership.findUniqueOrThrow({ where: { id } });

before(async () => {
  if (!HAS_DB) return;
  A = await makeShop("A");
  B = await makeShop("B");
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberClientMembership.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberMembership.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════
// 0. El sello del ticket (puro, sin base)
// ═══════════════════════════════════════════════════════════════════════

test("el sello del ticket: se escribe, se lee aun con la marca de cancelación delante y nunca se enseña", () => {
  const tag = buildSaleTag({ k: "membership", op: "sell", cm: "cm_1", end: "2026-12-14T00:00:00.000Z" });
  assert.deepEqual(parseSaleTag(tag), { k: "membership", op: "sell", cm: "cm_1", end: "2026-12-14T00:00:00.000Z" });
  const cancelled = `[CANCELADA] 2026-11-14 · Dueña · dedazo · Original: …\n${tag}`;
  assert.equal(parseSaleTag(cancelled)?.k, "membership");
  assert.equal(stripSaleTag(tag), null, "un ticket de mostrador no tiene nota visible");
  assert.equal(stripSaleTag(cancelled), "[CANCELADA] 2026-11-14 · Dueña · dedazo · Original: …");
  assert.equal(stripSaleTag("cliente frecuente"), "cliente frecuente");
  assert.equal(saleKindOf("cliente frecuente"), "sale");
  assert.equal(saleKindOf(buildSaleTag({ k: "deposit", appt: "a1" })), "deposit");
  // Una renovación sin el estado anterior no es un sello válido.
  assert.equal(parseSaleTag('#dcb {"k":"membership","op":"renew","cm":"x","end":"y"}'), null);
  assert.equal(parseSaleTag("#dcb no-es-json"), null);
});

test("la línea «Venta de membresía» no se confunde con un corte cubierto por membresía", () => {
  // Aunque el plan se llame justo como el sufijo de la caja.
  const line = `${BARBER_MEMBERSHIP_SALE_LINE_PREFIX}Club · Membresía`;
  assert.equal(isCounterTicketLine(line), true);
  assert.equal(isMembershipLine(line), false);
  assert.equal(isMembershipLine("Corte · Membresía"), true, "la marca de la caja sigue funcionando");
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Vender: exige turno, crea ticket, entra al corte / Inicio / Reportes
// ═══════════════════════════════════════════════════════════════════════

let soldId: string;
let soldTicket: string;

test("sin turno abierto NO se vende la membresía (ni queda la membresía ni el ticket)", { skip }, async () => {
  await assert.rejects(sell(A, A.clients[0]), memCode("NO_OPEN_SESSION"));
  assert.equal(await prisma.barberClientMembership.count({ where: { barbershopId: A.id } }), 0);
  assert.equal(await prisma.barberSale.count({ where: { barbershopId: A.id } }), 0);
});

test("membresía de $500 en efectivo: ticket «Venta de membresía», esperado $500 → $1,000", { skip }, async () => {
  await openCashSession(A.ctx, { openingAmount: 500 });
  assert.equal((await cash(A)).expectedCash, 500);

  const sold = await sell(A, A.clients[0], "CASH");
  soldId = sold.id;
  soldTicket = sold.saleId;
  assert.equal(sold.status, "ACTIVE");
  assert.equal(sold.paymentMethod, "CASH");

  const open = await cash(A);
  assert.equal(open.expectedCash, 1000, "fondo $500 + membresía $500");
  assert.equal(open.byMethod.CASH.total, 500);
  assert.equal(open.session.ticketCount, 1);
  assert.equal(open.session.salesTotal, 500);

  const ticket = open.sales.find((s) => s.id === soldTicket)!;
  assert.equal(ticket.kind, "membership");
  assert.equal(ticket.total, 500, "el precio sale del plan, no del navegador");
  assert.equal(ticket.tip, 0);
  assert.equal(ticket.clientId, A.clients[0]);
  assert.equal(ticket.barberId, null);
  assert.equal(ticket.appointmentId, null);
  assert.equal(ticket.soldByUserId, A.ctx.barberUserId);
  assert.equal(ticket.items.length, 1);
  assert.equal(ticket.items[0].description, `${BARBER_MEMBERSHIP_SALE_LINE_PREFIX}4 cortes`);
  assert.equal(ticket.items[0].serviceId, null);
  assert.equal(ticket.notes, null, "el sello interno no se enseña");

  const detail = await getSaleDetail(A.ctx, soldTicket);
  assert.equal(detail!.grossItems, 500);
  assert.equal(detail!.discount, 0);
});

test("la venta de una membresía NO le genera comisión a ningún barbero", { skip }, async () => {
  assert.equal(await prisma.barberCommissionEntry.count({ where: { barbershopId: A.id } }), 0);
  const summary = await getCommissionSummary(A.ctx, currentPeriodKey("America/Mexico_City"));
  assert.equal(summary.totals.commissionTotal, 0);
  assert.equal(summary.totals.produced, 0, "no se le atribuye producción a nadie");
  assert.ok(summary.rows.every((r) => r.ticketCount === 0 && r.totalToPay === 0));
});

test("aparece en Inicio y en Reportes: +$500 de ingreso con 1 ticket", { skip }, async () => {
  const inicio = await getInicioSummary(A.ctx, { features: FEATURES });
  assert.equal(inicio.today.revenue, 500);
  assert.equal(inicio.today.tickets, 1);
  assert.equal(inicio.cash?.expectedCash, 1000);

  const reportes = await getReportsSummary(A.ctx, { range: "today", features: FEATURES });
  assert.equal(reportes.totals.revenue, 500);
  assert.equal(reportes.totals.tickets, 1);
  assert.equal(reportes.totals.total, 500);
  assert.equal(reportes.totals.discounts, 0, "no se disfraza de descuento");
  // Ronda 3 · M3: tampoco se mete dentro de «Servicios».
  assert.equal(reportes.totals.services, 0, "una membresía no es un servicio");
  assert.equal(reportes.totals.other, 500, "va en «Membresías y anticipos»");
});

test("Reportes: un corte de $180 y una membresía de $500 el mismo día → Servicios $180 y Membresías y anticipos $500 (no «Servicios $680»)", { skip }, async () => {
  const cut = await createSale(A.ctx, { barberId: A.barberId, items: [{ kind: "service", id: A.serviceId }], discount: 20, paymentMethod: "CARD" }, FEATURES);
  const r = await getReportsSummary(A.ctx, { range: "today", features: FEATURES });
  assert.equal(r.totals.services, 160, "$180 − $20 de descuento");
  assert.equal(r.totals.discounts, 20);
  assert.equal(r.totals.other, 500);
  assert.equal(r.totals.products, 0);
  assert.equal(r.totals.revenue, 660);
  assert.equal(r.totals.services + r.totals.products + r.totals.other, r.totals.revenue, "los tres renglones suman el ingreso");
  const today = r.byDay.find((d) => d.tickets > 0)!;
  assert.deepEqual(
    { services: today.services, other: today.other, revenue: today.revenue },
    { services: 160, other: 500, revenue: 660 },
  );
  // Se deja el turno como estaba para las pruebas que siguen.
  await cancelSale(A.ctx, cut.id, { reason: "solo era para el reporte" });
});

test("tarjeta de mostrador y transferencia caen en su método, no en el efectivo", { skip }, async () => {
  await sell(A, A.clients[1], "CARD");
  await sell(A, A.clients[2], "SPEI");
  const open = await cash(A);
  assert.equal(open.byMethod.CARD.total, 500);
  assert.equal(open.byMethod.SPEI.total, 500);
  assert.equal(open.byMethod.CASH.total, 500);
  assert.equal(open.expectedCash, 1000, "solo el efectivo está en el cajón");
  assert.equal(open.session.salesTotal, 1500);
});

test("dos clics a la vez sobre el mismo cliente: una sola membresía y un solo ticket", { skip }, async () => {
  const before = await prisma.barberSale.count({ where: { barbershopId: A.id } });
  const results = await Promise.allSettled([sell(A, A.clients[3]), sell(A, A.clients[3]), sell(A, A.clients[3])]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    (results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).every((r) => memCode("ALREADY_ACTIVE")(r.reason)),
  );
  assert.equal(await prisma.barberClientMembership.count({ where: { barbershopId: A.id, clientId: A.clients[3] } }), 1);
  assert.equal(await prisma.barberSale.count({ where: { barbershopId: A.id } }), before + 1);
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Cancelar el ticket revierte la membresía
// ═══════════════════════════════════════════════════════════════════════

test("con un corte ya cubierto no se cancela la venta; cancelando primero ese ticket, sí", { skip }, async () => {
  // El cliente usa su membresía: corte de $180 cubierto → $0.
  const use = await createSale(
    A.ctx,
    { clientId: A.clients[0], barberId: A.barberId, items: [{ kind: "service", id: A.serviceId }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  assert.equal(use.total, 0);
  assert.equal((await membership(soldId)).cutsUsed, 1);

  await assert.rejects(cancelSale(A.ctx, soldTicket, { reason: "se arrepintió" }), cajaCode("MEMBERSHIP_IN_USE"));
  assert.equal((await membership(soldId)).status, "ACTIVE", "nada cambió");
  assert.equal((await cash(A)).expectedCash, 1500, "el dinero sigue en el corte (2 ventas en efectivo + fondo)");

  await cancelSale(A.ctx, use.id, { reason: "se cobró mal" });
  assert.equal((await membership(soldId)).cutsUsed, 0, "cancelar el corte cubierto devuelve el cupo");
});

test("cancelar el ticket de la venta: la membresía queda cancelada y los $500 salen del corte", { skip }, async () => {
  const before = (await cash(A)).expectedCash;
  const cancelled = await cancelSale(A.ctx, soldTicket, { reason: "se arrepintió" });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.kind, "membership", "sigue sabiéndose qué era");
  assert.equal(cancelled.total, 0);

  assert.equal((await cash(A)).expectedCash, before - 500);
  const m = await membership(soldId);
  assert.equal(m.status, "CANCELLED");

  // Sin membresía vigente, se le puede vender otra vez.
  const again = await sell(A, A.clients[0], "CASH");
  assert.notEqual(again.id, soldId);
  assert.equal((await cash(A)).expectedCash, before);
  soldId = again.id;
  soldTicket = again.saleId;
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Renovar: también es un cobro, y cancelarlo deja todo como estaba
// ═══════════════════════════════════════════════════════════════════════

test("renovar por transferencia: ticket «Renovación de membresía» de $500; cancelarlo restaura fechas, cupo, estado y método", { skip }, async () => {
  // La membresía lleva 2 cortes usados y le quedan 5 días.
  const start = new Date(Date.now() - 25 * DAY);
  const end = new Date(Date.now() + 5 * DAY);
  await prisma.barberClientMembership.update({ where: { id: soldId }, data: { cutsUsed: 2, startAt: start, endAt: end } });
  const before = await cash(A);

  const renewed = await renewClientMembership({
    barbershopId: A.id, clientMembershipId: soldId, paymentMethod: "SPEI", soldByUserId: A.ctx.barberUserId,
  });
  assert.equal(renewed.cutsUsed, 0);
  assert.equal(renewed.paymentMethod, "SPEI");
  assert.equal(new Date(renewed.endAt).getTime(), end.getTime() + 30 * DAY, "se encadena al periodo actual");

  const afterRenew = await cash(A);
  assert.equal(afterRenew.byMethod.SPEI.total, before.byMethod.SPEI.total + 500);
  assert.equal(afterRenew.expectedCash, before.expectedCash, "la transferencia no está en el cajón");
  const ticket = afterRenew.sales.find((s) => s.id === renewed.saleId)!;
  assert.equal(ticket.kind, "membership");
  assert.equal(ticket.items[0].description, `${BARBER_MEMBERSHIP_RENEWAL_LINE_PREFIX}4 cortes`);
  assert.equal(await prisma.barberCommissionEntry.count({ where: { saleId: renewed.saleId } }), 0);

  // Con la renovación encima, el ticket de la venta original ya no se cancela.
  await assert.rejects(cancelSale(A.ctx, soldTicket, { reason: "tarde" }), cajaCode("MEMBERSHIP_CHANGED"));

  await cancelSale(A.ctx, renewed.saleId, { reason: "no pagó la transferencia" });
  const m = await membership(soldId);
  assert.equal(m.endAt.getTime(), end.getTime(), "vuelve al vencimiento anterior");
  assert.equal(m.startAt.getTime(), start.getTime());
  assert.equal(m.cutsUsed, 2, "y a los cortes que ya llevaba");
  assert.equal(m.status, "ACTIVE");
  assert.equal(m.paymentMethod, "CASH");
  assert.equal((await cash(A)).byMethod.SPEI.total, before.byMethod.SPEI.total);
});

test("renovar exige método de pago y turno abierto", { skip }, async () => {
  await assert.rejects(
    renewClientMembership({ barbershopId: A.id, clientMembershipId: soldId, paymentMethod: undefined as never, soldByUserId: A.ctx.barberUserId }),
    memCode("PAYMENT_METHOD_REQUIRED"),
  );
  // B no tiene turno abierto.
  const mB = await prisma.barberClientMembership.create({
    data: { barbershopId: B.id, clientId: B.clients[0], membershipId: B.planId, status: "ACTIVE", endAt: new Date(Date.now() + 3 * DAY) },
  });
  await assert.rejects(
    renewClientMembership({ barbershopId: B.id, clientMembershipId: mB.id, paymentMethod: "CASH", soldByUserId: B.ctx.barberUserId }),
    memCode("NO_OPEN_SESSION"),
  );
  const same = await membership(mB.id);
  assert.equal(same.endAt.getTime(), mB.endAt.getTime(), "sin turno no se extiende ni un día");
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Aislamiento
// ═══════════════════════════════════════════════════════════════════════

test("la barbería B no vende con planes ni clientes de A, ni cancela ni renueva lo de A", { skip }, async () => {
  await openCashSession(B.ctx, { openingAmount: 0 });
  await assert.rejects(
    sellMembership({ barbershopId: B.id, clientId: A.clients[1], membershipId: B.planId, paymentMethod: "CASH", soldByUserId: B.ctx.barberUserId }),
    memCode("CLIENT_NOT_FOUND"),
  );
  await assert.rejects(
    sellMembership({ barbershopId: B.id, clientId: B.clients[1], membershipId: A.planId, paymentMethod: "CASH", soldByUserId: B.ctx.barberUserId }),
    memCode("PLAN_NOT_FOUND"),
  );
  await assert.rejects(
    renewClientMembership({ barbershopId: B.id, clientMembershipId: soldId, paymentMethod: "CASH", soldByUserId: B.ctx.barberUserId }),
    memCode("NOT_FOUND"),
  );
  await assert.rejects(cancelSale(B.ctx, soldTicket, { reason: "ajeno" }), cajaCode("SALE_NOT_FOUND"));
  const openB = await cash(B);
  assert.equal(openB.session.ticketCount, 0);
  assert.equal(openB.expectedCash, 0);
});
