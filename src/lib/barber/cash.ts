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
//  · Lealtad: la caja lee los sellos RECONTADOS en el momento (no la
//    columna, que es caché) y aplica la regla de la barbería: su umbral, su
//    premio y si la tiene encendida. Cobrar y cancelar un ticket refrescan
//    el contador dentro de la misma transacción.
//  · TODO el dinero del mostrador pasa por un ticket del turno abierto,
//    también el que no es una visita: la venta o renovación de una membresía
//    y el anticipo de una cita entran como «ticket de mostrador»
//    (createCounterTicketTx): una línea sin servicio ni producto, sin barbero
//    y sin comisión, con un sello en `notes` (memberships-core.ts) que dice
//    de qué membresía o cita es. Cancelar ese ticket deshace lo que vendió.
//  · El anticipo PAGADO de una cita se descuenta solo al cobrarla: línea de
//    crédito negativa dentro de la MISMA transacción del cobro, con la cita
//    bloqueada (FOR UPDATE) para que no se aplique dos veces. No toca la
//    base de comisión: el barbero comisiona sobre el servicio completo.
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
import { clientsViewScope, scopeClientsWhere, scopeUserFromCtx } from "@/lib/barber/own-visits";
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
import {
  LOYALTY_DEFAULT_THRESHOLD,
  LOYALTY_SUFFIX,
  loyaltyBonusLineDescription,
  loyaltyLineSuffix,
  refreshLoyalty,
  type LoyaltyRule,
} from "@/lib/barber/loyalty-core";
import {
  loadAppointmentDraftLines,
  markSaleDraftChargedTx,
  reopenSaleDraftOfCancelledSaleTx,
  saleDraftsReady,
} from "@/lib/barber/sale-drafts-core";
import {
  checkOrderLines,
  isOpenOrderStatus,
  lockOrderForChargeTx,
  markOrderPickedUpTx,
  reopenOrderOfCancelledSaleTx,
  tiendaReady,
  type OrderForCharge,
} from "@/lib/barber/tienda-core";
import {
  activeBonuses,
  availableBonuses,
  legacyBonus,
  loadBonusCatalog,
  seededBonusId,
  type StarBonus,
} from "@/lib/barber/stars-core";
import {
  BARBER_DEPOSIT_LINE_PREFIX,
  BARBER_SALE_TAG_PREFIX,
  buildSaleTag,
  depositLineDescription,
  isCounterTicketLine,
  isDepositLine,
  isDepositRefundLine,
  parseSaleTag,
  pickCurrentPeriod,
  saleKindOf,
  stripSaleTag,
  upcomingPeriods,
  type BarberSaleKind,
  type BarberSaleTag,
} from "@/lib/barber/memberships-core";

type Tx = Prisma.TransactionClient;

// ── Constantes del módulo ───────────────────────────────────────────────

/** Sellos por defecto para el premio. La caja ya NO usa este número fijo:
 *  lee el umbral, el premio y el encendido que configuró cada barbería
 *  (getLoyaltyRule). Se conserva por compatibilidad con quien lo importaba. */
export const BARBER_LOYALTY_STAMPS_TARGET = LOYALTY_DEFAULT_THRESHOLD;

/** Métodos que acepta el mostrador. STRIPE es del pago en línea (T5/T6). */
export const POS_PAYMENT_METHODS: BarberPaymentMethod[] = ["CASH", "CARD", "SPEI"];

/** Sufijos que marcan una línea cubierta (canje). El de lealtad vive en
 *  loyalty-core.ts (dice además cuántos sellos costó: loyaltyLineSuffix);
 *  el de membresía lo lee cancelSale para restituir el cupo. */
export { LOYALTY_SUFFIX };
export const MEMBERSHIP_SUFFIX = " · Membresía";

const DISCOUNT_DESCRIPTION = "Descuento";

/**
 * ¿El descuento de un BONO de estrellas (en pesos o en %) baja la comisión
 * del barbero? false = no: igual que el servicio gratis por bono (decisión de
 * Rafael del 14-nov-2026), el premio lo paga la barbería y el barbero
 * comisiona como si no hubiera bono. Un descuento NORMAL del ticket sí la
 * baja, como siempre. DECISIÓN PARA RAFAEL (reporte ws6-t5): una constante.
 */
export const BONUS_DISCOUNT_REDUCES_COMMISSION = false;

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
  /** Nota escrita a mano. El sello interno del ticket nunca viaja aquí. */
  notes: string | null;
  cancelled: boolean;
  /** "sale" = cobro normal; "membership" / "deposit" = ticket de mostrador. */
  kind: BarberSaleKind;
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
  /** Descuentos del ticket. El anticipo aplicado NO es un descuento. */
  discount: number;
  /** Anticipo de la cita descontado en este ticket (0 si no hubo). */
  depositApplied: number;
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
  /** Estrellas vivas, recontadas al leer (no la caché de la columna). */
  loyaltyCount: number;
  /** Tarjeta encendida en la barbería Y alcanza al menos un bono. */
  loyaltyEligible: boolean;
  /** Ids de los bonos que ya puede canjear (catálogo en CheckoutContext.bonuses). */
  availableBonusIds: string[];
  activeMembership: {
    id: string;
    name: string;
    includedCuts: number | null;
    cutsUsed: number;
    cutsLeft: number | null;
    endAt: string;
  } | null;
  /**
   * Próximo periodo YA PAGADO (renovación anticipada, D1): empieza cuando
   * termina el vigente y trae su propio cupo. No se gasta antes de tiempo.
   */
  nextMembershipPeriod?: { startAt: string; includedCuts: number | null; periods: number } | null;
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
  /** Anticipo PAGADO y todavía sin aplicar: se descuenta solo al cobrar. */
  deposit: { amount: number } | null;
  /**
   * Nota «Por cobrar» de la cita (cita «B»): los productos que se agregaron
   * desde la cita. El ticket los trae y, al cobrar, la nota queda saldada.
   * Solo productos activos del catálogo de hoy (con su precio de hoy).
   */
  draft?: { id: string; items: Array<{ productId: string; name: string; qty: number; unitPrice: number }> } | null;
}

export interface CheckoutContext {
  services: Array<{ id: string; name: string; price: number; durationMin: number; category: string }>;
  products: ProductRow[];
  barbers: Array<{ id: string; name: string; nickname: string | null; commissionType: BarberCommissionType }>;
  pendingAppointments: PendingAppointment[];
  /** Umbral de sellos que configuró la barbería (antes: 10 fijo). */
  loyaltyTarget: number;
  /** La barbería tiene encendida la tarjeta de lealtad. */
  loyaltyEnabled: boolean;
  /** Etiqueta del premio que configuró la barbería. */
  loyaltyReward: string;
  /** Bonos ACTIVOS de la barbería (el premio de siempre si no ha creado otros). */
  bonuses: StarBonus[];
  /** Existe la tabla de notas «Por cobrar» (sql/barber_por_cobrar.sql). */
  draftsReady: boolean;
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
    notes: stripSaleTag(s.notes),
    cancelled: isSaleCancelled(s),
    kind: saleKindOf(s.notes),
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
    startAt: Date;
    endAt: Date;
    cutsUsed: number;
    membershipId: string;
    membership: { name: string; includedCuts: number | null };
  }>;
}, now: Date, rule: LoyaltyRule, freshCount?: number, bonuses: StarBonus[] = [legacyBonus(rule)]): ClientLookup {
  // `freshCount` = recuento hecho ahora mismo (refreshLoyalty). Sin él se cae
  // a la columna, que quien llama acaba de refrescar o va a validar aparte.
  const loyaltyCount = freshCount ?? c.loyaltyCount;
  const ready = rule.enabled ? availableBonuses(loyaltyCount, bonuses) : [];
  // El periodo VIGENTE (D1): con renovaciones anticipadas hay varias filas
  // activas y solo la que ya empezó se gasta; las demás son «próximo periodo».
  const current = pickCurrentPeriod(c.memberships, now);
  const active =
    current && (current.membership.includedCuts === null || current.cutsUsed < current.membership.includedCuts)
      ? current
      : null;
  const upcoming = upcomingPeriods(c.memberships, now);
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    loyaltyCount,
    loyaltyEligible: ready.length > 0,
    availableBonusIds: ready.map((b) => b.id),
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
    nextMembershipPeriod: upcoming.length
      ? { startAt: upcoming[0].startAt.toISOString(), includedCuts: upcoming[0].membership.includedCuts, periods: upcoming.length }
      : null,
  };
}

const clientLookupSelect = {
  id: true,
  name: true,
  phone: true,
  loyaltyCount: true,
  memberships: {
    where: { status: { in: ["ACTIVE", "PAUSED"] as Array<"ACTIVE" | "PAUSED"> } },
    orderBy: { startAt: "asc" as const },
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      cutsUsed: true,
      membershipId: true,
      membership: { select: { name: true, includedCuts: true } },
    },
  },
} satisfies Prisma.BarberClientSelect;

export async function lookupClients(ctx: BarberContext, q: string, now: Date = new Date()): Promise<ClientLookup[]> {
  assertBarberPermission(ctx, "cash.view");
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  // Rol Barbero (con caja por permiso personal): solo SUS clientes (G1).
  const scope = scopeClientsWhere(clientsViewScope(scopeUserFromCtx(ctx))) as Prisma.BarberClientWhereInput | null;
  const rows = await prisma.barberClient.findMany({
    where: {
      barbershopId: ctx.barbershopId,
      blockedAt: null,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
      ...(scope ? { AND: [scope] } : {}),
    },
    orderBy: { name: "asc" },
    take: 8,
    select: clientLookupSelect,
  });
  // Sellos frescos y la regla de ESTA barbería: lo que diga la caja es lo
  // mismo que dice la ficha del cliente.
  const [catalog, fresh] = await Promise.all([
    loadBonusCatalog(prisma, ctx.barbershopId),
    refreshLoyalty(prisma, ctx.barbershopId, rows.map((c) => c.id)),
  ]);
  const bonuses = activeBonuses(catalog.bonuses);
  return rows.map((c) => toClientLookup(c, now, catalog.rule, fresh.get(c.id)?.count, bonuses));
}

/**
 * UN cliente para el cobro, por id (el «Nuevo cobro» de su ficha). Mismo
 * recorte que la búsqueda de Caja: de esta barbería/sede, no bloqueado y, para
 * el rol Barbero con caja por permiso personal, solo un cliente suyo. Sellos
 * y bonos frescos. null = no se puede cobrar a ese cliente desde aquí.
 */
export async function getClientLookup(ctx: BarberContext, clientId: string, now: Date = new Date()): Promise<ClientLookup | null> {
  assertBarberPermission(ctx, "cash.view");
  if (typeof clientId !== "string" || !clientId || clientId.length > 64) return null;
  const scope = scopeClientsWhere(clientsViewScope(scopeUserFromCtx(ctx))) as Prisma.BarberClientWhereInput | null;
  const row = await prisma.barberClient.findFirst({
    where: { id: clientId, barbershopId: ctx.barbershopId, blockedAt: null, ...(scope ? { AND: [scope] } : {}) },
    select: clientLookupSelect,
  });
  if (!row) return null;
  const [catalog, fresh] = await Promise.all([
    loadBonusCatalog(prisma, ctx.barbershopId),
    refreshLoyalty(prisma, ctx.barbershopId, [row.id]),
  ]);
  return toClientLookup(row, now, catalog.rule, fresh.get(row.id)?.count, activeBonuses(catalog.bonuses));
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

  const pendingRows = appointments.filter((a) => a.sales.every((s) => isSaleCancelled(s)));
  const [catalog, fresh] = await Promise.all([
    loadBonusCatalog(prisma, ctx.barbershopId),
    refreshLoyalty(prisma, ctx.barbershopId, pendingRows.map((a) => a.clientId)),
  ]);
  const rule = catalog.rule;
  const bonuses = activeBonuses(catalog.bonuses);

  // Productos agregados desde la cita (nota «Por cobrar» ligada a ella).
  const apptDrafts = features.products === true
    ? await loadAppointmentDraftLines(prisma, ctx.barbershopId, pendingRows.map((a) => a.id))
    : new Map<string, { draftId: string; items: Array<{ kind: "service" | "product"; id: string; qty: number }> }>();
  const productById = new Map(products.map((p) => [p.id, p]));
  const draftOf = (appointmentId: string): PendingAppointment["draft"] => {
    const d = apptDrafts.get(appointmentId);
    if (!d) return null;
    const items = d.items
      .filter((i) => i.kind === "product" && productById.has(i.id))
      .map((i) => {
        const p = productById.get(i.id)!;
        return { productId: p.id, name: p.name, qty: i.qty, unitPrice: p.price };
      });
    return { id: d.draftId, items };
  };

  const pending: PendingAppointment[] = pendingRows
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
      client: a.client ? toClientLookup(a.client, now, rule, fresh.get(a.client.id)?.count, bonuses) : null,
      services: a.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.service.name,
        priceAtBooking: toNum(s.priceAtBooking),
      })),
      // Sin ticket vivo (filtro de arriba) el anticipo pagado está sin aplicar.
      deposit: paidDepositOf(a) ? { amount: toNum(paidDepositOf(a)) } : null,
      draft: draftOf(a.id),
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
    loyaltyTarget: rule.threshold,
    loyaltyEnabled: rule.enabled,
    loyaltyReward: rule.reward,
    bonuses,
    draftsReady: await saleDraftsReady(prisma),
    features: {
      products: features.products === true,
      tips: features.tips === true,
      commissions: features.commissions === true,
    },
  };
}

// ── Anticipo de la cita ─────────────────────────────────────────────────

/** Monto del anticipo PAGADO de una cita (null si no hay o no está pagado). */
function paidDepositOf(appt: {
  depositAmount: Prisma.Decimal | string | number | null;
  depositStatus: string | null;
}): Money | null {
  if (appt.depositStatus !== "PAID") return null;
  const amount = money(appt.depositAmount);
  return amount.gt(0) ? amount : null;
}

function depositLabel(startAt: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", timeZone: tz }).format(startAt);
  } catch {
    return startAt.toISOString().slice(0, 10);
  }
}

/**
 * Candado de fila sobre la cita. Serializa a todo el que cobre, registre un
 * anticipo o cancele un ticket de ESA cita a la vez: el segundo espera y ve
 * lo que dejó el primero. Devuelve false si la cita no es de esta barbería.
 */
export async function lockAppointmentTx(tx: Tx, barbershopId: string, appointmentId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "barber_appointments"
    WHERE "id" = ${appointmentId} AND "barbershopId" = ${barbershopId}
    FOR UPDATE
  `;
  return rows.length > 0;
}

// ── Ticket de mostrador (membresía vendida / anticipo recibido) ─────────

export interface CounterTicketInput {
  barbershopId: string;
  soldByUserId: string;
  clientId: string | null;
  /** Descripción de la única línea (ver los prefijos de memberships-core.ts). */
  description: string;
  amount: Money;
  paymentMethod: unknown;
  tag: BarberSaleTag;
  now: Date;
  /** Qué decirle a la persona si no hay turno abierto. */
  noSessionMessage: string;
}

/**
 * Crea, DENTRO de la transacción de quien llama, el ticket de un cobro de
 * mostrador que no es una visita. Exige turno abierto (si no, 409
 * NO_OPEN_SESSION y la transacción entera se deshace: no queda membresía ni
 * anticipo sin dinero en el corte). Sin barbero → sin comisión y sin propina.
 */
export async function createCounterTicketTx(tx: Tx, input: CounterTicketInput): Promise<{ id: string; cashSessionId: string }> {
  const paymentMethod = input.paymentMethod as BarberPaymentMethod;
  if (!POS_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new BarberCajaError(400, "INVALID_PAYMENT_METHOD", "Elige cómo pagó: efectivo, transferencia o tarjeta en mostrador");
  }
  const amount = money(input.amount);
  // El ÚNICO ticket negativo que existe es la devolución de un anticipo: el
  // dinero sale del cajón (o de la cuenta) el día que se devuelve, así que
  // resta en el corte de ESE turno y en el ingreso de ese día. Todo lo demás
  // es estrictamente positivo.
  const isRefund = input.tag.k === "refund";
  if (isRefund ? !amount.lt(0) : !amount.gt(0)) {
    throw new BarberCajaError(400, "INVALID_AMOUNT", isRefund ? "La devolución debe ser un monto negativo" : "El monto debe ser mayor a cero");
  }
  if (!isCounterTicketLine(input.description) || isDepositRefundLine(input.description) !== isRefund) {
    throw new BarberCajaError(500, "INVALID_COUNTER_TICKET", "Línea de ticket de mostrador inválida");
  }

  const session = await tx.barberCashSession.findFirst({
    where: { barbershopId: input.barbershopId, closedAt: null },
    select: { id: true },
  });
  if (!session) throw new BarberCajaError(409, "NO_OPEN_SESSION", input.noSessionMessage);

  const created = await tx.barberSale.create({
    data: {
      barbershopId: input.barbershopId,
      appointmentId: null,
      clientId: input.clientId,
      barberId: null,
      subtotal: amount,
      tip: ZERO,
      total: amount,
      paymentMethod,
      cashSessionId: session.id,
      soldByUserId: input.soldByUserId,
      notes: buildSaleTag(input.tag),
      createdAt: input.now,
      items: { create: [{ serviceId: null, productId: null, description: input.description, qty: 1, unitPrice: amount }] },
    },
    select: { id: true },
  });
  return { id: created.id, cashSessionId: session.id };
}

/** Ticket de anticipo VIVO de una cita (el que la caja cobró en mostrador). */
export async function findLiveDepositTicketTx(
  tx: Tx,
  barbershopId: string,
  appointmentId: string,
): Promise<{ id: string; sessionClosed: boolean; paymentMethod: BarberPaymentMethod } | null> {
  const rows = await tx.barberSale.findMany({
    where: { barbershopId, notes: { contains: `"appt":"${appointmentId}"` } },
    select: { id: true, notes: true, paymentMethod: true, cashSession: { select: { closedAt: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) {
    if (isSaleCancelled(r)) continue;
    const tag = parseSaleTag(r.notes);
    if (tag && tag.k === "deposit" && tag.appt === appointmentId) {
      return { id: r.id, sessionClosed: Boolean(r.cashSession?.closedAt), paymentMethod: r.paymentMethod };
    }
  }
  return null;
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
  /**
   * Descuento en PORCENTAJE (0 < % ≤ 100, hasta dos decimales). Excluye a
   * `discount`: es uno u otro. Se calcula sobre lo que queda del ticket tras
   * los canjes y el bono, y termina en la MISMA línea «Descuento» que el de
   * pesos (mismo tope, misma comisión, mismo corte).
   */
  discountPct?: unknown;
  tip?: unknown;
  paymentMethod?: unknown;
  /** Índice (en `items`) de la línea de servicio que se canjea por lealtad. */
  redeemLoyaltyItemIndex?: number | null;
  /**
   * Bono de estrellas que se aplica (id del catálogo de la barbería). Sin él,
   * `redeemLoyaltyItemIndex` canjea el premio de siempre (compatibilidad).
   * Un bono de servicio gratis usa `redeemLoyaltyItemIndex` para la línea;
   * los de descuento y «otro» no la necesitan.
   */
  redeemBonusId?: string | null;
  /** Índice (en `items`) de la línea de servicio cubierta por la membresía. */
  membershipItemIndex?: number | null;
  /**
   * Nota «Por cobrar» que este cobro salda. Se marca COBRADA en esta misma
   * transacción, una sola vez: si ya se cobró o descartó, el ticket no se crea.
   */
  draftId?: string | null;
  /**
   * Pedido de la tienda que este cobro ENTREGA (ws6-t1). Sus productos van a
   * su precio CONGELADO al apartar; el pedido queda PICKED_UP con el id del
   * ticket en esta misma transacción, una sola vez. Si se pagó en línea, el
   * ticket va con paymentMethod STRIPE («Pago en línea»: fuera del efectivo
   * del turno, dentro de los reportes) y tal cual se pagó.
   */
  productOrderId?: string | null;
  notes?: unknown;
}

interface BuiltLine {
  /**
   * "deposit" = crédito del anticipo: resta del total, NO de la base de comisión.
   * "bonus"   = descuento (o regalo en $0) de un bono de estrellas: resta del
   *             total; de la comisión solo si BONUS_DISCOUNT_REDUCES_COMMISSION.
   */
  kind: "service" | "product" | "adjustment" | "deposit" | "bonus";
  /**
   * Precio NORMAL del servicio cuando la línea va cubierta (membresía o
   * premio de lealtad) y por eso se cobra en $0. Solo lo usa la comisión: el
   * barbero hizo el corte y comisiona sobre lo que vale, aunque el cliente
   * no pague nada en este ticket. El ingreso de la barbería no lo ve.
   */
  commissionUnitPrice?: Money;
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
  // El sello interno de los tickets de mostrador solo lo escribe el servidor.
  if (s.includes(BARBER_SALE_TAG_PREFIX)) {
    throw new BarberCajaError(400, "INVALID_INPUT", `La nota no puede contener "${BARBER_SALE_TAG_PREFIX.trim()}"`);
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

/** % de descuento: null si no viene; 400 si no es un número de (0, 100] con hasta 2 decimales. */
export function parseDiscountPct(raw: unknown): Money | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
    throw new BarberCajaError(400, "INVALID_INPUT", "discountPct: porcentaje inválido");
  }
  const pct = D(text);
  if (pct.lte(0) || pct.gt(100)) {
    throw new BarberCajaError(400, "INVALID_INPUT", "El descuento en % va de 0.01 a 100");
  }
  return pct;
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
  const productOrderId = optionalId(input.productOrderId, "productOrderId");
  const paymentMethod = input.paymentMethod as BarberPaymentMethod;
  // «Pago en línea» (STRIPE) solo existe para entregar un pedido de la tienda
  // ya pagado: dentro de la transacción se exige que lo esté.
  const onlinePaidDelivery = productOrderId !== null && paymentMethod === "STRIPE";
  if (!POS_PAYMENT_METHODS.includes(paymentMethod) && !onlinePaidDelivery) {
    throw new BarberCajaError(400, "INVALID_PAYMENT_METHOD", "Método de pago inválido (efectivo, tarjeta o SPEI)");
  }
  const discountAmount = parseMoneyInput(input.discount, { field: "discount" });
  const discountPct = parseDiscountPct(input.discountPct);
  if (discountPct !== null && !discountAmount.isZero()) {
    throw new BarberCajaError(400, "DISCOUNT_BOTH", "El descuento va en pesos o en porcentaje, no los dos");
  }
  const tip = parseMoneyInput(input.tip, { field: "tip" });
  const notes = cleanNotes(input.notes);
  let loyaltyIdx = optionalIndex(input.redeemLoyaltyItemIndex, "redeemLoyaltyItemIndex");
  const bonusId = optionalId(input.redeemBonusId, "redeemBonusId");
  const draftId = optionalId(input.draftId, "draftId");
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
  if (onlinePaidDelivery) {
    // Lo pagado en línea se registra tal cual se pagó: ni descuento, ni
    // propina, ni canjes, ni otra cosa que se cobre aparte.
    if (!discountAmount.isZero() || discountPct !== null || !tip.isZero() || loyaltyIdx !== null || bonusId !== null || membershipIdx !== null || draftId !== null || appointmentId !== null) {
      throw new BarberCajaError(400, "ORDER_PAID_AS_IS", "Un pedido pagado en línea se entrega tal cual: sin descuento, propina ni canjes");
    }
  }

  const sale = await prisma.$transaction(
    async (tx) => {
      // 1. Turno abierto (se re-verifica DENTRO de la transacción).
      const session = await tx.barberCashSession.findFirst({
        where: { barbershopId, closedAt: null },
        select: { id: true },
      });
      if (!session) throw new BarberCajaError(409, "NO_OPEN_SESSION", "Abre un turno antes de cobrar");

      // 2. Cita (opcional): de esta barbería, COMPLETADA y sin ticket vivo.
      //    Se BLOQUEA la fila: dos cobros simultáneos de la misma cita se
      //    ponen en fila y el segundo ya ve el ticket del primero (y el
      //    anticipo, si lo hay, se aplica una sola vez).
      let frozen = new Map<string, Money>();
      let depositToApply: { amount: Money; label: string } | null = null;
      if (appointmentId) {
        if (!(await lockAppointmentTx(tx, barbershopId, appointmentId))) {
          throw new BarberCajaError(404, "APPOINTMENT_NOT_FOUND", "Cita no encontrada");
        }
        const appt = await tx.barberAppointment.findFirst({
          where: { id: appointmentId, barbershopId },
          include: { services: true, sales: { select: { notes: true } } },
        });
        if (!appt) throw new BarberCajaError(404, "APPOINTMENT_NOT_FOUND", "Cita no encontrada");
        if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
          throw new BarberCajaError(409, "APPOINTMENT_NOT_CHARGEABLE", "Esa cita está cancelada o no llegó");
        }
        // Una cita solo se cobra cuando está COMPLETADA. Es lo que hace la
        // pantalla (cobrar aparece al terminar, y «Completar y cobrar»
        // primero la completa); sin esta guardia la API dejaba un ticket
        // cobrado sobre una cita que seguía «Pendiente».
        if (appt.status !== "DONE") {
          throw new BarberCajaError(
            409,
            "APPOINTMENT_NOT_DONE",
            "Marca la visita como completada antes de cobrarla",
            { status: appt.status },
          );
        }
        if (appt.sales.some((s) => !isSaleCancelled(s))) {
          throw new BarberCajaError(409, "ALREADY_CHARGED", "Esa cita ya tiene un ticket cobrado");
        }
        frozen = new Map(appt.services.map((s) => [s.serviceId, D(s.priceAtBooking)]));
        if (!barberId && appt.barberId) barberId = appt.barberId;
        if (!clientId && appt.clientId) clientId = appt.clientId;
        // Anticipo PAGADO: sin ticket vivo (se acaba de comprobar) no está
        // aplicado en ningún lado, así que le toca a este cobro.
        const paid = paidDepositOf(appt);
        if (paid) depositToApply = { amount: paid, label: depositLabel(appt.startAt, tz) };
      }

      // 2b. Pedido de la tienda (opcional): de esta barbería, sin entregar,
      //     BLOQUEADO (dos entregas del mismo pedido se ponen en fila) y con
      //     sus piezas exactas en el ticket. Pagado en línea ⇔ STRIPE.
      let order: OrderForCharge | null = null;
      const frozenProducts = new Map<string, Money>();
      if (productOrderId) {
        if (!(await tiendaReady(tx)).orders) {
          throw new BarberCajaError(409, "ORDERS_SQL_PENDING", "Falta aplicar sql/barber_tienda.sql");
        }
        order = await lockOrderForChargeTx(tx, { orderId: productOrderId, barbershopId });
        if (!order) throw new BarberCajaError(404, "ORDER_NOT_FOUND", "Pedido no encontrado");
        if (!isOpenOrderStatus(order.status)) {
          throw new BarberCajaError(409, "ORDER_NOT_OPEN", "Ese pedido ya se entregó, se canceló o venció");
        }
        const paid = order.paidAt !== null;
        if (paid !== (paymentMethod === "STRIPE")) {
          throw new BarberCajaError(
            409,
            "ORDER_PAYMENT_MISMATCH",
            paid ? "Ese pedido ya se pagó en línea: entrégalo sin volver a cobrar" : "Ese pedido no se ha pagado en línea: cóbralo en efectivo, tarjeta o transferencia",
          );
        }
        const mismatch = checkOrderLines(order, lines, { exact: paid });
        if (mismatch) throw new BarberCajaError(400, "ORDER_LINES_MISMATCH", mismatch);
        for (const it of order.items) frozenProducts.set(it.productId, D(it.unitPrice));
        if (!clientId && order.clientId) clientId = order.clientId;
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
        // Lo apartado se entrega a su precio congelado aunque el producto ya
        // se haya retirado del catálogo después.
        const frozenPrice = frozenProducts.get(p.id);
        if (!p.isActive && !frozenPrice) throw new BarberCajaError(409, "PRODUCT_INACTIVE", `"${p.name}" está retirado del catálogo`);
        return { kind: "product", serviceId: null, productId: p.id, description: p.name, qty: l.qty, unitPrice: frozenPrice ?? D(p.price) };
      });

      // 5. Canjes: lealtad y membresía cubren UNA línea de servicio cada uno.
      let membershipUsed: { id: string } | null = null;
      // Bono de estrellas: se decide AQUÍ, dentro de la transacción. El navegador
      // solo dice cuál; si alcanza, qué da y cuántas estrellas cuesta lo dice
      // el catálogo de la barbería.
      let bonus: StarBonus | null = null;
      if (bonusId !== null || loyaltyIdx !== null) {
        if (!client) throw new BarberCajaError(400, "LOYALTY_NEEDS_CLIENT", "Elige al cliente para canjear su bono");
        const catalog = await loadBonusCatalog(tx, barbershopId);
        if (!catalog.rule.enabled) {
          throw new BarberCajaError(409, "LOYALTY_DISABLED", "La tarjeta de estrellas está apagada en esta barbería");
        }
        // Sin id (pestaña de Caja de antes del despliegue): SOLO el premio de
        // siempre. Sin bonos propios es el de las columnas de la barbería; con
        // bonos (ronda 2, M1), la fila que nació de él y solo si sigue ACTIVA y
        // es un servicio gratis — nunca «el más barato» de otro tipo.
        if (bonusId !== null) {
          bonus = activeBonuses(catalog.bonuses).find((b) => b.id === bonusId) ?? null;
          if (!bonus) throw new BarberCajaError(404, "BONUS_NOT_FOUND", "Ese bono no existe o está inactivo");
        } else {
          bonus = catalog.legacy
            ? legacyBonus(catalog.rule)
            : activeBonuses(catalog.bonuses).find((b) => b.id === seededBonusId(barbershopId) && b.kind === "service") ?? null;
          if (!bonus) throw new BarberCajaError(400, "BONUS_REQUIRED", "Elige qué bono se aplica (vuelve a abrir Caja)");
        }
        // Candado sobre el cliente + recuento DENTRO de la transacción: dos
        // canjes simultáneos se ponen en fila y el segundo ya ve las estrellas
        // que consumió el primero.
        await tx.$queryRaw`
          SELECT "id" FROM "barber_clients"
          WHERE "id" = ${client.id} AND "barbershopId" = ${barbershopId}
          FOR UPDATE
        `;
        const stamps = (await refreshLoyalty(tx, barbershopId, [client.id])).get(client.id)?.count ?? 0;
        if (stamps < bonus.cost) {
          throw new BarberCajaError(409, "LOYALTY_NOT_ELIGIBLE", `El cliente tiene ${stamps} de ${bonus.cost} estrellas para «${bonus.name}»`, { stamps, threshold: bonus.cost });
        }
        if (bonus.kind === "service") {
          // Servicio fijo: si no dijeron qué línea, la primera de ese servicio.
          if (loyaltyIdx === null && bonus.serviceId) {
            const found = built.findIndex((b, i) => b.kind === "service" && b.serviceId === bonus!.serviceId && b.qty === 1 && i !== membershipIdx);
            loyaltyIdx = found >= 0 ? found : null;
          }
          if (loyaltyIdx === null) {
            throw new BarberCajaError(400, "BONUS_NEEDS_SERVICE", bonus.serviceName ? `Agrega «${bonus.serviceName}» al ticket para usar el bono` : "Elige el servicio que va gratis");
          }
          if (loyaltyIdx === membershipIdx) {
            throw new BarberCajaError(400, "INVALID_INPUT", "Una misma línea no puede canjearse por lealtad y membresía");
          }
          const target = built[loyaltyIdx];
          if (!target || target.kind !== "service") {
            throw new BarberCajaError(400, "INVALID_INPUT", "El canje de lealtad debe apuntar a un servicio del ticket");
          }
          if (bonus.serviceId && target.serviceId !== bonus.serviceId) {
            throw new BarberCajaError(400, "BONUS_WRONG_SERVICE", `El bono «${bonus.name}» es para «${bonus.serviceName ?? "otro servicio"}»`);
          }
          if (target.qty !== 1) throw new BarberCajaError(400, "INVALID_INPUT", "El premio de lealtad aplica a una línea de cantidad 1");
          target.commissionUnitPrice = target.unitPrice;
          target.unitPrice = ZERO;
          // El sufijo guarda cuántas estrellas costó ESTE canje: es lo que se
          // resta al recontar (y lo que vuelve si el ticket se cancela).
          target.description = `${target.description}${loyaltyLineSuffix(bonus.cost)}`;
        } else if (loyaltyIdx !== null) {
          throw new BarberCajaError(400, "INVALID_INPUT", "Ese bono no es un servicio gratis");
        }
      }
      if (membershipIdx !== null) {
        const target = built[membershipIdx];
        if (!target || target.kind !== "service") {
          throw new BarberCajaError(400, "INVALID_INPUT", "La membresía debe aplicarse a un servicio del ticket");
        }
        if (!client) throw new BarberCajaError(400, "MEMBERSHIP_NEEDS_CLIENT", "Elige al cliente para usar su membresía");
        // Aquí solo interesa la membresía; la regla de lealtad no decide nada.
        const lookup = toClientLookup(client, now, { enabled: false, threshold: LOYALTY_DEFAULT_THRESHOLD, reward: "" });
        if (!lookup.activeMembership) {
          throw new BarberCajaError(409, "MEMBERSHIP_NOT_ACTIVE", "El cliente no tiene una membresía activa con cupo");
        }
        if (target.qty !== 1) throw new BarberCajaError(400, "INVALID_INPUT", "La membresía cubre una línea de cantidad 1");
        target.commissionUnitPrice = target.unitPrice;
        target.unitPrice = ZERO;
        target.description = `${target.description}${MEMBERSHIP_SUFFIX}`;
        membershipUsed = { id: lookup.activeMembership.id };
      }

      // 5b. Bono de descuento (pesos o %) o de regalo: una línea propia con la
      //     marca de canje (nombre del bono + estrellas que costó). Va ANTES
      //     del descuento normal y nunca deja el ticket en negativo.
      if (bonus && bonus.kind !== "service") {
        const before = money(sumMoney(built.map(lineTotal)));
        let off = ZERO;
        if (bonus.kind === "amount") off = Prisma.Decimal.min(D(bonus.amount ?? 0), before);
        else if (bonus.kind === "percent") off = money(before.times(bonus.percent ?? 0).dividedBy(100));
        if (bonus.kind !== "other" && !off.gt(0)) {
          throw new BarberCajaError(400, "BONUS_NOTHING_TO_DISCOUNT", "No hay nada que descontar con ese bono");
        }
        built.push({
          kind: "bonus",
          serviceId: null,
          productId: null,
          description: loyaltyBonusLineDescription(bonus.kind === "other" ? "gift" : "discount", bonus.name, bonus.cost),
          qty: 1,
          unitPrice: off.negated(),
        });
      }

      // 6. Descuento del ticket como línea de ajuste (negativa). En % se
      //    convierte a pesos AQUÍ, con el mismo redondeo único del módulo.
      const gross = sumMoney(built.map(lineTotal));
      const discount = discountPct !== null ? money(gross.times(discountPct).dividedBy(100)) : discountAmount;
      if (discount.gt(gross)) {
        throw new BarberCajaError(400, "DISCOUNT_TOO_BIG", "El descuento no puede superar el total de las líneas");
      }
      if (!discount.isZero()) {
        built.push({ kind: "adjustment", serviceId: null, productId: null, description: DISCOUNT_DESCRIPTION, qty: 1, unitPrice: discount.negated() });
      }

      // 6b. Anticipo de la cita: crédito por lo ya cobrado al apartarla. Va
      //     DESPUÉS del descuento y nunca deja el ticket en negativo: si el
      //     anticipo es mayor que lo que queda por cobrar, se aplica hasta
      //     ese tope (y con $0 por cobrar no se aplica: sigue «sin aplicar»
      //     para que la barbería lo devuelva o lo retenga desde Anticipos).
      if (depositToApply) {
        const due = money(sumMoney(built.map(lineTotal)));
        const credit = Prisma.Decimal.min(depositToApply.amount, due);
        if (credit.gt(0)) {
          built.push({
            kind: "deposit",
            serviceId: null,
            productId: null,
            description: depositLineDescription(depositToApply.label),
            qty: 1,
            unitPrice: credit.negated(),
          });
        }
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
          reason: order ? `Venta · pedido ${order.folio}` : "Venta",
          saleId: created.id,
          userId: ctx.barberUserId,
          requireActive: !frozenProducts.has(b.productId),
        });
      }

      // 10. Comisión: una entrada por venta con barbero, base SIN propina.
      if (barber) {
        const policy = await getCommissionPolicy(barbershopId);
        // El crédito del anticipo NO entra: el barbero hizo el servicio
        // completo y comisiona sobre él, se haya apartado con anticipo o no.
        const commissionLines: CommissionLine[] = built
          .filter((b) => b.kind !== "deposit" && (b.kind !== "bonus" || BONUS_DISCOUNT_REDUCES_COMMISSION))
          .map((b) => ({ ...b, kind: (b.kind === "bonus" ? "adjustment" : b.kind) as CommissionLine["kind"] }))
          // Corte cubierto por membresía o gratis por lealtad (decisión de
          // Rafael, 14-nov-2026): SÍ comisiona, sobre el precio normal del
          // servicio. Solo cambia la base de comisión; la línea del ticket y
          // el ingreso de la barbería siguen en $0.
          .map((b) => ({ kind: b.kind, qty: b.qty, unitPrice: b.commissionUnitPrice ?? b.unitPrice }));
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

      // 11. Canjes: cupo de la membresía.
      if (membershipUsed) {
        await tx.barberClientMembership.updateMany({
          where: { id: membershipUsed.id, barbershopId },
          data: { cutsUsed: { increment: 1 } },
        });
      }

      // 11b. Nota «Por cobrar»: queda cobrada por ESTE ticket, en la misma
      //      transacción. Dos cobros de la misma nota: el segundo espera la
      //      fila, ya no la ve abierta y se deshace entero (ticket incluido).
      if (draftId) {
        if (!(await saleDraftsReady(tx))) {
          throw new BarberCajaError(409, "DRAFTS_SQL_PENDING", "Falta aplicar sql/barber_por_cobrar.sql");
        }
        const marked = await markSaleDraftChargedTx(tx, {
          draftId,
          barbershopId,
          clientId: client?.id ?? null,
          saleId: created.id,
          userId: ctx.barberUserId,
          appointmentId,
        });
        if (!marked) throw new BarberCajaError(409, "DRAFT_NOT_OPEN", "Esa nota ya se cobró o se descartó");
      }

      // 11c. Pedido de la tienda: entregado por ESTE ticket, en la misma
      //      transacción (el candado de arriba ya lo tiene en fila).
      if (order) {
        const picked = await markOrderPickedUpTx(tx, { orderId: order.id, barbershopId, saleId: created.id });
        if (!picked) throw new BarberCajaError(409, "ORDER_NOT_OPEN", "Ese pedido ya se entregó, se canceló o venció");
      }

      // 12. Lealtad: se RECUENTAN los sellos del cliente con este ticket ya
      //     escrito (suma la visita de mostrador, resta lo canjeado) y se
      //     refresca la caché en esta misma transacción. La caja, la ficha y
      //     «mi cuenta» ven el dato nuevo en cuanto el cobro termina.
      if (client) await refreshLoyalty(tx, barbershopId, [client.id]);

      return tx.barberSale.findUniqueOrThrow({ where: { id: created.id }, include: saleInclude });
    },
    { maxWait: 5000, timeout: 15000 },
  );

  return toSaleRow(sale);
}

// ── Cancelación ─────────────────────────────────────────────────────────

/** Quién cancela (para la marca del ticket y el movimiento de stock). */
export interface CancelActor {
  barbershopId: string;
  userId: string;
  userName: string;
}

/**
 * Deshace lo que vendió un ticket de MEMBRESÍA. Solo si la membresía sigue
 * exactamente como la dejó ese ticket: sin cortes usados y sin otra
 * renovación encima. Si no, se niega con un mensaje que dice qué cancelar
 * primero — jamás se deja una membresía activa sin su dinero en el corte.
 */
async function revertMembershipTicketTx(
  tx: Tx,
  barbershopId: string,
  tag: Extract<BarberSaleTag, { k: "membership" }>,
): Promise<void> {
  // Candado de fila: nadie consume un corte ni renueva mientras se revierte.
  await tx.$queryRaw`
    SELECT "id" FROM "barber_client_memberships"
    WHERE "id" = ${tag.cm} AND "barbershopId" = ${barbershopId}
    FOR UPDATE
  `;
  const row = await tx.barberClientMembership.findFirst({
    where: { id: tag.cm, barbershopId },
    select: { id: true, endAt: true, cutsUsed: true, stripeSubscriptionId: true },
  });
  if (!row) return; // la membresía ya no existe: solo queda cancelar el dinero
  if (row.stripeSubscriptionId) {
    throw new BarberCajaError(
      409,
      "MEMBERSHIP_CHANGED",
      "Esta membresía ya se cobra sola con tarjeta; este ticket ya no se puede cancelar.",
    );
  }
  if (row.endAt.toISOString() !== tag.end) {
    throw new BarberCajaError(
      409,
      "MEMBERSHIP_CHANGED",
      "Esta membresía se renovó o cambió después de este ticket. Cancela primero el ticket más reciente de esa membresía.",
    );
  }
  if (row.cutsUsed > 0) {
    throw new BarberCajaError(
      409,
      "MEMBERSHIP_IN_USE",
      `Con esta membresía ya se ${row.cutsUsed === 1 ? "cubrió 1 corte" : `cubrieron ${row.cutsUsed} cortes`}. Cancela primero ${row.cutsUsed === 1 ? "ese ticket" : "esos tickets"}.`,
      { cutsUsed: row.cutsUsed },
    );
  }

  // Venta, o renovación anticipada que agregó un periodo propio (D1): se
  // cancela ESA fila; el periodo vigente queda como estaba.
  if (tag.op === "sell" || tag.op === "extend") {
    await tx.barberClientMembership.updateMany({
      where: { id: row.id, barbershopId },
      data: { status: "CANCELLED" },
    });
    return;
  }
  // Renovación: vuelve a como estaba antes de renovar.
  const prev = tag.prev!;
  await tx.barberClientMembership.updateMany({
    where: { id: row.id, barbershopId },
    data: {
      startAt: new Date(prev.start),
      endAt: new Date(prev.end),
      cutsUsed: prev.cuts,
      status: prev.status as Prisma.BarberClientMembershipUpdateManyMutationInput["status"],
      paymentMethod: prev.method as BarberPaymentMethod,
    },
  });
}

/**
 * Deshace el anticipo que cobró un ticket de ANTICIPO. Si ese anticipo ya
 * se descontó en el ticket de la cita, se niega: primero hay que cancelar
 * ese ticket (así el dinero nunca queda contado dos veces ni cero veces).
 */
async function revertDepositTicketTx(
  tx: Tx,
  barbershopId: string,
  tag: Extract<BarberSaleTag, { k: "deposit" }>,
): Promise<void> {
  if (!(await lockAppointmentTx(tx, barbershopId, tag.appt))) return; // la cita ya no existe
  const appt = await tx.barberAppointment.findFirst({
    where: { id: tag.appt, barbershopId },
    select: {
      id: true,
      depositStatus: true,
      sales: { select: { notes: true, items: { select: { description: true } } } },
    },
  });
  if (!appt) return;
  const applied = appt.sales.some(
    (x) => !isSaleCancelled(x) && x.items.some((it) => it.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX)),
  );
  if (applied) {
    throw new BarberCajaError(
      409,
      "DEPOSIT_APPLIED",
      "Ese anticipo ya se descontó al cobrar la cita. Cancela primero el ticket de la cita.",
    );
  }
  if (appt.depositStatus === "FORFEITED" || appt.depositStatus === "REFUNDED") {
    throw new BarberCajaError(
      409,
      "DEPOSIT_CLOSED",
      appt.depositStatus === "FORFEITED"
        ? "Ese anticipo ya se retuvo (el cliente no llegó): su ticket se queda como está."
        : "Ese anticipo ya se devolvió (la devolución tiene su propio ticket): este ticket se queda como está.",
    );
  }
  await tx.barberAppointment.updateMany({
    where: { id: appt.id, barbershopId },
    data: { depositAmount: null, depositStatus: null },
  });
}

/**
 * Deshace una DEVOLUCIÓN de anticipo (se canceló su ticket negativo, con el
 * turno aún abierto): el dinero vuelve a contar en el corte y el anticipo de
 * la cita vuelve a «pagado», como estaba antes de devolverlo.
 */
async function revertRefundTicketTx(
  tx: Tx,
  barbershopId: string,
  tag: Extract<BarberSaleTag, { k: "refund" }>,
): Promise<void> {
  if (!(await lockAppointmentTx(tx, barbershopId, tag.appt))) return; // la cita ya no existe
  await tx.barberAppointment.updateMany({
    where: { id: tag.appt, barbershopId, depositStatus: "REFUNDED" },
    data: { depositStatus: "PAID" },
  });
}

/**
 * Cancelación DENTRO de una transacción ajena (la usa cancelSale y la
 * devolución de un anticipo). No revisa permisos: eso es de quien llama.
 */
export async function cancelSaleTx(
  tx: Tx,
  actor: CancelActor,
  saleId: string,
  reason: string,
  now: Date,
): Promise<void> {
  const barbershopId = actor.barbershopId;
  // Candado del ticket: dos cancelaciones simultáneas no devuelven el stock
  // (ni revierten la membresía) dos veces — la segunda ya lo ve cancelado.
  await tx.$queryRaw`
    SELECT "id" FROM "barber_sales"
    WHERE "id" = ${saleId} AND "barbershopId" = ${barbershopId}
    FOR UPDATE
  `;
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

  // Ticket de mostrador: deshace la membresía o el anticipo que vendió.
  const tag = parseSaleTag(s.notes);
  if (tag?.k === "membership") await revertMembershipTicketTx(tx, barbershopId, tag);
  if (tag?.k === "deposit") await revertDepositTicketTx(tx, barbershopId, tag);
  if (tag?.k === "refund") await revertRefundTicketTx(tx, barbershopId, tag);

  // Ticket de una cita: se bloquea la cita para que el anticipo que este
  // ticket traía aplicado no lo tome otro cobro a medias. Al borrarse las
  // líneas, el anticipo vuelve solo a «sin aplicar».
  if (s.appointmentId) await lockAppointmentTx(tx, barbershopId, s.appointmentId);

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
      userId: actor.userId,
    });
  }

  // Canjes restituidos (un ticket de mostrador nunca trae canjes). Los
  // sellos de lealtad no se «devuelven» a mano: al borrarse las líneas el
  // canje deja de existir y el recuento de abajo los regresa solos.
  if (s.clientId && !tag) {
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

  const original = `${itemsSummaryOf(s.items)} · subtotal ${money(s.subtotal).toFixed(2)} · propina ${money(s.tip).toFixed(2)} · total ${money(s.total).toFixed(2)} (${s.paymentMethod})`;
  const marker = `${CANCELLED_MARK} ${now.toISOString()} · ${actor.userName} · ${reason} · Original: ${original}`;

  await tx.barberSale.update({
    where: { id: s.id },
    data: {
      subtotal: ZERO,
      tip: ZERO,
      total: ZERO,
      notes: s.notes ? `${marker}\n${s.notes}` : marker,
    },
  });

  // Nota «Por cobrar» (ronda 2, M1): si este ticket la saldó, vuelve a quedar
  // pendiente —para cobrarse otra vez o descartarse—, como todo lo demás que
  // el ticket se llevó. Misma transacción que la cancelación.
  await reopenSaleDraftOfCancelledSaleTx(tx, { saleId: s.id, barbershopId, userId: actor.userId });

  // Pedido de la tienda que este ticket entregó: vuelve a «Listo para
  // recoger» (o a «Pagado en línea»). Las piezas regresan arriba con RETURN.
  await reopenOrderOfCancelledSaleTx(tx, { saleId: s.id, barbershopId });

  // Lealtad: con el ticket ya cancelado se recuentan los sellos del cliente
  // (deja de contar la visita de mostrador y vuelve lo que se había canjeado).
  if (s.clientId) await refreshLoyalty(tx, barbershopId, [s.clientId]);
}

/**
 * Soft-cancel del ticket (ver cabecera). Requisitos: cash.manage, ticket de
 * ESTA barbería, aún no cancelado, su turno sigue ABIERTO y ninguna entrada
 * de comisión del ticket está pagada. Devuelve stock (RETURN), borra líneas
 * y comisión, restituye sellos/cupo y deja la marca con quién/cuándo/motivo.
 * Si es un ticket de mostrador, además revierte la membresía (venta →
 * cancelada; renovación → como estaba) o el anticipo (vuelve a «sin
 * anticipo»). Si es el ticket de una cita con anticipo aplicado, el anticipo
 * vuelve a «sin aplicar».
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
      await cancelSaleTx(
        tx,
        { barbershopId, userId: ctx.barberUserId, userName: `${ctx.user.firstName} ${ctx.user.lastName}`.trim() },
        saleId,
        reason,
        now,
      );
      return tx.barberSale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude });
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
  const negative = row.items.filter((it) => it.unitPrice < 0);
  // Ni el anticipo aplicado ni la devolución de un anticipo son un descuento.
  const discount = sumMoney(
    negative
      .filter((it) => !isDepositLine(it.description) && !isDepositRefundLine(it.description))
      .map((it) => D(it.unitPrice).times(it.qty)),
  ).abs();
  const depositApplied = sumMoney(negative.filter((it) => isDepositLine(it.description)).map((it) => D(it.unitPrice).times(it.qty))).abs();
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
    depositApplied: toNum(depositApplied),
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
