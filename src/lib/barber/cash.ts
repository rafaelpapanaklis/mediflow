// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — caja: turnos, tickets y cancelaciones.
//
// Reglas del contrato (todas se hacen valer AQUÍ, en el servidor):
//  · barbershopId sale SIEMPRE del BarberContext; jamás del request.
//  · No se cobra sin turno abierto (BarberCashSession.closedAt = null). Un
//    turno cerrado no se reabre: la corrección es un turno nuevo con nota.
//  · Precios: servicios desde BarberService (o el priceAtBooking congelado de
//    la cita), productos desde BarberProduct. El cliente NUNCA manda precios;
//    solo ids, cantidades, descuento y propina.
//  · Dinero en Decimal (helpers de commissions.ts); redondeo único al final.
//  · La propina (BarberSale.tip) es del barbero íntegra y NO entra a la base
//    de comisión. total = subtotal + tip; un ticket sin barbero no lleva
//    propina (no habría a quién atribuirla).
//  · Cobro + descuento de stock + entrada de comisión + lealtad/membresía
//    ocurren en UNA transacción: o pasa todo o no pasa nada.
//  · Cancelar = soft-cancel (ver CANCELLED_MARK en commissions.ts): ceros,
//    líneas fuera, stock devuelto con RETURN, comisión borrada, cupos
//    restituidos. Solo con el turno abierto y con la comisión sin pagar.
//  · Pago mixto (parte efectivo, parte tarjeta) NO cabe en el schema (un solo
//    paymentMethod por ticket): se reporta, no se improvisa.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertBarberPermission,
  BarberForbiddenError,
  type BarberContext,
} from "@/lib/barber-auth";
import { barberFeatureLabel } from "@/lib/barber/plan-shared";
import type {
  BarberAppointmentStatus,
  BarberCommissionType,
  BarberPaymentMethod,
  BarberSaleItemDTO,
} from "@/lib/barber/types";
import {
  BarberCajaError,
  CANCELLED_MARK,
  D,
  DEFAULT_BARBER_TZ,
  ZERO,
  commissionBaseFor,
  computeCommission,
  getCommissionPolicy,
  isSaleCancelled,
  lineTotal,
  money,
  parseMoneyInput,
  parseQty,
  periodKeyFor,
  startOfDayInTz,
  sumMoney,
  toNum,
  type CommissionLine,
  type Money,
} from "@/lib/barber/commissions";
import { applyStockDelta, listProducts, type ProductRow } from "@/lib/barber/inventory";

type Tx = Prisma.TransactionClient;

// ── Constantes del módulo ───────────────────────────────────────────────

/** Sellos de lealtad necesarios para un corte gratis. T2 (clientes) acumula
 *  loyaltyCount; aquí solo se CANJEA (resta este número) y se registra. */
export const BARBER_LOYALTY_STAMPS_TARGET = 10;

/** Métodos que acepta el mostrador. STRIPE es del pago en línea (T5/T6). */
export const POS_PAYMENT_METHODS: BarberPaymentMethod[] = ["CASH", "CARD", "SPEI"];

/** Sufijos que marcan una línea cubierta (canje). Los lee cancelSale para
 *  restituir el cupo; nadie más los interpreta. */
export const LOYALTY_SUFFIX = " · Gratis (lealtad)";
export const MEMBERSHIP_SUFFIX = " · Membresía";

const DISCOUNT_DESCRIPTION = "Descuento";

// ── Plan gate (servidor) ────────────────────────────────────────────────

export type FeatureResolver = (planId: string) => Promise<Record<string, boolean>>;

// Import dinámico a propósito: plans.ts es "server-only" y este módulo lo
// importan las pruebas con tsx (Node puro), donde ese paquete truena.
async function defaultFeatureResolver(planId: string): Promise<Record<string, boolean>> {
  const { getBarberPlan } = await import("@/lib/barber/plans");
  return (await getBarberPlan(planId)).features;
}

/**
 * Gate por plan EN EL SERVIDOR: lanza 403 FEATURE_NOT_IN_PLAN si el plan de
 * la barbería no incluye la feature (cash/tips en todos; commissions y
 * products solo AVANZADO+). Devuelve el mapa de features para reusarlo.
 */
export async function assertBarberFeature(
  ctx: Pick<BarberContext, "barbershop">,
  key: string,
  resolve: FeatureResolver = defaultFeatureResolver,
): Promise<Record<string, boolean>> {
  const features = await resolve(ctx.barbershop.plan);
  if (features[key] !== true) {
    throw new BarberCajaError(
      403,
      "FEATURE_NOT_IN_PLAN",
      `Tu plan no incluye "${barberFeatureLabel(key)}". Súbelo desde Suscripción.`,
      { feature: key },
    );
  }
  return features;
}

export async function resolveBarberFeatures(
  ctx: Pick<BarberContext, "barbershop">,
  resolve: FeatureResolver = defaultFeatureResolver,
): Promise<Record<string, boolean>> {
  return resolve(ctx.barbershop.plan);
}

// ── Mapeo de errores para las APIs ──────────────────────────────────────

export function moneyErrorResponse(e: unknown): NextResponse {
  if (e instanceof BarberForbiddenError) {
    return NextResponse.json(
      { error: "Sin permiso", code: "FORBIDDEN", permission: e.permission },
      { status: 403 },
    );
  }
  if (e instanceof BarberCajaError) {
    return NextResponse.json(
      { error: e.message, code: e.code, details: e.details ?? null },
      { status: e.status },
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json(
      { error: "Ya existe un registro igual (conflicto)", code: "CONFLICT" },
      { status: 409 },
    );
  }
  console.error("[barber-caja]", e);
  return NextResponse.json({ error: "Error interno", code: "INTERNAL" }, { status: 500 });
}

// ── DTOs ────────────────────────────────────────────────────────────────

export interface SaleRow {
  id: string;
  createdAt: string;
  appointmentId: string | null;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  barberId: string | null;
  barberName: string | null;
  subtotal: number;
  tip: number;
  total: number;
  paymentMethod: BarberPaymentMethod;
  cashSessionId: string | null;
  soldByUserId: string;
  soldByName: string;
  notes: string | null;
  cancelled: boolean;
  items: BarberSaleItemDTO[];
  itemsSummary: string;
}

export interface SaleDetail extends SaleRow {
  shop: {
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    phone: string | null;
    logoUrl: string | null;
    timezone: string;
  };
  /** Σ líneas positivas (antes de descuentos), para mostrar el descuento. */
  grossItems: number;
  discount: number;
}

export interface MethodTotals {
  count: number;
  subtotal: number;
  tip: number;
  total: number;
}

export type MethodBreakdown = Record<BarberPaymentMethod, MethodTotals>;

export interface CashSessionRow {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  countedAmount: number | null;
  expectedAmount: number | null;
  /** countedAmount − expectedAmount (null mientras está abierto). */
  difference: number | null;
  notes: string | null;
  openedByUserId: string;
  openedByName: string;
  closedByUserId: string | null;
  closedByName: string | null;
  ticketCount: number;
  cancelledCount: number;
  salesTotal: number;
  tipsTotal: number;
  cashTotal: number;
}

export interface CashSessionSummary {
  session: CashSessionRow;
  byMethod: MethodBreakdown;
  /** Propinas cobradas en efectivo (están en el cajón; son del barbero). */
  cashTips: number;
  /** fondo + Σ total de tickets en efectivo (incluye propinas en efectivo). */
  expectedCash: number;
  sales: SaleRow[];
}

export interface ClientLookup {
  id: string;
  name: string;
  phone: string;
  loyaltyCount: number;
  loyaltyEligible: boolean;
  activeMembership: {
    id: string;
    name: string;
    includedCuts: number | null;
    cutsUsed: number;
    cutsLeft: number | null;
    endAt: string;
  } | null;
}

export interface PendingAppointment {
  id: string;
  startAt: string;
  endAt: string;
  status: BarberAppointmentStatus;
  barberId: string | null;
  barberName: string | null;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  client: ClientLookup | null;
  services: Array<{ serviceId: string; name: string; priceAtBooking: number }>;
}

export interface CheckoutContext {
  services: Array<{ id: string; name: string; price: number; durationMin: number; category: string }>;
  products: ProductRow[];
  barbers: Array<{ id: string; name: string; nickname: string | null; commissionType: BarberCommissionType }>;
  pendingAppointments: PendingAppointment[];
  loyaltyTarget: number;
  features: { products: boolean; tips: boolean; commissions: boolean };
}

export interface CashState {
  open: CashSessionSummary | null;
  history: CashSessionRow[];
  timezone: string;
}

// ── Helpers de lectura ──────────────────────────────────────────────────

const saleInclude = {
  items: { orderBy: { id: "asc" as const } },
  client: { select: { name: true, phone: true } },
  barber: { select: { name: true, nickname: true } },
  soldBy: { select: { firstName: true, lastName: true } },
  appointment: { select: { clientName: true, clientPhone: true } },
} satisfies Prisma.BarberSaleInclude;

type SaleWithRelations = Prisma.BarberSaleGetPayload<{ include: typeof saleInclude }>;

function fullName(u: { firstName: string; lastName: string } | null | undefined): string {
  if (!u) return "—";
  return `${u.firstName} ${u.lastName}`.trim() || "—";
}

function itemsSummaryOf(items: Array<{ description: string; qty: number }>): string {
  return items.map((it) => (it.qty > 1 ? `${it.qty}× ${it.description}` : it.description)).join(", ");
}

export function toSaleRow(s: SaleWithRelations): SaleRow {
  return {
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    appointmentId: s.appointmentId,
    clientId: s.clientId,
    clientName: s.client?.name ?? s.appointment?.clientName ?? null,
    clientPhone: s.client?.phone ?? s.appointment?.clientPhone ?? null,
    barberId: s.barberId,
    barberName: s.barber ? s.barber.nickname || s.barber.name : null,
    subtotal: toNum(s.subtotal),
    tip: toNum(s.tip),
    total: toNum(s.total),
    paymentMethod: s.paymentMethod,
    cashSessionId: s.cashSessionId,
    soldByUserId: s.soldByUserId,
    soldByName: fullName(s.soldBy),
    notes: s.notes,
    cancelled: isSaleCancelled(s),
    items: s.items.map((it) => ({
      id: it.id,
      serviceId: it.serviceId,
      productId: it.productId,
      description: it.description,
      qty: it.qty,
      unitPrice: toNum(it.unitPrice),
    })),
    itemsSummary: itemsSummaryOf(s.items),
  };
}

function emptyBreakdown(): MethodBreakdown {
  const z = (): MethodTotals => ({ count: 0, subtotal: 0, tip: 0, total: 0 });
  return { CASH: z(), CARD: z(), SPEI: z(), STRIPE: z() };
}

function breakdownOf(sales: SaleRow[]): { byMethod: MethodBreakdown; cashTips: Money; cashTotal: Money } {
  const acc: Record<BarberPaymentMethod, { count: number; subtotal: Money; tip: Money; total: Money }> = {
    CASH: { count: 0, subtotal: ZERO, tip: ZERO, total: ZERO },
    CARD: { count: 0, subtotal: ZERO, tip: ZERO, total: ZERO },
    SPEI: { count: 0, subtotal: ZERO, tip: ZERO, total: ZERO },
    STRIPE: { count: 0, subtotal: ZERO, tip: ZERO, total: ZERO },
  };
  for (const s of sales) {
    if (s.cancelled) continue; // ya vale 0, pero tampoco cuenta como ticket
    const a = acc[s.paymentMethod];
    a.count += 1;
    a.subtotal = a.subtotal.plus(s.subtotal);
    a.tip = a.tip.plus(s.tip);
    a.total = a.total.plus(s.total);
  }
  const byMethod = emptyBreakdown();
  for (const m of Object.keys(acc) as BarberPaymentMethod[]) {
    byMethod[m] = {
      count: acc[m].count,
      subtotal: toNum(acc[m].subtotal),
      tip: toNum(acc[m].tip),
      total: toNum(acc[m].total),
    };
  }
  return { byMethod, cashTips: acc.CASH.tip, cashTotal: acc.CASH.total };
}

/** Esperado en efectivo = fondo + Σ total de tickets en efectivo (sin cancelados). */
export function expectedCashFor(openingAmount: Money, cashSalesTotal: Money): Money {
  return money(openingAmount.plus(cashSalesTotal));
}

type SessionWithUsers = Prisma.BarberCashSessionGetPayload<{
  include: {
    openedBy: { select: { firstName: true; lastName: true } };
    closedBy: { select: { firstName: true; lastName: true } };
  };
}>;

const sessionInclude = {
  openedBy: { select: { firstName: true, lastName: true } },
  closedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BarberCashSessionInclude;

function toSessionRow(s: SessionWithUsers, sales: SaleRow[]): CashSessionRow {
  const live = sales.filter((x) => !x.cancelled);
  const { cashTotal } = breakdownOf(sales);
  const counted = s.countedAmount === null ? null : money(s.countedAmount);
  const expected = s.expectedAmount === null ? null : money(s.expectedAmount);
  return {
    id: s.id,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    openingAmount: toNum(s.openingAmount),
    countedAmount: counted === null ? null : counted.toNumber(),
    expectedAmount: expected === null ? null : expected.toNumber(),
    difference: counted !== null && expected !== null ? toNum(counted.minus(expected)) : null,
    notes: s.notes,
    openedByUserId: s.openedByUserId,
    openedByName: fullName(s.openedBy),
    closedByUserId: s.closedByUserId,
    closedByName: s.closedBy ? fullName(s.closedBy) : null,
    ticketCount: live.length,
    cancelledCount: sales.length - live.length,
    salesTotal: toNum(sumMoney(live.map((x) => x.subtotal))),
    tipsTotal: toNum(sumMoney(live.map((x) => x.tip))),
    cashTotal: toNum(cashTotal),
  };
}

async function salesOfSession(barbershopId: string, sessionId: string): Promise<SaleRow[]> {
  const rows = await prisma.barberSale.findMany({
    where: { barbershopId, cashSessionId: sessionId },
    orderBy: { createdAt: "desc" },
    include: saleInclude,
  });
  return rows.map(toSaleRow);
}

// ── Turnos ──────────────────────────────────────────────────────────────

export async function getOpenCashSession(barbershopId: string) {
  return prisma.barberCashSession.findFirst({
    where: { barbershopId, closedAt: null },
    orderBy: { openedAt: "desc" },
    include: sessionInclude,
  });
}

export async function summarizeSession(
  barbershopId: string,
  session: SessionWithUsers,
): Promise<CashSessionSummary> {
  const sales = await salesOfSession(barbershopId, session.id);
  const { byMethod, cashTips, cashTotal } = breakdownOf(sales);
  return {
    session: toSessionRow(session, sales),
    byMethod,
    cashTips: toNum(cashTips),
    expectedCash: toNum(expectedCashFor(D(session.openingAmount), cashTotal)),
    sales,
  };
}

export async function getCashSessionSummary(
  ctx: BarberContext,
  sessionId: string,
): Promise<CashSessionSummary> {
  assertBarberPermission(ctx, "cash.view");
  const session = await prisma.barberCashSession.findFirst({
    where: { id: sessionId, barbershopId: ctx.barbershopId },
    include: sessionInclude,
  });
  if (!session) throw new BarberCajaError(404, "SESSION_NOT_FOUND", "Turno no encontrado");
  return summarizeSession(ctx.barbershopId, session);
}

/** Abre turno con fondo inicial. Solo puede haber UN turno abierto por
 *  barbería (chequeo + índice único parcial en sql/barber_caja.sql). */
export async function openCashSession(
  ctx: BarberContext,
  input: { openingAmount?: unknown; notes?: unknown },
): Promise<CashSessionSummary> {
  assertBarberPermission(ctx, "cash.manage");
  const openingAmount = parseMoneyInput(input.openingAmount, { field: "openingAmount" });
  const notes = cleanNotes(input.notes);

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.barberCashSession.findFirst({
      where: { barbershopId: ctx.barbershopId, closedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new BarberCajaError(409, "SESSION_ALREADY_OPEN", "Ya hay un turno abierto. Ciérralo antes de abrir otro.");
    }
    try {
      return await tx.barberCashSession.create({
        data: {
          barbershopId: ctx.barbershopId,
          openingAmount,
          notes,
          openedByUserId: ctx.barberUserId,
        },
        include: sessionInclude,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new BarberCajaError(409, "SESSION_ALREADY_OPEN", "Ya hay un turno abierto. Ciérralo antes de abrir otro.");
      }
      throw e;
    }
  });
  return summarizeSession(ctx.barbershopId, created);
}

/**
 * Cierra el turno abierto con el efectivo contado. Congela expectedAmount
 * (fondo + efectivo de tickets) y registra quién cerró. La diferencia se
 * deriva (contado − esperado). Guarda contra doble cierre (updateMany con
 * closedAt: null → 0 filas = ya estaba cerrado).
 */
export async function closeCashSession(
  ctx: BarberContext,
  input: { countedAmount?: unknown; notes?: unknown },
  now: Date = new Date(),
): Promise<CashSessionSummary> {
  assertBarberPermission(ctx, "cash.manage");
  const countedAmount = parseMoneyInput(input.countedAmount, { field: "countedAmount", required: true });
  const notes = cleanNotes(input.notes);

  const open = await getOpenCashSession(ctx.barbershopId);
  if (!open) throw new BarberCajaError(409, "NO_OPEN_SESSION", "No hay un turno abierto");

  const summary = await summarizeSession(ctx.barbershopId, open);
  const expected = money(summary.expectedCash);

  const r = await prisma.barberCashSession.updateMany({
    where: { id: open.id, barbershopId: ctx.barbershopId, closedAt: null },
    data: {
      closedAt: now,
      closedByUserId: ctx.barberUserId,
      countedAmount,
      expectedAmount: expected,
      notes: [open.notes, notes].filter(Boolean).join("\n") || null,
    },
  });
  if (r.count === 0) throw new BarberCajaError(409, "SESSION_CLOSED", "El turno ya estaba cerrado");

  const closed = await prisma.barberCashSession.findFirstOrThrow({
    where: { id: open.id, barbershopId: ctx.barbershopId },
    include: sessionInclude,
  });
  return summarizeSession(ctx.barbershopId, closed);
}

export async function listCashSessions(
  ctx: BarberContext,
  opts: { limit?: number; onlyClosed?: boolean } = {},
): Promise<CashSessionRow[]> {
  assertBarberPermission(ctx, "cash.view");
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 100);
  const sessions = await prisma.barberCashSession.findMany({
    where: { barbershopId: ctx.barbershopId, ...(opts.onlyClosed ? { closedAt: { not: null } } : {}) },
    orderBy: { openedAt: "desc" },
    take: limit,
    include: sessionInclude,
  });
  if (sessions.length === 0) return [];
  const sales = await prisma.barberSale.findMany({
    where: { barbershopId: ctx.barbershopId, cashSessionId: { in: sessions.map((s) => s.id) } },
    include: saleInclude,
  });
  const bySession = new Map<string, SaleRow[]>();
  for (const s of sales) {
    const row = toSaleRow(s);
    const list = bySession.get(s.cashSessionId!) ?? [];
    list.push(row);
    bySession.set(s.cashSessionId!, list);
  }
  return sessions.map((s) => toSessionRow(s, bySession.get(s.id) ?? []));
}

/** Estado completo de la caja para la página. */
export async function getCashState(ctx: BarberContext): Promise<CashState> {
  assertBarberPermission(ctx, "cash.view");
  const open = await getOpenCashSession(ctx.barbershopId);
  const [openSummary, history] = await Promise.all([
    open ? summarizeSession(ctx.barbershopId, open) : Promise.resolve(null),
    listCashSessions(ctx, { limit: 15, onlyClosed: true }),
  ]);
  return { open: openSummary, history, timezone: ctx.barbershop.timezone || DEFAULT_BARBER_TZ };
}

// ── Contexto de cobro (catálogos + citas por cobrar) ────────────────────

function toClientLookup(c: {
  id: string;
  name: string;
  phone: string;
  loyaltyCount: number;
  memberships: Array<{
    id: string;
    status: string;
    endAt: Date;
    cutsUsed: number;
    membership: { name: string; includedCuts: number | null };
  }>;
}, now: Date): ClientLookup {
  const active = c.memberships.find(
    (m) =>
      m.status === "ACTIVE" &&
      m.endAt > now &&
      (m.membership.includedCuts === null || m.cutsUsed < m.membership.includedCuts),
  );
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    loyaltyCount: c.loyaltyCount,
    loyaltyEligible: c.loyaltyCount >= BARBER_LOYALTY_STAMPS_TARGET,
    activeMembership: active
      ? {
          id: active.id,
          name: active.membership.name,
          includedCuts: active.membership.includedCuts,
          cutsUsed: active.cutsUsed,
          cutsLeft:
            active.membership.includedCuts === null
              ? null
              : Math.max(active.membership.includedCuts - active.cutsUsed, 0),
          endAt: active.endAt.toISOString(),
        }
      : null,
  };
}

const clientLookupSelect = {
  id: true,
  name: true,
  phone: true,
  loyaltyCount: true,
  memberships: {
    where: { status: "ACTIVE" as const },
    orderBy: { endAt: "desc" as const },
    select: {
      id: true,
      status: true,
      endAt: true,
      cutsUsed: true,
      membership: { select: { name: true, includedCuts: true } },
    },
  },
} satisfies Prisma.BarberClientSelect;

export async function lookupClients(ctx: BarberContext, q: string, now: Date = new Date()): Promise<ClientLookup[]> {
  assertBarberPermission(ctx, "cash.view");
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const rows = await prisma.barberClient.findMany({
    where: {
      barbershopId: ctx.barbershopId,
      blockedAt: null,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    take: 8,
    select: clientLookupSelect,
  });
  return rows.map((c) => toClientLookup(c, now));
}

export async function getCheckoutContext(
  ctx: BarberContext,
  features: Record<string, boolean>,
  now: Date = new Date(),
): Promise<CheckoutContext> {
  assertBarberPermission(ctx, "cash.view");
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  const todayStart = startOfDayInTz(now, tz);
  const windowStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(todayStart.getTime() + 2 * 24 * 60 * 60 * 1000);

  const [services, products, barbers, appointments] = await Promise.all([
    prisma.barberService.findMany({
      where: { barbershopId: ctx.barbershopId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true, durationMin: true, category: true },
    }),
    features.products === true ? listProducts(ctx, { forSale: true }) : Promise.resolve([] as ProductRow[]),
    prisma.barber.findMany({
      where: { barbershopId: ctx.barbershopId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, nickname: true, commissionType: true },
    }),
    prisma.barberAppointment.findMany({
      where: {
        barbershopId: ctx.barbershopId,
        status: "DONE",
        startAt: { gte: windowStart, lt: windowEnd },
      },
      orderBy: { startAt: "asc" },
      include: {
        barber: { select: { name: true, nickname: true } },
        client: { select: clientLookupSelect },
        services: { include: { service: { select: { name: true } } } },
        sales: { select: { notes: true } },
      },
    }),
  ]);

  const pending: PendingAppointment[] = appointments
    .filter((a) => a.sales.every((s) => isSaleCancelled(s)))
    .map((a) => ({
      id: a.id,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
      barberId: a.barberId,
      barberName: a.barber ? a.barber.nickname || a.barber.name : null,
      clientId: a.clientId,
      clientName: a.client?.name ?? a.clientName,
      clientPhone: a.client?.phone ?? a.clientPhone,
      client: a.client ? toClientLookup(a.client, now) : null,
      services: a.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.service.name,
        priceAtBooking: toNum(s.priceAtBooking),
      })),
    }));

  return {
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      price: toNum(s.price),
      durationMin: s.durationMin,
      category: s.category,
    })),
    products,
    barbers,
    pendingAppointments: pending,
    loyaltyTarget: BARBER_LOYALTY_STAMPS_TARGET,
    features: {
      products: features.products === true,
      tips: features.tips === true,
      commissions: features.commissions === true,
    },
  };
}

// ── Cobro ───────────────────────────────────────────────────────────────

export interface SaleLineInput {
  kind: "service" | "product";
  id: string;
  qty?: number;
}

export interface CreateSaleInput {
  appointmentId?: string | null;
  clientId?: string | null;
  barberId?: string | null;
  items?: SaleLineInput[];
  discount?: unknown;
  tip?: unknown;
  paymentMethod?: unknown;
  /** Índice (en `items`) de la línea de servicio que se canjea por lealtad. */
  redeemLoyaltyItemIndex?: number | null;
  /** Índice (en `items`) de la línea de servicio cubierta por la membresía. */
  membershipItemIndex?: number | null;
  notes?: unknown;
}

interface BuiltLine {
  kind: "service" | "product" | "adjustment";
  serviceId: string | null;
  productId: string | null;
  description: string;
  qty: number;
  unitPrice: Money;
}

function cleanNotes(raw: unknown, max = 500): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new BarberCajaError(400, "INVALID_INPUT", "notes: inválido");
  const s = raw.trim();
  if (!s) return null;
  if (s.length > max) throw new BarberCajaError(400, "INVALID_INPUT", "notes: demasiado largo");
  if (s.startsWith(CANCELLED_MARK)) {
    throw new BarberCajaError(400, "INVALID_INPUT", "La nota no puede empezar con la marca de cancelación");
  }
  return s;
}

function optionalId(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 64) throw new BarberCajaError(400, "INVALID_INPUT", `${field}: inválido`);
  return v;
}

function optionalIndex(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (!Number.isInteger(v) || (v as number) < 0) throw new BarberCajaError(400, "INVALID_INPUT", `${field}: inválido`);
  return v as number;
}

/**
 * Cobra un ticket. Ver cabecera del módulo para las reglas. `features` es el
 * mapa del plan (assertBarberFeature/resolveBarberFeatures): los productos
 * solo se venden con features.products; la propina exige features.tips.
 */
export async function createSale(
  ctx: BarberContext,
  input: CreateSaleInput,
  features: Record<string, boolean>,
  now: Date = new Date(),
): Promise<SaleRow> {
  assertBarberPermission(ctx, "cash.manage");
  const barbershopId = ctx.barbershopId;
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;

  // ── Validación de forma (sin tocar la BD) ──
  const appointmentId = optionalId(input.appointmentId, "appointmentId");
  let clientId = optionalId(input.clientId, "clientId");
  let barberId = optionalId(input.barberId, "barberId");
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0 || rawItems.length > 50) {
    throw new BarberCajaError(400, "EMPTY_TICKET", "El ticket necesita al menos una línea");
  }
  const lines: Array<{ kind: "service" | "product"; id: string; qty: number }> = rawItems.map((it, i) => {
    if (!it || (it.kind !== "service" && it.kind !== "product") || typeof it.id !== "string" || !it.id) {
      throw new BarberCajaError(400, "INVALID_INPUT", `items[${i}]: línea inválida`);
    }
    return { kind: it.kind, id: it.id, qty: parseQty(it.qty ?? 1, `items[${i}].qty`) };
  });
  const paymentMethod = input.paymentMethod as BarberPaymentMethod;
  if (!POS_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new BarberCajaError(400, "INVALID_PAYMENT_METHOD", "Método de pago inválido (efectivo, tarjeta o SPEI)");
  }
  const discount = parseMoneyInput(input.discount, { field: "discount" });
  const tip = parseMoneyInput(input.tip, { field: "tip" });
  const notes = cleanNotes(input.notes);
  const loyaltyIdx = optionalIndex(input.redeemLoyaltyItemIndex, "redeemLoyaltyItemIndex");
  const membershipIdx = optionalIndex(input.membershipItemIndex, "membershipItemIndex");
  if (loyaltyIdx !== null && membershipIdx !== null && loyaltyIdx === membershipIdx) {
    throw new BarberCajaError(400, "INVALID_INPUT", "Una misma línea no puede canjearse por lealtad y membresía");
  }
  if (lines.some((l) => l.kind === "product") && features.products !== true) {
    throw new BarberCajaError(403, "FEATURE_NOT_IN_PLAN", `Tu plan no incluye "${barberFeatureLabel("products")}"`, { feature: "products" });
  }
  if (!tip.isZero() && features.tips !== true) {
    throw new BarberCajaError(403, "FEATURE_NOT_IN_PLAN", `Tu plan no incluye "${barberFeatureLabel("tips")}"`, { feature: "tips" });
  }

  const sale = await prisma.$transaction(
    async (tx) => {
      // 1. Turno abierto (se re-verifica DENTRO de la transacción).
      const session = await tx.barberCashSession.findFirst({
        where: { barbershopId, closedAt: null },
        select: { id: true },
      });
      if (!session) throw new BarberCajaError(409, "NO_OPEN_SESSION", "Abre un turno antes de cobrar");

      // 2. Cita (opcional): de esta barbería, no cancelada, sin ticket vivo.
      let frozen = new Map<string, Money>();
      if (appointmentId) {
        const appt = await tx.barberAppointment.findFirst({
          where: { id: appointmentId, barbershopId },
          include: { services: true, sales: { select: { notes: true } } },
        });
        if (!appt) throw new BarberCajaError(404, "APPOINTMENT_NOT_FOUND", "Cita no encontrada");
        if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
          throw new BarberCajaError(409, "APPOINTMENT_NOT_CHARGEABLE", "Esa cita está cancelada o no llegó");
        }
        if (appt.sales.some((s) => !isSaleCancelled(s))) {
          throw new BarberCajaError(409, "ALREADY_CHARGED", "Esa cita ya tiene un ticket cobrado");
        }
        frozen = new Map(appt.services.map((s) => [s.serviceId, D(s.priceAtBooking)]));
        if (!barberId && appt.barberId) barberId = appt.barberId;
        if (!clientId && appt.clientId) clientId = appt.clientId;
      }

      // 3. Barbero y cliente de ESTA barbería.
      const barber = barberId
        ? await tx.barber.findFirst({
            where: { id: barberId, barbershopId },
            select: { id: true, isActive: true, commissionType: true, commissionPct: true, chairRent: true },
          })
        : null;
      if (barberId && !barber) throw new BarberCajaError(404, "BARBER_NOT_FOUND", "Barbero no encontrado");
      if (barber && !barber.isActive) throw new BarberCajaError(409, "BARBER_INACTIVE", "Ese barbero está inactivo");
      if (!barber && !tip.isZero()) {
        throw new BarberCajaError(400, "TIP_NEEDS_BARBER", "La propina necesita un barbero al que atribuirla");
      }
      const client = clientId
        ? await tx.barberClient.findFirst({ where: { id: clientId, barbershopId }, select: clientLookupSelect })
        : null;
      if (clientId && !client) throw new BarberCajaError(404, "CLIENT_NOT_FOUND", "Cliente no encontrado");

      // 4. Líneas con precio del catálogo (o congelado de la cita).
      const serviceIds = Array.from(new Set(lines.filter((l) => l.kind === "service").map((l) => l.id)));
      const productIds = Array.from(new Set(lines.filter((l) => l.kind === "product").map((l) => l.id)));
      const [services, products] = await Promise.all([
        serviceIds.length
          ? tx.barberService.findMany({ where: { id: { in: serviceIds }, barbershopId }, select: { id: true, name: true, price: true, isActive: true } })
          : Promise.resolve([]),
        productIds.length
          ? tx.barberProduct.findMany({ where: { id: { in: productIds }, barbershopId }, select: { id: true, name: true, price: true, isActive: true } })
          : Promise.resolve([]),
      ]);
      const serviceById = new Map(services.map((s) => [s.id, s]));
      const productById = new Map(products.map((p) => [p.id, p]));

      const built: BuiltLine[] = lines.map((l, i) => {
        if (l.kind === "service") {
          const s = serviceById.get(l.id);
          if (!s) throw new BarberCajaError(404, "SERVICE_NOT_FOUND", `items[${i}]: servicio no encontrado`);
          const price = frozen.get(s.id);
          if (!price && !s.isActive) {
            throw new BarberCajaError(409, "SERVICE_INACTIVE", `"${s.name}" ya no está en el catálogo`);
          }
          return { kind: "service", serviceId: s.id, productId: null, description: s.name, qty: l.qty, unitPrice: price ?? D(s.price) };
        }
        const p = productById.get(l.id);
        if (!p) throw new BarberCajaError(404, "PRODUCT_NOT_FOUND", `items[${i}]: producto no encontrado`);
        if (!p.isActive) throw new BarberCajaError(409, "PRODUCT_INACTIVE", `"${p.name}" está retirado del catálogo`);
        return { kind: "product", serviceId: null, productId: p.id, description: p.name, qty: l.qty, unitPrice: D(p.price) };
      });

      // 5. Canjes: lealtad y membresía cubren UNA línea de servicio cada uno.
      let loyaltyRedeemed = false;
      let membershipUsed: { id: string } | null = null;
      if (loyaltyIdx !== null) {
        const target = built[loyaltyIdx];
        if (!target || target.kind !== "service") {
          throw new BarberCajaError(400, "INVALID_INPUT", "El canje de lealtad debe apuntar a un servicio del ticket");
        }
        if (!client) throw new BarberCajaError(400, "LOYALTY_NEEDS_CLIENT", "Elige al cliente para canjear su corte gratis");
        if (client.loyaltyCount < BARBER_LOYALTY_STAMPS_TARGET) {
          throw new BarberCajaError(409, "LOYALTY_NOT_ELIGIBLE", `El cliente tiene ${client.loyaltyCount} de ${BARBER_LOYALTY_STAMPS_TARGET} sellos`);
        }
        if (target.qty !== 1) throw new BarberCajaError(400, "INVALID_INPUT", "El corte gratis aplica a una línea de cantidad 1");
        target.unitPrice = ZERO;
        target.description = `${target.description}${LOYALTY_SUFFIX}`;
        loyaltyRedeemed = true;
      }
      if (membershipIdx !== null) {
        const target = built[membershipIdx];
        if (!target || target.kind !== "service") {
          throw new BarberCajaError(400, "INVALID_INPUT", "La membresía debe aplicarse a un servicio del ticket");
        }
        if (!client) throw new BarberCajaError(400, "MEMBERSHIP_NEEDS_CLIENT", "Elige al cliente para usar su membresía");
        const lookup = toClientLookup(client, now);
        if (!lookup.activeMembership) {
          throw new BarberCajaError(409, "MEMBERSHIP_NOT_ACTIVE", "El cliente no tiene una membresía activa con cupo");
        }
        if (target.qty !== 1) throw new BarberCajaError(400, "INVALID_INPUT", "La membresía cubre una línea de cantidad 1");
        target.unitPrice = ZERO;
        target.description = `${target.description}${MEMBERSHIP_SUFFIX}`;
        membershipUsed = { id: lookup.activeMembership.id };
      }

      // 6. Descuento del ticket como línea de ajuste (negativa).
      const gross = sumMoney(built.map(lineTotal));
      if (discount.gt(gross)) {
        throw new BarberCajaError(400, "DISCOUNT_TOO_BIG", "El descuento no puede superar el total de las líneas");
      }
      if (!discount.isZero()) {
        built.push({ kind: "adjustment", serviceId: null, productId: null, description: DISCOUNT_DESCRIPTION, qty: 1, unitPrice: discount.negated() });
      }

      // 7. Totales — redondeo ÚNICO al final.
      const subtotal = money(sumMoney(built.map(lineTotal)));
      if (subtotal.isNegative()) throw new BarberCajaError(400, "INVALID_INPUT", "El subtotal no puede ser negativo");
      const total = money(subtotal.plus(tip));

      // 8. Ticket + líneas.
      const created = await tx.barberSale.create({
        data: {
          barbershopId,
          appointmentId,
          clientId: client?.id ?? null,
          barberId: barber?.id ?? null,
          subtotal,
          tip: money(tip),
          total,
          paymentMethod,
          cashSessionId: session.id,
          soldByUserId: ctx.barberUserId,
          notes,
          createdAt: now,
          items: {
            create: built.map((b) => ({
              serviceId: b.serviceId,
              productId: b.productId,
              description: b.description,
              qty: b.qty,
              unitPrice: money(b.unitPrice),
            })),
          },
        },
        select: { id: true },
      });

      // 9. Stock: cada producto vendido descuenta (guarda anti-negativo) y
      //    deja su movimiento SALE en esta misma transacción.
      for (const b of built) {
        if (b.kind !== "product" || !b.productId) continue;
        await applyStockDelta(tx, {
          barbershopId,
          productId: b.productId,
          delta: -b.qty,
          type: "SALE",
          reason: "Venta",
          saleId: created.id,
          userId: ctx.barberUserId,
          requireActive: true,
        });
      }

      // 10. Comisión: una entrada por venta con barbero, base SIN propina.
      if (barber) {
        const policy = await getCommissionPolicy(barbershopId);
        const commissionLines: CommissionLine[] = built.map((b) => ({ kind: b.kind, qty: b.qty, unitPrice: b.unitPrice }));
        const base = commissionBaseFor(commissionLines, policy);
        const result = computeCommission(barber, base);
        await tx.barberCommissionEntry.create({
          data: {
            barbershopId,
            barberId: barber.id,
            saleId: created.id,
            appointmentId,
            base: result.base,
            pct: result.pct,
            amount: result.amount,
            periodKey: periodKeyFor(now, tz),
            createdAt: now,
          },
        });
      }

      // 11. Canjes: consumir sellos / cupo de la membresía.
      if (loyaltyRedeemed && client) {
        const r = await tx.barberClient.updateMany({
          where: { id: client.id, barbershopId, loyaltyCount: { gte: BARBER_LOYALTY_STAMPS_TARGET } },
          data: { loyaltyCount: { decrement: BARBER_LOYALTY_STAMPS_TARGET } },
        });
        if (r.count === 0) throw new BarberCajaError(409, "LOYALTY_NOT_ELIGIBLE", "El cliente ya no tiene sellos suficientes");
      }
      if (membershipUsed) {
        await tx.barberClientMembership.updateMany({
          where: { id: membershipUsed.id, barbershopId },
          data: { cutsUsed: { increment: 1 } },
        });
      }

      return tx.barberSale.findUniqueOrThrow({ where: { id: created.id }, include: saleInclude });
    },
    { maxWait: 5000, timeout: 15000 },
  );

  return toSaleRow(sale);
}

// ── Cancelación ─────────────────────────────────────────────────────────

/**
 * Soft-cancel del ticket (ver cabecera). Requisitos: cash.manage, ticket de
 * ESTA barbería, aún no cancelado, su turno sigue ABIERTO y ninguna entrada
 * de comisión del ticket está pagada. Devuelve stock (RETURN), borra líneas
 * y comisión, restituye sellos/cupo y deja la marca con quién/cuándo/motivo.
 */
export async function cancelSale(
  ctx: BarberContext,
  saleId: string,
  input: { reason?: unknown } = {},
  now: Date = new Date(),
): Promise<SaleRow> {
  assertBarberPermission(ctx, "cash.manage");
  const barbershopId = ctx.barbershopId;
  const reason = cleanNotes(input.reason, 300);
  if (!reason) throw new BarberCajaError(400, "INVALID_INPUT", "Indica el motivo de la cancelación");

  const sale = await prisma.$transaction(
    async (tx) => {
      const s = await tx.barberSale.findFirst({
        where: { id: saleId, barbershopId },
        include: {
          items: true,
          cashSession: { select: { closedAt: true } },
          commissionEntries: { select: { id: true, paidAt: true } },
        },
      });
      if (!s) throw new BarberCajaError(404, "SALE_NOT_FOUND", "Ticket no encontrado");
      if (isSaleCancelled(s)) throw new BarberCajaError(409, "ALREADY_CANCELLED", "Ese ticket ya está cancelado");
      if (s.cashSession && s.cashSession.closedAt) {
        throw new BarberCajaError(
          409,
          "SESSION_CLOSED",
          "El turno de ese ticket ya se cerró. Registra la corrección en un turno nuevo con una nota.",
        );
      }
      if (s.commissionEntries.some((e) => e.paidAt)) {
        throw new BarberCajaError(409, "COMMISSION_PAID", "La comisión de ese ticket ya se pagó; ajústala en el siguiente periodo");
      }

      // Stock de vuelta, con su RETURN ligado al ticket.
      for (const it of s.items) {
        if (!it.productId) continue;
        await applyStockDelta(tx, {
          barbershopId,
          productId: it.productId,
          delta: it.qty,
          type: "RETURN",
          reason: "Cancelación de ticket",
          saleId: s.id,
          userId: ctx.barberUserId,
        });
      }

      // Canjes restituidos.
      if (s.clientId) {
        if (s.items.some((it) => it.description.endsWith(LOYALTY_SUFFIX))) {
          await tx.barberClient.updateMany({
            where: { id: s.clientId, barbershopId },
            data: { loyaltyCount: { increment: BARBER_LOYALTY_STAMPS_TARGET } },
          });
        }
        if (s.items.some((it) => it.description.endsWith(MEMBERSHIP_SUFFIX))) {
          const m = await tx.barberClientMembership.findFirst({
            where: { clientId: s.clientId, barbershopId, cutsUsed: { gt: 0 } },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          });
          if (m) {
            await tx.barberClientMembership.updateMany({ where: { id: m.id, barbershopId }, data: { cutsUsed: { decrement: 1 } } });
          }
        }
      }

      await tx.barberCommissionEntry.deleteMany({ where: { saleId: s.id, barbershopId } });
      await tx.barberSaleItem.deleteMany({ where: { saleId: s.id } });

      const who = `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
      const original = `${itemsSummaryOf(s.items)} · subtotal ${money(s.subtotal).toFixed(2)} · propina ${money(s.tip).toFixed(2)} · total ${money(s.total).toFixed(2)} (${s.paymentMethod})`;
      const marker = `${CANCELLED_MARK} ${now.toISOString()} · ${who} · ${reason} · Original: ${original}`;

      await tx.barberSale.update({
        where: { id: s.id },
        data: {
          subtotal: ZERO,
          tip: ZERO,
          total: ZERO,
          notes: s.notes ? `${marker}\n${s.notes}` : marker,
        },
      });
      return tx.barberSale.findUniqueOrThrow({ where: { id: s.id }, include: saleInclude });
    },
    { maxWait: 5000, timeout: 15000 },
  );
  return toSaleRow(sale);
}

// ── Lectura de tickets ──────────────────────────────────────────────────

export async function getSaleDetail(ctx: BarberContext, saleId: string): Promise<SaleDetail | null> {
  assertBarberPermission(ctx, "cash.view");
  const s = await prisma.barberSale.findFirst({ where: { id: saleId, barbershopId: ctx.barbershopId }, include: saleInclude });
  if (!s) return null;
  const row = toSaleRow(s);
  const gross = sumMoney(row.items.filter((it) => it.unitPrice >= 0).map((it) => D(it.unitPrice).times(it.qty)));
  const discount = sumMoney(row.items.filter((it) => it.unitPrice < 0).map((it) => D(it.unitPrice).times(it.qty))).abs();
  const shop = ctx.barbershop;
  return {
    ...row,
    shop: {
      name: shop.name,
      address: shop.address,
      city: shop.city,
      state: shop.state,
      phone: shop.phone,
      logoUrl: shop.logoUrl,
      timezone: shop.timezone || DEFAULT_BARBER_TZ,
    },
    grossItems: toNum(gross),
    discount: toNum(discount),
  };
}

export async function listSales(
  ctx: BarberContext,
  opts: { sessionId?: string | null; limit?: number } = {},
): Promise<SaleRow[]> {
  assertBarberPermission(ctx, "cash.view");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await prisma.barberSale.findMany({
    where: { barbershopId: ctx.barbershopId, ...(opts.sessionId ? { cashSessionId: opts.sessionId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: saleInclude,
  });
  return rows.map(toSaleRow);
}
