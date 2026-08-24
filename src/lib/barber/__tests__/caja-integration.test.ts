// Integración contra Postgres REAL (las garantías de aislamiento, rol,
// plan, stock concurrente y cancelación son de base de datos + transacción,
// no se pueden fingir con mocks).
//
//   docker run -d --name barber-caja-pg -e POSTGRES_PASSWORD=barber \
//     -e POSTGRES_DB=barber -p 54329:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:barber@localhost:54329/barber \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test src/lib/barber/__tests__/caja-integration.test.ts
//
// Sin DATABASE_URL las pruebas se SALTAN (no fallan): jamás apuntar esto a
// producción — crea y borra barberías.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BarberCajaError, getCommissionEntries, getCommissionSummary, markCommissionsPaid } from "@/lib/barber/commissions";
import {
  assertBarberFeature,
  cancelSale,
  closeCashSession,
  createSale,
  getCashState,
  getCheckoutContext,
  getSaleDetail,
  listSales,
  lookupClients,
  openCashSession,
} from "@/lib/barber/cash";
import { listMovements, listProducts, registerStockMovement, updateProduct } from "@/lib/barber/inventory";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

// Construir el cliente no conecta (Prisma abre la conexión en la primera
// query); con skip activo nunca se ejecuta ninguna.
const db = prisma;

const RUN = `t${Date.now().toString(36)}`;
const FEATURES_AVANZADO = FALLBACK_BARBER_PLAN_CONFIG.AVANZADO.features;
const FEATURES_BASICO = FALLBACK_BARBER_PLAN_CONFIG.BASICO.features;
const resolverAvanzado = async () => FEATURES_AVANZADO;
const resolverBasico = async () => FEATURES_BASICO;

type Shop = {
  ctx: BarberContext; // OWNER
  id: string;
};

async function makeShop(name: string, plan: "BASICO" | "AVANZADO"): Promise<Shop> {
  const shop = await db.barbershop.create({
    data: { name, slug: `${RUN}-${name.toLowerCase()}`, plan, subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  const user = await db.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${name}-owner`, email: `${RUN}-${name}@test.local`, firstName: "Dueño", lastName: name, role: "OWNER" },
  });
  return {
    id: shop.id,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
  };
}

async function ctxForBarberRole(shop: Shop, barberId: string, linked = true): Promise<BarberContext> {
  const user = await db.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-${barberId}-${linked ? "linked" : "loose"}`,
      email: `${RUN}-${barberId}-${linked ? "l" : "u"}@test.local`,
      firstName: "Barbero",
      lastName: "Rol",
      role: "BARBER",
      barberId: linked ? barberId : null,
    },
  });
  const barber = linked ? await db.barber.findUniqueOrThrow({ where: { id: barberId } }) : null;
  return { barberUserId: user.id, barbershopId: shop.id, barbershop: shop.ctx.barbershop, user, barber, role: "BARBER" };
}

const codeIs = (code: string) => (e: unknown) => e instanceof BarberCajaError && e.code === code;

let A: Shop, B: Shop, C: Shop;
let a1: string, a2: string, a3: string, b1: string; // barberos
let corteA: string, barbaA: string, corteB: string; // servicios
let ceraA: string, shampooA: string, pomadaB: string; // productos
let clientA: string, clientMembershipA: string, apptA: string;

before(async () => {
  if (!HAS_DB) return;
  A = await makeShop("A", "AVANZADO");
  B = await makeShop("B", "AVANZADO");
  C = await makeShop("C", "BASICO");

  const [ba1, ba2, ba3, bb1] = await Promise.all([
    db.barber.create({ data: { barbershopId: A.id, name: "Alan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) } }),
    db.barber.create({ data: { barbershopId: A.id, name: "Beto", commissionType: "CHAIR_RENT", chairRent: new Prisma.Decimal(3000) } }),
    db.barber.create({ data: { barbershopId: A.id, name: "Caro", commissionType: "SALARY" } }),
    db.barber.create({ data: { barbershopId: B.id, name: "Bruno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } }),
  ]);
  a1 = ba1.id; a2 = ba2.id; a3 = ba3.id; b1 = bb1.id;

  const [sc, sb, scb] = await Promise.all([
    db.barberService.create({ data: { barbershopId: A.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } }),
    db.barberService.create({ data: { barbershopId: A.id, name: "Barba", durationMin: 20, price: new Prisma.Decimal(140) } }),
    db.barberService.create({ data: { barbershopId: B.id, name: "Corte B", durationMin: 30, price: new Prisma.Decimal(200) } }),
  ]);
  corteA = sc.id; barbaA = sb.id; corteB = scb.id;

  const [pc, ps, pp] = await Promise.all([
    db.barberProduct.create({ data: { barbershopId: A.id, name: "Cera", price: new Prisma.Decimal(150), cost: new Prisma.Decimal(80), stock: 1, minStock: 2 } }),
    db.barberProduct.create({ data: { barbershopId: A.id, name: "Shampoo", price: new Prisma.Decimal(200), cost: new Prisma.Decimal(120), stock: 10, minStock: 3 } }),
    db.barberProduct.create({ data: { barbershopId: B.id, name: "Pomada", price: new Prisma.Decimal(120), stock: 5 } }),
  ]);
  ceraA = pc.id; shampooA = ps.id; pomadaB = pp.id;

  const client = await db.barberClient.create({ data: { barbershopId: A.id, name: "Cliente Fiel", phone: "5512345678", loyaltyCount: 10 } });
  clientA = client.id;
  const membership = await db.barberMembership.create({ data: { barbershopId: A.id, name: "4 cortes", price: new Prisma.Decimal(500), includedCuts: 4, periodDays: 30 } });
  const cm = await db.barberClientMembership.create({
    data: { barbershopId: A.id, clientId: clientA, membershipId: membership.id, status: "ACTIVE", endAt: new Date(Date.now() + 30 * 86_400_000), cutsUsed: 1 },
  });
  clientMembershipA = cm.id;

  const appt = await db.barberAppointment.create({
    data: {
      barbershopId: A.id, clientId: clientA, barberId: a1, status: "DONE",
      startAt: new Date(Date.now() - 60 * 60_000), endAt: new Date(Date.now() - 30 * 60_000),
      services: { create: [{ serviceId: corteA, priceAtBooking: new Prisma.Decimal(170) }] }, // congelado ≠ 180 vivo
    },
  });
  apptA = appt.id;
});

after(async () => {
  if (!HAS_DB) return;
  // Borrar la barbería completa en un solo DELETE truena con los FK NoAction
  // (barber_appointment_services.serviceId, etc.): Postgres evalúa ese check
  // antes de que el cascade de citas alcance sus líneas. Hallazgo reportado;
  // aquí se borran los hijos en orden y al final las barberías.
  const shops = await db.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  await db.barberStockMovement.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await db.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: { in: ids } } } });
  await db.barberAppointment.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberClientMembership.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barbershop.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

// ── Turno ───────────────────────────────────────────────────────────────

test("no se cobra sin turno abierto", { skip }, async () => {
  await assert.rejects(
    createSale(A.ctx, { items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("NO_OPEN_SESSION"),
  );
});

test("abrir turno registra fondo y quién; no se puede abrir dos", { skip }, async () => {
  const s = await openCashSession(A.ctx, { openingAmount: 500, notes: "turno mañana" });
  assert.equal(s.session.openingAmount, 500);
  assert.equal(s.session.openedByUserId, A.ctx.barberUserId);
  assert.equal(s.session.closedAt, null);
  assert.equal(s.expectedCash, 500);
  await assert.rejects(openCashSession(A.ctx, { openingAmount: 0 }), codeIs("SESSION_ALREADY_OPEN"));
});

// ── Ticket ──────────────────────────────────────────────────────────────

let saleFromAppt: string, saleWithProduct: string, saleChair: string, saleSalary: string;

test("cobro desde cita: precio congelado, propina fuera de la base, comisión 40%", { skip }, async () => {
  const ctxo = await getCheckoutContext(A.ctx, FEATURES_AVANZADO);
  const pending = ctxo.pendingAppointments.find((p) => p.id === apptA);
  assert.ok(pending, "la cita DONE sin ticket aparece como pendiente");
  assert.equal(pending!.services[0].priceAtBooking, 170);
  assert.equal(pending!.client?.loyaltyEligible, true);
  assert.equal(pending!.client?.activeMembership?.cutsLeft, 3);

  const sale = await createSale(
    A.ctx,
    { appointmentId: apptA, items: [{ kind: "service", id: corteA }], tip: 30, paymentMethod: "CASH" },
    FEATURES_AVANZADO,
  );
  saleFromAppt = sale.id;
  assert.equal(sale.barberId, a1, "toma el barbero de la cita");
  assert.equal(sale.clientId, clientA, "toma el cliente de la cita");
  assert.equal(sale.items[0].unitPrice, 170, "usa el priceAtBooking, no el precio vivo (180)");
  assert.equal(sale.subtotal, 170);
  assert.equal(sale.tip, 30);
  assert.equal(sale.total, 200);

  const entry = await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: sale.id } });
  assert.equal(entry.base.toFixed(2), "170.00", "base = subtotal SIN propina");
  assert.equal(entry.pct?.toFixed(2), "40.00");
  assert.equal(entry.amount.toFixed(2), "68.00");
  assert.equal(entry.barberId, a1);

  // Ya no aparece como pendiente de cobro y no se puede cobrar dos veces.
  const again = await getCheckoutContext(A.ctx, FEATURES_AVANZADO);
  assert.equal(again.pendingAppointments.some((p) => p.id === apptA), false);
  await assert.rejects(
    createSale(A.ctx, { appointmentId: apptA, items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("ALREADY_CHARGED"),
  );
});

test("producto en el ticket: descuenta stock en la misma transacción y deja SALE; con política SERVICES no comisiona", { skip }, async () => {
  const sale = await createSale(
    A.ctx,
    { barberId: a1, items: [{ kind: "product", id: shampooA, qty: 2 }, { kind: "service", id: barbaA }], paymentMethod: "CARD" },
    FEATURES_AVANZADO,
  );
  saleWithProduct = sale.id;
  assert.equal(sale.subtotal, 540); // 2×200 + 140
  const p = await db.barberProduct.findUniqueOrThrow({ where: { id: shampooA } });
  assert.equal(p.stock, 8);
  const mv = await db.barberStockMovement.findMany({ where: { saleId: sale.id } });
  assert.equal(mv.length, 1);
  assert.equal(mv[0].type, "SALE");
  assert.equal(mv[0].qty, -2, "convención: la venta resta con qty negativo");
  const entry = await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: sale.id } });
  assert.equal(entry.base.toFixed(2), "140.00", "solo el servicio entra a la base");
  assert.equal(entry.amount.toFixed(2), "56.00");
});

test("descuento del ticket: línea negativa que reduce subtotal y base", { skip }, async () => {
  const sale = await createSale(
    A.ctx,
    { barberId: a1, items: [{ kind: "service", id: corteA }, { kind: "service", id: barbaA }], discount: 20, paymentMethod: "SPEI" },
    FEATURES_AVANZADO,
  );
  assert.equal(sale.subtotal, 300);
  const disc = sale.items.find((it) => !it.serviceId && !it.productId);
  assert.equal(disc?.unitPrice, -20);
  const entry = await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: sale.id } });
  assert.equal(entry.base.toFixed(2), "300.00");
  assert.equal(entry.amount.toFixed(2), "120.00");
  await assert.rejects(
    createSale(A.ctx, { barberId: a1, items: [{ kind: "service", id: corteA }], discount: 999, paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("DISCOUNT_TOO_BIG"),
  );
});

test("renta de silla: entrada = base íntegra; sueldo: entrada 0 y cobra solo propinas", { skip }, async () => {
  const chair = await createSale(A.ctx, { barberId: a2, items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, FEATURES_AVANZADO);
  saleChair = chair.id;
  const e2 = await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: chair.id } });
  assert.equal(e2.pct, null);
  assert.equal(e2.amount.toFixed(2), "180.00");

  const salary = await createSale(A.ctx, { barberId: a3, items: [{ kind: "service", id: corteA }], tip: 50, paymentMethod: "CASH" }, FEATURES_AVANZADO);
  saleSalary = salary.id;
  const e3 = await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: salary.id } });
  assert.equal(e3.amount.toFixed(2), "0.00");
  assert.equal(e3.base.toFixed(2), "180.00");

  const summary = await getCommissionSummary(A.ctx, e3.periodKey);
  const rowChair = summary.rows.find((r) => r.barberId === a2)!;
  assert.equal(rowChair.commissionTotal, 180);
  assert.equal(rowChair.totalToPay, 180 - 3000, "producción − renta (negativo: debe la diferencia)");
  const rowSalary = summary.rows.find((r) => r.barberId === a3)!;
  assert.equal(rowSalary.commissionTotal, 0);
  assert.equal(rowSalary.tips, 50);
  assert.equal(rowSalary.totalToPay, 50);
  const rowComm = summary.rows.find((r) => r.barberId === a1)!;
  assert.equal(rowComm.commissionTotal, 68 + 56 + 120);
  assert.equal(rowComm.tips, 30);
  assert.equal(rowComm.totalToPay, 68 + 56 + 120 + 30);
  assert.equal(rowComm.paidStatus, "PENDING");
});

test("propina sin barbero se rechaza; sin propina un ticket de mostrador sí pasa", { skip }, async () => {
  await assert.rejects(
    createSale(A.ctx, { items: [{ kind: "product", id: shampooA }], tip: 10, paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("TIP_NEEDS_BARBER"),
  );
  const s = await createSale(A.ctx, { items: [{ kind: "product", id: shampooA }], paymentMethod: "CASH" }, FEATURES_AVANZADO);
  assert.equal(s.barberId, null);
  assert.equal(await db.barberCommissionEntry.count({ where: { saleId: s.id } }), 0, "sin barbero no hay comisión");
});

// ── Canjes ──────────────────────────────────────────────────────────────

test("lealtad: canje deja el servicio en $0, consume sellos; cancelar los devuelve", { skip }, async () => {
  const sale = await createSale(
    A.ctx,
    { barberId: a1, clientId: clientA, items: [{ kind: "service", id: corteA }], redeemLoyaltyItemIndex: 0, paymentMethod: "CASH" },
    FEATURES_AVANZADO,
  );
  assert.equal(sale.items[0].unitPrice, 0);
  assert.equal(sale.subtotal, 0);
  assert.match(sale.items[0].description, /lealtad/);
  assert.equal((await db.barberClient.findUniqueOrThrow({ where: { id: clientA } })).loyaltyCount, 0);
  // Ya no elegible: un segundo canje falla.
  await assert.rejects(
    createSale(A.ctx, { barberId: a1, clientId: clientA, items: [{ kind: "service", id: corteA }], redeemLoyaltyItemIndex: 0, paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("LOYALTY_NOT_ELIGIBLE"),
  );
  await cancelSale(A.ctx, sale.id, { reason: "prueba" });
  assert.equal((await db.barberClient.findUniqueOrThrow({ where: { id: clientA } })).loyaltyCount, 10);
});

test("membresía: cubre el servicio en $0 y descuenta el cupo; cancelar lo restituye", { skip }, async () => {
  const sale = await createSale(
    A.ctx,
    { barberId: a1, clientId: clientA, items: [{ kind: "service", id: corteA }], membershipItemIndex: 0, paymentMethod: "CASH" },
    FEATURES_AVANZADO,
  );
  assert.equal(sale.subtotal, 0);
  assert.match(sale.items[0].description, /Membresía/);
  assert.equal((await db.barberClientMembership.findUniqueOrThrow({ where: { id: clientMembershipA } })).cutsUsed, 2);
  await cancelSale(A.ctx, sale.id, { reason: "prueba" });
  assert.equal((await db.barberClientMembership.findUniqueOrThrow({ where: { id: clientMembershipA } })).cutsUsed, 1);
});

// ── Stock concurrente ───────────────────────────────────────────────────

test("dos ventas simultáneas del último producto: una gana, la otra OUT_OF_STOCK, stock 0 (nunca −1)", { skip }, async () => {
  const buy = () => createSale(A.ctx, { items: [{ kind: "product", id: ceraA }], paymentMethod: "CASH" }, FEATURES_AVANZADO);
  const results = await Promise.allSettled([buy(), buy()]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const ko = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(ok.length, 1, "exactamente una venta pasa");
  assert.equal(ko.length, 1);
  assert.ok(codeIs("OUT_OF_STOCK")(ko[0].reason), `esperaba OUT_OF_STOCK, llegó ${String(ko[0].reason)}`);
  const p = await db.barberProduct.findUniqueOrThrow({ where: { id: ceraA } });
  assert.equal(p.stock, 0);
  assert.equal(await db.barberStockMovement.count({ where: { productId: ceraA, type: "SALE" } }), 1, "un solo movimiento SALE");
  // La venta perdedora no dejó ticket huérfano (rollback completo).
  const sales = await db.barberSale.count({ where: { barbershopId: A.id, items: { some: { productId: ceraA } } } });
  assert.equal(sales, 1);
});

// ── Cancelación ─────────────────────────────────────────────────────────

test("cancelar devuelve stock (RETURN), borra la comisión, deja ceros y ya no cuenta", { skip }, async () => {
  const before = await getCashState(A.ctx);
  const beforeCount = before.open!.session.ticketCount;
  const beforeCard = before.open!.byMethod.CARD.total;

  const cancelled = await cancelSale(A.ctx, saleWithProduct, { reason: "cliente devolvió el shampoo" });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.total, 0);
  assert.equal(cancelled.items.length, 0);
  assert.match(cancelled.notes ?? "", /^\[CANCELADA\]/);
  assert.match(cancelled.notes ?? "", /Dueño A/);

  const p = await db.barberProduct.findUniqueOrThrow({ where: { id: shampooA } });
  assert.equal(p.stock, 9, "8 + 2 devueltos − 1 del ticket de mostrador");
  const ret = await db.barberStockMovement.findFirst({ where: { saleId: saleWithProduct, type: "RETURN" } });
  assert.equal(ret?.qty, 2);
  assert.equal(await db.barberCommissionEntry.count({ where: { saleId: saleWithProduct } }), 0);

  const after = await getCashState(A.ctx);
  assert.equal(after.open!.session.ticketCount, beforeCount - 1, "no cuenta como ticket");
  assert.equal(after.open!.session.cancelledCount, 3);
  assert.equal(after.open!.byMethod.CARD.total, beforeCard - 540, "no cuenta como producción");
  await assert.rejects(cancelSale(A.ctx, saleWithProduct, { reason: "otra vez" }), codeIs("ALREADY_CANCELLED"));

  const summary = await getCommissionSummary(A.ctx, (await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: saleFromAppt } })).periodKey);
  const row = summary.rows.find((r) => r.barberId === a1)!;
  assert.equal(row.commissionTotal, 68 + 120, "la comisión del ticket cancelado ya no está");
});

test("comisión ya pagada: el ticket no se puede cancelar; el estado queda PAID", { skip }, async () => {
  const entry = await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: saleChair } });
  const r = await markCommissionsPaid(A.ctx, { barberId: a2, periodKey: entry.periodKey });
  assert.equal(r.marked, 1);
  await assert.rejects(cancelSale(A.ctx, saleChair, { reason: "tarde" }), codeIs("COMMISSION_PAID"));
  const summary = await getCommissionSummary(A.ctx, entry.periodKey, { barberId: a2 });
  assert.equal(summary.rows[0].paidStatus, "PAID");
  assert.equal(summary.rows[0].commissionPending, 0);
  const again = await markCommissionsPaid(A.ctx, { barberId: a2, periodKey: entry.periodKey });
  assert.equal(again.marked, 0, "idempotente");
});

// ── Cierre ──────────────────────────────────────────────────────────────

test("cerrar turno: esperado = fondo + efectivo (sin cancelados), diferencia, quién cerró; no se reabre", { skip }, async () => {
  const state = await getCashState(A.ctx);
  const expected = state.open!.expectedCash;
  const cashTotal = state.open!.byMethod.CASH.total;
  assert.equal(expected, 500 + cashTotal);

  const closed = await closeCashSession(A.ctx, { countedAmount: expected - 20, notes: "faltaron 20" });
  assert.equal(closed.session.closedByUserId, A.ctx.barberUserId);
  assert.equal(closed.session.expectedAmount, expected);
  assert.equal(closed.session.countedAmount, expected - 20);
  assert.equal(closed.session.difference, -20);
  assert.ok(closed.session.closedAt);

  await assert.rejects(closeCashSession(A.ctx, { countedAmount: 0 }), codeIs("NO_OPEN_SESSION"));
  await assert.rejects(
    createSale(A.ctx, { items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("NO_OPEN_SESSION"),
  );
  // Un ticket del turno cerrado ya no se cancela: turno nuevo con nota.
  await assert.rejects(cancelSale(A.ctx, saleSalary, { reason: "tarde" }), codeIs("SESSION_CLOSED"));
  const after = await getCashState(A.ctx);
  assert.equal(after.open, null);
  assert.equal(after.history[0].id, closed.session.id);
  assert.equal(after.history[0].difference, -20);
});

// ── Aislamiento entre barberías ─────────────────────────────────────────

test("la barbería B no ve turnos, tickets, comisiones ni productos de A", { skip }, async () => {
  const stateB = await getCashState(B.ctx);
  assert.equal(stateB.open, null);
  assert.equal(stateB.history.length, 0);
  assert.equal((await listSales(B.ctx)).length, 0);
  assert.equal(await getSaleDetail(B.ctx, saleFromAppt), null);
  await assert.rejects(cancelSale(B.ctx, saleFromAppt, { reason: "x" }), codeIs("SALE_NOT_FOUND"));

  const periodKey = (await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: saleFromAppt } })).periodKey;
  const sumB = await getCommissionSummary(B.ctx, periodKey);
  assert.deepEqual(sumB.rows.map((r) => r.barberId), [b1]);
  assert.equal(sumB.totals.produced, 0);
  await assert.rejects(markCommissionsPaid(B.ctx, { barberId: a1, periodKey }), codeIs("BARBER_NOT_FOUND"));
  assert.deepEqual(await getCommissionEntries(B.ctx, { barberId: a1, periodKey }), []);

  const prodsB = await listProducts(B.ctx, { includeInactive: true });
  assert.deepEqual(prodsB.map((p) => p.id), [pomadaB]);
  await assert.rejects(updateProduct(B.ctx, shampooA, { price: 1 }), codeIs("PRODUCT_NOT_FOUND"));
  await assert.rejects(registerStockMovement(B.ctx, shampooA, { type: "IN", qty: 5, reason: "robo" }), codeIs("PRODUCT_NOT_FOUND"));
  assert.equal((await db.barberProduct.findUniqueOrThrow({ where: { id: shampooA } })).stock, 9, "A intacto");
  assert.deepEqual(await listMovements(B.ctx, shampooA), []);
  assert.deepEqual(await lookupClients(B.ctx, "Fiel"), []);
  const ctxB = await getCheckoutContext(B.ctx, FEATURES_AVANZADO);
  assert.deepEqual(ctxB.services.map((s) => s.id), [corteB]);
  assert.deepEqual(ctxB.barbers.map((b) => b.id), [b1]);

  // B opera su propia caja sin tocar la de A.
  await openCashSession(B.ctx, { openingAmount: 100 });
  const saleB = await createSale(B.ctx, { barberId: b1, items: [{ kind: "service", id: corteB }, { kind: "product", id: pomadaB }], paymentMethod: "CASH" }, FEATURES_AVANZADO);
  assert.equal(saleB.subtotal, 320);
  assert.equal((await getCashState(A.ctx)).open, null, "A sigue sin turno abierto");
  // A no puede cobrar con ids de B aunque tenga turno.
  await openCashSession(A.ctx, { openingAmount: 0 });
  await assert.rejects(
    createSale(A.ctx, { barberId: b1, items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("BARBER_NOT_FOUND"),
  );
  await assert.rejects(
    createSale(A.ctx, { items: [{ kind: "service", id: corteB }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("SERVICE_NOT_FOUND"),
  );
  await assert.rejects(
    createSale(A.ctx, { items: [{ kind: "product", id: pomadaB }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    codeIs("PRODUCT_NOT_FOUND"),
  );
});

// ── Rol BARBER ──────────────────────────────────────────────────────────

test("rol BARBER: ve solo su comisión, 403 al pedir la de otro, y no puede cobrar ni pagar", { skip }, async () => {
  const periodKey = (await db.barberCommissionEntry.findFirstOrThrow({ where: { saleId: saleFromAppt } })).periodKey;
  const me = await ctxForBarberRole(A, a1);

  const mine = await getCommissionSummary(me, periodKey);
  assert.equal(mine.selfOnly, true);
  assert.deepEqual(mine.rows.map((r) => r.barberId), [a1]);
  assert.equal(mine.rows[0].commissionTotal, 68 + 120);

  await assert.rejects(getCommissionSummary(me, periodKey, { barberId: a2 }), codeIs("FORBIDDEN_SCOPE"));
  await assert.rejects(getCommissionEntries(me, { barberId: a2, periodKey }), codeIs("FORBIDDEN_SCOPE"));
  const own = await getCommissionEntries(me, { barberId: a1, periodKey });
  assert.ok(own.length >= 2);
  assert.ok(own.every((e) => e.barberId === a1));

  await assert.rejects(markCommissionsPaid(me, { barberId: a1, periodKey }), (e: unknown) => e instanceof BarberForbiddenError);
  await assert.rejects(
    createSale(me, { items: [{ kind: "service", id: corteA }], paymentMethod: "CASH" }, FEATURES_AVANZADO),
    (e: unknown) => e instanceof BarberForbiddenError && e.permission === "cash.manage",
  );
  await assert.rejects(getCashState(me), (e: unknown) => e instanceof BarberForbiddenError && e.permission === "cash.view");
  await assert.rejects(listProducts(me), (e: unknown) => e instanceof BarberForbiddenError);

  // BARBER sin fila ligada: no ve nada.
  const loose = await ctxForBarberRole(A, a1, false);
  const nothing = await getCommissionSummary(loose, periodKey);
  assert.deepEqual(nothing.rows, []);
});

// ── Plan BÁSICO ─────────────────────────────────────────────────────────

test("plan Básico: el servidor niega comisiones y productos; caja y propinas sí", { skip }, async () => {
  await assert.rejects(assertBarberFeature(C.ctx, "commissions", resolverBasico), codeIs("FEATURE_NOT_IN_PLAN"));
  await assert.rejects(assertBarberFeature(C.ctx, "products", resolverBasico), codeIs("FEATURE_NOT_IN_PLAN"));
  await assertBarberFeature(C.ctx, "cash", resolverBasico);
  await assertBarberFeature(C.ctx, "tips", resolverBasico);
  await assertBarberFeature(C.ctx, "commissions", resolverAvanzado); // AVANZADO sí

  // Aunque alguien arme el body con un producto, el cobro en Básico lo rechaza.
  const prodC = await db.barberProduct.create({ data: { barbershopId: C.id, name: "Cera C", price: new Prisma.Decimal(100), stock: 5 } });
  const svcC = await db.barberService.create({ data: { barbershopId: C.id, name: "Corte C", durationMin: 30, price: new Prisma.Decimal(150) } });
  await openCashSession(C.ctx, { openingAmount: 0 });
  await assert.rejects(
    createSale(C.ctx, { items: [{ kind: "product", id: prodC.id }], paymentMethod: "CASH" }, FEATURES_BASICO),
    codeIs("FEATURE_NOT_IN_PLAN"),
  );
  assert.equal((await db.barberProduct.findUniqueOrThrow({ where: { id: prodC.id } })).stock, 5);
  const ok = await createSale(C.ctx, { items: [{ kind: "service", id: svcC.id }], paymentMethod: "CASH" }, FEATURES_BASICO);
  assert.equal(ok.total, 150);
  const ctxC = await getCheckoutContext(C.ctx, FEATURES_BASICO);
  assert.equal(ctxC.products.length, 0, "el picker no ofrece productos en Básico");
  assert.equal(ctxC.features.products, false);
});

// ── API sin sesión → 401 ────────────────────────────────────────────────

test("las rutas responden 401 sin sesión de barbería (sin cookies no hay contexto)", { skip }, async () => {
  const { GET: getCommissions } = await import("@/app/api/barber/commissions/route");
  const { NextRequest } = await import("next/server");
  const res = await getCommissions(new NextRequest("http://localhost/api/barber/commissions?period=2026-08"));
  assert.equal(res.status, 401);
  const { GET: getProducts } = await import("@/app/api/barber/products/route");
  assert.equal((await getProducts(new NextRequest("http://localhost/api/barber/products"))).status, 401);
  const { POST: postSale } = await import("@/app/api/barber/sales/route");
  assert.equal((await postSale(new NextRequest("http://localhost/api/barber/sales", { method: "POST", body: "{}" }))).status, 401);
});
