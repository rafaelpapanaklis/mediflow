// Integración contra Postgres REAL — el anticipo pasa por la caja (G2 de la
// auditoría ws6-t3).
//
// Antes: registrar un anticipo solo marcaba la cita (el dinero no entraba a
// ningún corte) y al cobrar la cita el ticket salía por el total completo:
// cobro doble. Estas pruebas demuestran, con números, lo que ahora es cierto:
//
//   anticipo $100 + corte $180  →  ticket de la cita $80
//   corte del turno: +$100 el día del anticipo (con su método) y +$80 al cobrar
//
// y que se aplica UNA sola vez, que cancelar el ticket lo devuelve a «sin
// aplicar» y que sin turno abierto no se registra nada.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/anticipo-en-caja-integration.test.ts
//
// Sin DATABASE_URL se SALTAN. JAMÁS apuntarlas a producción: crean barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BarberCajaError } from "@/lib/barber/commissions";
import {
  cancelSale,
  closeCashSession,
  createSale,
  getCashState,
  getCheckoutContext,
  getSaleDetail,
  openCashSession,
} from "@/lib/barber/cash";
import { getReportsSummary } from "@/lib/barber/stats";
import {
  BarberPaymentsError,
  forfeitDeposit,
  listDepositCandidates,
  listDeposits,
  markDepositPaidManually,
  refundDeposit,
} from "../payments";
import {
  BARBER_DEPOSIT_LINE_PREFIX,
  BARBER_DEPOSIT_RECEIVED_LINE_PREFIX,
  BARBER_DEPOSIT_REFUND_LINE_PREFIX,
} from "../memberships-core";

// Solo contra una base LOCAL: ver _base-local.ts (crean y borran barberías).
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const RUN = `d${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.AVANZADO.features;
const MIN = 60_000;

interface Shop {
  id: string;
  ctx: BarberContext;
  barberId: string;
  serviceId: string;
  clientId: string;
}

let A: Shop;
let B: Shop;

async function makeShop(tag: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: { name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "AVANZADO", subscriptionStatus: "active", timezone: "America/Mexico_City" },
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
  const client = await prisma.barberClient.create({
    data: { barbershopId: shop.id, name: `Cliente ${tag}`, phone: `55${Date.now().toString().slice(-7)}${tag === "A" ? 1 : 2}` },
  });
  return {
    id: shop.id,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
    barberId: barber.id,
    serviceId: service.id,
    clientId: client.id,
  };
}

/** Cada cita futura cae en su propio hueco: la agenda no admite empalmes. */
let slot = 0;

/** Cita con un corte de $180. `status` por defecto: confirmada, para mañana. */
async function makeAppointment(shop: Shop, opts: { status?: "PENDING" | "CONFIRMED" | "DONE" | "CANCELLED"; inMinutes?: number } = {}) {
  const startAt = new Date(Date.now() + (opts.inMinutes ?? 24 * 60 + slot++ * 45) * MIN);
  const appt = await prisma.barberAppointment.create({
    data: {
      barbershopId: shop.id,
      clientId: shop.clientId,
      barberId: shop.barberId,
      status: opts.status ?? "CONFIRMED",
      startAt,
      endAt: new Date(startAt.getTime() + 30 * MIN),
      services: { create: [{ serviceId: shop.serviceId, priceAtBooking: new Prisma.Decimal("180.00") }] },
    },
  });
  return appt.id;
}

const cajaCode = (code: string) => (e: unknown) => e instanceof BarberCajaError && e.code === code;
const payCode = (code: string) => (e: unknown) => e instanceof BarberPaymentsError && e.code === code;

async function expectedCash(shop: Shop): Promise<number> {
  const state = await getCashState(shop.ctx);
  assert.ok(state.open, "hay turno abierto");
  return state.open!.expectedCash;
}

async function depositOf(appointmentId: string) {
  const a = await prisma.barberAppointment.findUniqueOrThrow({
    where: { id: appointmentId },
    select: { depositAmount: true, depositStatus: true },
  });
  return { amount: a.depositAmount === null ? null : Number(a.depositAmount), status: a.depositStatus };
}

const charge = (shop: Shop, appointmentId: string, extra: Record<string, unknown> = {}) =>
  createSale(shop.ctx, { appointmentId, items: [{ kind: "service", id: shop.serviceId }], paymentMethod: "CASH", ...extra }, FEATURES);

before(async () => {
  if (!HAS_DB) return;
  A = await makeShop("A");
  B = await makeShop("B");
  // La base arranca como está HOY producción: con la restricción vieja de
  // sql/barber_caja.sql (ningún ticket negativo). Así se prueba primero qué
  // pasa ANTES de pegar sql/barber_devolucion_anticipo.sql, y después se
  // aplica ese archivo tal cual. NOT VALID: solo vigila las filas nuevas.
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_sales" DROP CONSTRAINT IF EXISTS "barber_sales_amounts_valid"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_sales" DROP CONSTRAINT IF EXISTS "barber_sales_amounts_nonnegative"`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_amounts_nonnegative" CHECK ("subtotal" >= 0 AND "tip" >= 0 AND "total" >= 0) NOT VALID`,
  );
});

/** Ejecuta un .sql plano del repo, sentencia por sentencia (como al pegarlo). */
async function applySqlFile(rel: string): Promise<number> {
  const raw = fs.readFileSync(path.resolve(__dirname, "../../../..", rel), "utf8");
  const statements = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  return statements.length;
}

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: { in: ids } } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Registrar el anticipo: exige turno y entra al corte con su método
// ═══════════════════════════════════════════════════════════════════════

let apptMain: string;
let depositTicket: string;

test("sin turno abierto NO se registra el anticipo (ni queda marcado en la cita)", { skip }, async () => {
  apptMain = await makeAppointment(A);
  await assert.rejects(
    markDepositPaidManually({ barbershopId: A.id, appointmentId: apptMain, amount: 100, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId }),
    payCode("NO_OPEN_SESSION"),
  );
  assert.deepEqual(await depositOf(apptMain), { amount: null, status: null }, "la cita queda sin anticipo");
  assert.equal(await prisma.barberSale.count({ where: { barbershopId: A.id } }), 0, "no se creó ningún ticket");
});

test("anticipo de $100 en efectivo: ticket «Anticipo recibido», +$100 al efectivo esperado del turno", { skip }, async () => {
  await openCashSession(A.ctx, { openingAmount: 500 });
  assert.equal(await expectedCash(A), 500);

  const out = await markDepositPaidManually({
    barbershopId: A.id, appointmentId: apptMain, amount: "100.00", paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId,
  });
  depositTicket = out.saleId;
  assert.equal(out.amount, 100);

  assert.deepEqual(await depositOf(apptMain), { amount: 100, status: "PAID" });

  const state = await getCashState(A.ctx);
  assert.equal(state.open!.expectedCash, 600, "fondo $500 + anticipo $100");
  assert.equal(state.open!.byMethod.CASH.total, 100);
  assert.equal(state.open!.byMethod.CASH.count, 1);
  assert.equal(state.open!.session.salesTotal, 100, "cuenta como vendido del turno");

  const ticket = state.open!.sales.find((s) => s.id === depositTicket)!;
  assert.equal(ticket.kind, "deposit");
  assert.equal(ticket.total, 100);
  assert.equal(ticket.tip, 0);
  assert.equal(ticket.barberId, null, "sin barbero: no hay comisión ni propina");
  assert.equal(ticket.appointmentId, null, "no es el ticket de la visita: la cita sigue «por cobrar»");
  assert.equal(ticket.clientId, A.clientId);
  assert.equal(ticket.items.length, 1);
  assert.ok(ticket.items[0].description.startsWith(BARBER_DEPOSIT_RECEIVED_LINE_PREFIX));
  assert.equal(ticket.notes, null, "el sello interno no se enseña");
  assert.equal(await prisma.barberCommissionEntry.count({ where: { saleId: depositTicket } }), 0);

  const list = await listDeposits(A.id, { filter: "paid" });
  const row = list.find((d) => d.appointmentId === apptMain)!;
  assert.equal(row.amount, 100);
  assert.equal(row.applied, false, "pagado y todavía sin aplicar");
});

test("no se registra dos veces, ni por más que la cita, ni en una cita cancelada, ni con método inválido", { skip }, async () => {
  await assert.rejects(
    markDepositPaidManually({ barbershopId: A.id, appointmentId: apptMain, amount: 50, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId }),
    payCode("ALREADY_PAID"),
  );
  const other = await makeAppointment(A);
  await assert.rejects(
    markDepositPaidManually({ barbershopId: A.id, appointmentId: other, amount: 180.01, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId }),
    payCode("AMOUNT_TOO_HIGH"),
  );
  await assert.rejects(
    markDepositPaidManually({ barbershopId: A.id, appointmentId: other, amount: 0, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId }),
    payCode("BAD_AMOUNT"),
  );
  await assert.rejects(
    markDepositPaidManually({ barbershopId: A.id, appointmentId: other, amount: 100, paymentMethod: "STRIPE", soldByUserId: A.ctx.barberUserId }),
    payCode("INVALID_PAYMENT_METHOD"),
  );
  const cancelled = await makeAppointment(A, { status: "CANCELLED" });
  await assert.rejects(
    markDepositPaidManually({ barbershopId: A.id, appointmentId: cancelled, amount: 100, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId }),
    payCode("APPOINTMENT_CLOSED"),
  );
  assert.equal(await expectedCash(A), 600, "ningún intento fallido movió el corte");
  assert.deepEqual(await depositOf(other), { amount: null, status: null });
});

test("ANTES de pegar el SQL: devolver sigue funcionando — queda Devuelto, sin ticket, y avisa que no está en el corte", { skip }, async () => {
  const appt = await makeAppointment(A);
  await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 40, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId });
  assert.equal(await expectedCash(A), 640);
  const tickets = await prisma.barberSale.count({ where: { barbershopId: A.id } });

  const res = await refundDeposit({ barbershopId: A.id, appointmentId: appt, actorName: "Dueña A", actorUserId: A.ctx.barberUserId });
  assert.equal(res.status, "REFUNDED");
  assert.equal(res.refundSaleId, undefined, "la base todavía rechaza el ticket negativo");
  assert.equal(res.cashOutsideSession, true, "y se le dice a la persona que lo anote en su corte");
  assert.deepEqual(await depositOf(appt), { amount: 40, status: "REFUNDED" });
  assert.equal(await prisma.barberSale.count({ where: { barbershopId: A.id } }), tickets, "no quedó ningún ticket a medias");
  assert.equal(await expectedCash(A), 640, "sin el SQL, el corte no se entera (por eso el aviso)");
});

test("sql/barber_devolucion_anticipo.sql: plano, se puede pegar dos veces, y solo deja pasar el ticket de devolución", { skip }, async () => {
  const raw = fs.readFileSync(path.resolve(__dirname, "../../../../sql/barber_devolucion_anticipo.sql"), "utf8");
  const code = raw.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\bDO\s+\$/i, "sin bloques DO $$");
  assert.equal(await applySqlFile("sql/barber_devolucion_anticipo.sql"), 3);
  assert.equal(await applySqlFile("sql/barber_devolucion_anticipo.sql"), 3, "idempotente");

  const session = await prisma.barberCashSession.findFirstOrThrow({ where: { barbershopId: A.id, closedAt: null } });
  const negative = (notes: string | null, extra: Record<string, unknown> = {}) =>
    prisma.barberSale.create({
      data: {
        barbershopId: A.id, soldByUserId: A.ctx.barberUserId, cashSessionId: session.id, paymentMethod: "CASH",
        subtotal: new Prisma.Decimal(-10), total: new Prisma.Decimal(-10), notes, ...extra,
      },
    });
  // Un ticket negativo cualquiera sigue prohibido: sin sello, con barbero o con propina negativa.
  await assert.rejects(negative(null), /barber_sales_amounts_valid/);
  await assert.rejects(negative("devolución a mano"), /barber_sales_amounts_valid/);
  await assert.rejects(negative(`#dcb {"k":"refund","appt":"x"}`, { barberId: A.barberId }), /barber_sales_amounts_valid/);
  await assert.rejects(
    prisma.barberSale.create({
      data: { barbershopId: A.id, soldByUserId: A.ctx.barberUserId, cashSessionId: session.id, subtotal: new Prisma.Decimal(10), tip: new Prisma.Decimal(-1), total: new Prisma.Decimal(9) },
    }),
    /barber_sales_amounts_valid/,
  );
  assert.equal(await expectedCash(A), 640, "nada de lo rechazado entró");
});

test("anticipo por transferencia: entra al corte en SPEI y NO al efectivo esperado", { skip }, async () => {
  const appt = await makeAppointment(A);
  const out = await markDepositPaidManually({
    barbershopId: A.id, appointmentId: appt, amount: 60, paymentMethod: "SPEI", soldByUserId: A.ctx.barberUserId,
  });
  const state = await getCashState(A.ctx);
  assert.equal(state.open!.byMethod.SPEI.total, 60);
  assert.equal(state.open!.expectedCash, 640, "la transferencia no está en el cajón");
  assert.equal(state.open!.session.salesTotal, 200);

  // Devolverlo registra un ticket NEGATIVO en el turno abierto, por defecto
  // con el mismo método con que se cobró: sale del corte por donde entró.
  const res = await refundDeposit({ barbershopId: A.id, appointmentId: appt, actorName: "Dueña A", actorUserId: A.ctx.barberUserId });
  assert.equal(res.status, "REFUNDED");
  assert.equal(res.refundMethod, "SPEI");
  assert.ok(res.refundSaleId, "la devolución tiene su propio ticket");
  assert.deepEqual(await depositOf(appt), { amount: 60, status: "REFUNDED" });
  const after = await getCashState(A.ctx);
  assert.equal(after.open!.byMethod.SPEI.total, 0, "+$60 del anticipo − $60 de la devolución");
  assert.equal(after.open!.session.salesTotal, 140);
  assert.equal(after.open!.expectedCash, 640, "la transferencia nunca estuvo en el cajón");
  assert.equal(after.open!.sales.find((s) => s.id === out.saleId)!.cancelled, false, "el ticket con que se cobró no se toca");

  const refund = after.open!.sales.find((s) => s.id === res.refundSaleId)!;
  assert.equal(refund.kind, "refund");
  assert.equal(refund.total, -60);
  assert.equal(refund.paymentMethod, "SPEI");
  assert.equal(refund.clientId, A.clientId);
  assert.ok(refund.items[0].description.startsWith(BARBER_DEPOSIT_REFUND_LINE_PREFIX));
  assert.equal(refund.items[0].unitPrice, -60);
  const detail = await getSaleDetail(A.ctx, refund.id);
  assert.equal(detail!.discount, 0, "una devolución no es un descuento");

  // Ya devuelto: ni se devuelve otra vez ni se cancela el ticket con que se cobró.
  await assert.rejects(refundDeposit({ barbershopId: A.id, appointmentId: appt, actorUserId: A.ctx.barberUserId }), payCode("NOT_PAID"));
  await assert.rejects(cancelSale(A.ctx, out.saleId, { reason: "tarde" }), cajaCode("DEPOSIT_CLOSED"));
});

test("cancelar el ticket de devolución (turno aún abierto) deshace la devolución: el anticipo vuelve a pagado", { skip }, async () => {
  const appt = await makeAppointment(A);
  await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 50, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId });
  assert.equal(await expectedCash(A), 690);
  // Se cobró en efectivo y se devuelve por transferencia: cada uno en su método.
  const res = await refundDeposit({ barbershopId: A.id, appointmentId: appt, actorUserId: A.ctx.barberUserId, paymentMethod: "SPEI" });
  let state = await getCashState(A.ctx);
  assert.equal(state.open!.expectedCash, 690, "el efectivo no salió: se devolvió por transferencia");
  assert.equal(state.open!.byMethod.SPEI.total, -50);
  assert.deepEqual(await depositOf(appt), { amount: 50, status: "REFUNDED" });

  const cancelled = await cancelSale(A.ctx, res.refundSaleId!, { reason: "no se devolvió al final" });
  assert.equal(cancelled.kind, "refund");
  state = await getCashState(A.ctx);
  assert.equal(state.open!.byMethod.SPEI.total, 0);
  assert.deepEqual(await depositOf(appt), { amount: 50, status: "PAID" });

  // Y ahora sí, en efectivo: el esperado baja $50. Dos «Devolver» a la vez → un solo ticket.
  const results = await Promise.allSettled([
    refundDeposit({ barbershopId: A.id, appointmentId: appt, actorUserId: A.ctx.barberUserId }),
    refundDeposit({ barbershopId: A.id, appointmentId: appt, actorUserId: A.ctx.barberUserId }),
    refundDeposit({ barbershopId: A.id, appointmentId: appt, actorUserId: A.ctx.barberUserId }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "el dinero sale una sola vez");
  assert.ok((results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).every((r) => payCode("NOT_PAID")(r.reason)));
  assert.equal(await expectedCash(A), 640);
  await assert.rejects(
    refundDeposit({ barbershopId: A.id, appointmentId: apptMain, actorUserId: A.ctx.barberUserId, paymentMethod: "STRIPE" }),
    payCode("INVALID_PAYMENT_METHOD"),
  );
});

test("la lista de citas para registrar anticipo no ofrece las que ya lo tienen", { skip }, async () => {
  const fresh = await makeAppointment(A);
  const candidates = await listDepositCandidates(A.id);
  assert.ok(candidates.some((c) => c.appointmentId === fresh && c.total === 180));
  assert.equal(candidates.some((c) => c.appointmentId === apptMain), false, "ya tiene anticipo pagado");
  assert.deepEqual(await listDepositCandidates(B.id), [], "B no ve citas de A");
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Cobrar la cita: el anticipo se descuenta solo, una sola vez
// ═══════════════════════════════════════════════════════════════════════

let chargeTicket: string;

test("el diálogo de cobro recibe el anticipo de la cita", { skip }, async () => {
  await prisma.barberAppointment.update({
    where: { id: apptMain },
    data: { status: "DONE", startAt: new Date(Date.now() - 60 * MIN), endAt: new Date(Date.now() - 30 * MIN) },
  });
  const ctxo = await getCheckoutContext(A.ctx, FEATURES);
  const pending = ctxo.pendingAppointments.find((p) => p.id === apptMain);
  assert.ok(pending, "la cita con anticipo sigue «por cobrar» (el ticket del anticipo no la da por cobrada)");
  assert.deepEqual(pending!.deposit, { amount: 100 });
});

test("anticipo $100 + corte $180 → ticket $80; la comisión sigue sobre $180", { skip }, async () => {
  const before = await expectedCash(A);
  const sale = await charge(A, apptMain, { tip: 20 });
  chargeTicket = sale.id;

  assert.equal(sale.subtotal, 80, "180 − 100 de anticipo");
  assert.equal(sale.tip, 20);
  assert.equal(sale.total, 100, "80 + 20 de propina");
  assert.equal(sale.kind, "sale");
  const credit = sale.items.find((it) => it.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX));
  assert.ok(credit, "línea de crédito visible en el ticket");
  assert.equal(credit!.unitPrice, -100);
  assert.equal(credit!.qty, 1);

  assert.equal(await expectedCash(A), before + 100, "al cajón entran $80 + $20 de propina, no $200");

  const entry = await prisma.barberCommissionEntry.findFirstOrThrow({ where: { saleId: sale.id } });
  assert.equal(entry.base.toFixed(2), "180.00", "el anticipo no le quita comisión al barbero");
  assert.equal(entry.amount.toFixed(2), "90.00");

  const detail = await getSaleDetail(A.ctx, sale.id);
  assert.equal(detail!.depositApplied, 100);
  assert.equal(detail!.discount, 0, "el anticipo no se disfraza de descuento");

  const row = (await listDeposits(A.id)).find((d) => d.appointmentId === apptMain)!;
  assert.equal(row.applied, true);
  assert.deepEqual(await depositOf(apptMain), { amount: 100, status: "PAID" });

  // Lo cobrado en total por esa visita: $100 (anticipo) + $80 = $180. Ni un peso de más.
  const tickets = await prisma.barberSale.findMany({ where: { id: { in: [depositTicket, chargeTicket] } }, select: { subtotal: true } });
  assert.equal(tickets.reduce((s, t) => s + Number(t.subtotal), 0), 180);
});

test("el anticipo ya aplicado no se devuelve, ni se retiene, ni se cancela su ticket", { skip }, async () => {
  await assert.rejects(refundDeposit({ barbershopId: A.id, appointmentId: apptMain, actorUserId: A.ctx.barberUserId }), payCode("DEPOSIT_APPLIED"));
  await assert.rejects(forfeitDeposit({ barbershopId: A.id, appointmentId: apptMain }), payCode("DEPOSIT_APPLIED"));
  await assert.rejects(cancelSale(A.ctx, depositTicket, { reason: "me equivoqué" }), cajaCode("DEPOSIT_APPLIED"));
  assert.deepEqual(await depositOf(apptMain), { amount: 100, status: "PAID" });
});

test("cancelar el ticket de la cita devuelve el anticipo a «sin aplicar»; al volver a cobrar se aplica otra vez (y solo una)", { skip }, async () => {
  const before = await expectedCash(A);
  await cancelSale(A.ctx, chargeTicket, { reason: "se cobró mal" });
  assert.equal(await expectedCash(A), before - 100, "salen los $80 + $20 de ese ticket; el anticipo se queda");

  const row = (await listDeposits(A.id)).find((d) => d.appointmentId === apptMain)!;
  assert.equal(row.applied, false);
  assert.equal(row.status, "PAID");
  const pending = (await getCheckoutContext(A.ctx, FEATURES)).pendingAppointments.find((p) => p.id === apptMain);
  assert.deepEqual(pending?.deposit, { amount: 100 });

  const again = await charge(A, apptMain);
  chargeTicket = again.id;
  assert.equal(again.total, 80);
  assert.equal(again.items.filter((it) => it.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX)).length, 1);
  await assert.rejects(charge(A, apptMain), cajaCode("ALREADY_CHARGED"));
});

test("dos cobros SIMULTÁNEOS de la misma cita: uno entra, el anticipo se aplica una sola vez", { skip }, async () => {
  const appt = await makeAppointment(A, { status: "DONE", inMinutes: -100 });
  await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 100, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId });

  const results = await Promise.allSettled([charge(A, appt), charge(A, appt), charge(A, appt), charge(A, appt)]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(ok.length, 1, "exactamente un cobro entra");
  assert.ok(rejected.every((r) => cajaCode("ALREADY_CHARGED")(r.reason)), "los demás: «ya tiene un ticket cobrado»");

  const credits = await prisma.barberSaleItem.count({
    where: { sale: { appointmentId: appt, barbershopId: A.id }, description: { startsWith: BARBER_DEPOSIT_LINE_PREFIX } },
  });
  assert.equal(credits, 1, "una sola línea de anticipo");
  const live = await prisma.barberSale.findMany({ where: { appointmentId: appt, barbershopId: A.id }, select: { total: true } });
  assert.equal(live.length, 1);
  assert.equal(Number(live[0].total), 80);
});

test("con descuento: el anticipo se aplica después y nunca deja el ticket en negativo", { skip }, async () => {
  const appt = await makeAppointment(A, { status: "DONE", inMinutes: -140 });
  await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 100, paymentMethod: "CARD", soldByUserId: A.ctx.barberUserId });
  // $180 − $120 de descuento = $60 por cobrar; el anticipo de $100 solo puede cubrir $60.
  const sale = await charge(A, appt, { discount: 120 });
  assert.equal(sale.subtotal, 0);
  assert.equal(sale.total, 0);
  const credit = sale.items.find((it) => it.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX))!;
  assert.equal(credit.unitPrice, -60);
  const entry = await prisma.barberCommissionEntry.findFirstOrThrow({ where: { saleId: sale.id } });
  assert.equal(entry.base.toFixed(2), "60.00", "base = servicio − descuento (el anticipo no cuenta)");
});

test("Reportes: el anticipo aplicado no se cuenta como descuento, y el ingreso del día cuadra con los tickets", { skip }, async () => {
  const r = await getReportsSummary(A.ctx, { range: "today", features: FEATURES });
  // El único descuento de verdad de esta barbería es el de $120 de la prueba anterior.
  assert.equal(r.totals.discounts, 120, "los anticipos aplicados ($100 + $100 + $60) no inflan «Descuentos»");
  const live = await prisma.barberSale.findMany({ where: { barbershopId: A.id }, select: { subtotal: true, tip: true, total: true } });
  const sum = (k: "subtotal" | "tip" | "total") => Math.round(live.reduce((s, t) => s + Number(t[k]), 0) * 100) / 100;
  assert.equal(r.totals.revenue, sum("subtotal"), "ingreso = Σ subtotal de los tickets (anticipos incluidos, una sola vez)");
  assert.equal(r.totals.total, sum("total"));
  // Ronda 3 · M3: los anticipos van en su propio renglón, no dentro de «Servicios».
  assert.equal(r.totals.services, 420, "tres cortes de $180 menos el descuento de $120: los anticipos no entran aquí");
  assert.equal(
    Math.round((r.totals.services + r.totals.products + r.totals.other) * 100) / 100,
    r.totals.revenue,
    "Servicios + Productos + Membresías y anticipos = Ingresos",
  );
});

test("un anticipo que NO está pagado no descuenta nada", { skip }, async () => {
  const appt = await makeAppointment(A, { status: "DONE", inMinutes: -180 });
  await prisma.barberAppointment.update({ where: { id: appt }, data: { depositAmount: new Prisma.Decimal(100), depositStatus: "PENDING" } });
  const pending = (await getCheckoutContext(A.ctx, FEATURES)).pendingAppointments.find((p) => p.id === appt);
  assert.equal(pending!.deposit, null);
  const sale = await charge(A, appt);
  assert.equal(sale.total, 180);
  assert.equal(sale.items.some((it) => it.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX)), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Cancelar el ticket del anticipo, aislamiento y cierre
// ═══════════════════════════════════════════════════════════════════════

test("cancelar el ticket del anticipo (sin aplicar) deja la cita sin anticipo y lo saca del corte", { skip }, async () => {
  const appt = await makeAppointment(A);
  const before = await expectedCash(A);
  const out = await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 70, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId });
  assert.equal(await expectedCash(A), before + 70);

  const cancelled = await cancelSale(A.ctx, out.saleId, { reason: "dedazo" });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.kind, "deposit");
  assert.equal(await expectedCash(A), before);
  assert.deepEqual(await depositOf(appt), { amount: null, status: null });

  // Y se puede volver a registrar bien.
  await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 80, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId });
  assert.deepEqual(await depositOf(appt), { amount: 80, status: "PAID" });
  assert.equal(await expectedCash(A), before + 80);
});

test("la nota de un ticket no puede falsificar el sello interno", { skip }, async () => {
  await assert.rejects(
    createSale(A.ctx, { items: [{ kind: "service", id: A.serviceId }], paymentMethod: "CASH", notes: `#dcb {"k":"deposit","appt":"${apptMain}"}` }, FEATURES),
    cajaCode("INVALID_INPUT"),
  );
});

test("la barbería B no puede registrar, devolver ni ver el anticipo de una cita de A", { skip }, async () => {
  await openCashSession(B.ctx, { openingAmount: 0 });
  const apptA = await makeAppointment(A);
  await assert.rejects(
    markDepositPaidManually({ barbershopId: B.id, appointmentId: apptA, amount: 50, paymentMethod: "CASH", soldByUserId: B.ctx.barberUserId }),
    payCode("APPOINTMENT_NOT_FOUND"),
  );
  await assert.rejects(refundDeposit({ barbershopId: B.id, appointmentId: apptMain, actorUserId: B.ctx.barberUserId }), payCode("APPOINTMENT_NOT_FOUND"));
  await assert.rejects(cancelSale(B.ctx, depositTicket, { reason: "ajeno" }), cajaCode("SALE_NOT_FOUND"));
  assert.deepEqual(await listDeposits(B.id), []);
  assert.equal((await getCashState(B.ctx)).open!.expectedCash, 0);
  assert.deepEqual(await depositOf(apptA), { amount: null, status: null });
});

// El caso de la revisora (G1 de la ronda 3): el anticipo se cobra un día y se
// devuelve otro, con el turno donde se cobró ya cerrado. Antes solo quedaba
// «Devuelto» y una nota: el cajón del día de la devolución cerraba con $100
// de faltante y el ingreso del mes seguía contando dinero ya devuelto.
test("anticipo cobrado en un turno ya cerrado: devolver exige turno abierto y registra un ticket negativo HOY", { skip }, async () => {
  const appt = await makeAppointment(A);
  await markDepositPaidManually({ barbershopId: A.id, appointmentId: appt, amount: 100, paymentMethod: "CASH", soldByUserId: A.ctx.barberUserId });
  const expected = await expectedCash(A);
  const closed = await closeCashSession(A.ctx, { countedAmount: expected });
  assert.equal(closed.session.expectedAmount, expected);
  assert.equal(closed.session.difference, 0, "con los anticipos dentro, el cajón del día del cobro cuadra");
  const revenueBefore = (await getReportsSummary(A.ctx, { range: "today", features: FEATURES })).totals.revenue;

  // Sin turno abierto no se devuelve: no hay dónde registrar la salida.
  await assert.rejects(
    refundDeposit({ barbershopId: A.id, appointmentId: appt, actorName: "Dueña A", actorUserId: A.ctx.barberUserId }),
    payCode("NO_OPEN_SESSION"),
  );
  assert.deepEqual(await depositOf(appt), { amount: 100, status: "PAID" }, "sigue pagado: no pasó nada");

  // «Otro día»: turno nuevo con fondo $500.
  await openCashSession(A.ctx, { openingAmount: 500 });
  const res = await refundDeposit({ barbershopId: A.id, appointmentId: appt, actorName: "Dueña A", actorUserId: A.ctx.barberUserId });
  assert.equal(res.status, "REFUNDED");
  assert.equal(res.refundMethod, "CASH");
  assert.deepEqual(await depositOf(appt), { amount: 100, status: "REFUNDED" });

  const state = await getCashState(A.ctx);
  assert.equal(state.open!.expectedCash, 400, "fondo $500 − $100 que salieron del cajón hoy");
  assert.equal(state.open!.byMethod.CASH.total, -100);
  assert.equal(state.open!.session.salesTotal, -100);
  const refund = state.open!.sales.find((s) => s.id === res.refundSaleId)!;
  assert.equal(refund.total, -100);
  assert.equal(refund.cashSessionId, state.open!.session.id, "en el turno de HOY, no en el que ya cerró");

  // El turno cerrado no cambió, y el ingreso baja los $100 devueltos.
  const history = (await getCashState(A.ctx)).history.find((h) => h.id === closed.session.id)!;
  assert.equal(history.expectedAmount, expected);
  const report = await getReportsSummary(A.ctx, { range: "today", features: FEATURES });
  assert.equal(report.totals.revenue, revenueBefore - 100, "el ingreso ya no cuenta dinero que se devolvió");
  assert.equal(report.totals.discounts, 120, "y la devolución no se disfraza de descuento");

  // Al cerrar hoy contando lo que hay ($400), cuadra.
  const closedToday = await closeCashSession(A.ctx, { countedAmount: 400 });
  assert.equal(closedToday.session.difference, 0);
});
