// ═══════════════════════════════════════════════════════════════════
// CAJA — lógica de derivación del corte de caja (WS1-T2).
//
// Regla: mientras la caja está OPEN, ingresos/descuentos/IVA/retiros NO se
// guardan; se DERIVAN en vivo de payments/invoices en la ventana del turno
// [openedAt, closedAt ?? now], SIEMPRE aislados por clinicId. Al CERRAR se
// congelan en los campos snapshot* de CashRegister (auditoría).
//
// Caja solo LEE de invoices/payments — nunca modifica la facturación por
// paciente. Payment no tiene clinicId: se filtra por invoice.clinicId.
// ═══════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** IVA embebido asumido. Invoice no tiene campo de impuesto (ver schema);
 *  el IVA se estima como monto incluido al 16%. */
export const IVA_RATE = 0.16;

// Métodos de pago (PaymentMethod en payment-modal.tsx):
// "cash" | "debit" | "credit" | "transfer" | "check" | "other".
/** Efectivo. */
export const CASH_METHOD   = "cash";
/** Tarjeta de débito. */
export const DEBIT_METHOD  = "debit";
/** Tarjeta de crédito. */
export const CREDIT_METHOD = "credit";

/** Offset fijo de México (America/Mexico_City = UTC-6, sin horario de verano
 *  desde 2023), igual que analytics/query.ts. Ancla "hoy" al día natural de la
 *  clínica y no al de UTC. */
const MX_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Inicio del día natural de México para `now`, expresado como instante UTC. */
function startOfTodayMx(now: Date): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  const midnight = Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth(), mx.getUTCDate());
  return new Date(midnight + MX_OFFSET_MS);
}

export interface CajaListRow {
  paymentId:   string;
  at:          string; // ISO — paidAt del pago
  patientName: string;
  concept:     string; // descripciones de invoice.items unidas
  amount:      number;
  method:      string;
  discount:    number; // invoice.discount de la factura de este pago
  doctorName:  string; // vía invoice.appointment.doctor, o "—"
}

export interface CajaTotals {
  openingBalance:   number;
  cashIncome:       number; // ingresos en efectivo ("cash")
  cardDebitIncome:  number; // ingresos con tarjeta de débito ("debit")
  cardCreditIncome: number; // ingresos con tarjeta de crédito ("credit")
  otherIncome:      number; // transfer / check / other (NO tarjeta)
  totalIncome:      number; // cash + débito + crédito + other
  discounts:        number; // SUM invoice.discount de facturas creadas en la ventana
  tax:              number; // IVA estimado (incluido) sobre el ingreso del turno
  withdrawals:      number; // SUM retiros de la caja
  expectedCash:     number; // opening + cashIncome − withdrawals
}

export interface CajaWithdrawalRow {
  id:             string;
  amount:         number;
  reason:         string;
  recordedAt:     string;
  recordedByName: string;
}

export interface CajaRegisterInfo {
  id:             string;
  openedAt:       string;
  openingBalance: number;
  operatorName:   string;
}

export interface CajaState {
  register:    CajaRegisterInfo | null;
  totals:      CajaTotals | null;
  withdrawals: CajaWithdrawalRow[];
  list:        CajaListRow[];
  // Resumen del día natural de México — presente SIEMPRE (con o sin caja abierta):
  suggestedOpening: number; // efectivo cobrado hoy aún NO cuadrado en un corte cerrado
  billedToday:      number; // total facturado hoy (excluye DRAFT/CANCELLED)
  pendingToday:     number; // saldo por cobrar de las facturas de hoy
  overdueToday:     number; // saldo de facturas vencidas (dueDate < hoy) con saldo
}

function fullName(u?: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!u) return "—";
  const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return n || "—";
}

function conceptOf(items: unknown): string {
  if (!Array.isArray(items)) return "—";
  const parts = items
    .map((it: any) => (it && typeof it.description === "string" ? it.description.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

/** Caja OPEN de la clínica (o null). Incluye operador y retiros. */
export async function getOpenRegister(clinicId: string) {
  return prisma.cashRegister.findFirst({
    where:   { clinicId, status: "OPEN" },
    include: {
      operator:    { select: { firstName: true, lastName: true } },
      withdrawals: { orderBy: { recordedAt: "desc" }, include: { recordedByUser: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { openedAt: "desc" },
  });
}

/**
 * Deriva ingresos + lista del turno en la ventana [from, to] para la clínica.
 * Pagos por invoice.clinicId (Payment no tiene clinicId propio).
 *
 * `otherIncome` = TODO lo no-efectivo (tarjeta + transfer + check + other): así
 * la ruta /api/caja/close lo snapshotea con el mismo significado de siempre. El
 * desglose sin-tarjeta (transfer/check/other) lo calcula getCajaState restando
 * cardDebitIncome + cardCreditIncome para CajaTotals.otherIncome.
 */
export async function deriveWindow(clinicId: string, from: Date, to: Date) {
  const [payments, discountAgg] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: from, lte: to }, invoice: { clinicId } },
      include: {
        invoice: {
          select: {
            items:       true,
            discount:    true,
            patient:     { select: { firstName: true, lastName: true } },
            appointment: { select: { doctor: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
      orderBy: { paidAt: "asc" },
    }),
    prisma.invoice.aggregate({
      _sum:  { discount: true },
      where: { clinicId, createdAt: { gte: from, lte: to } },
    }),
  ]);

  let cashIncome = 0;
  let cardDebitIncome = 0;
  let cardCreditIncome = 0;
  let otherIncome = 0; // todo lo no-efectivo (incluye tarjeta)
  const list: CajaListRow[] = payments.map((p) => {
    const amount = p.amount ?? 0;
    if (p.method === CASH_METHOD) {
      cashIncome += amount;
    } else {
      otherIncome += amount;
      if (p.method === DEBIT_METHOD) cardDebitIncome += amount;
      else if (p.method === CREDIT_METHOD) cardCreditIncome += amount;
    }
    return {
      paymentId:   p.id,
      at:          p.paidAt.toISOString(),
      patientName: fullName(p.invoice?.patient),
      concept:     conceptOf(p.invoice?.items),
      amount,
      method:      p.method,
      discount:    p.invoice?.discount ?? 0,
      doctorName:  fullName(p.invoice?.appointment?.doctor),
    };
  });

  const totalIncome = cashIncome + otherIncome;
  const discounts = discountAgg._sum.discount ?? 0;
  // IVA estimado (incluido) sobre el ingreso del turno: total − total/1.16.
  const tax = totalIncome > 0 ? totalIncome - totalIncome / (1 + IVA_RATE) : 0;

  return { cashIncome, cardDebitIncome, cardCreditIncome, otherIncome, totalIncome, discounts, tax, list };
}

/** Redondea a 2 decimales para evitar ruido de punto flotante en dinero. */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * `suggestedOpening` — efectivo (method "cash") cobrado HOY [00:00 MX → ahora]
 * que AÚN NO fue cuadrado en un corte cerrado. Sirve para prefijar el monto de
 * apertura de la próxima caja: es el efectivo físico en el cajón que ningún
 * corte previo ya contabilizó.
 *
 * Fórmula: Σ Payment.amount (method "cash", paidAt ∈ [inicioHoyMX, ahora],
 * invoice.clinicId = clinicId) EXCLUYENDO los pagos cuyo paidAt cae dentro de la
 * ventana [openedAt, closedAt] de alguna caja CERRADA hoy.
 */
async function computeSuggestedOpening(clinicId: string, todayStart: Date, now: Date): Promise<number> {
  const [cashPayments, closedToday] = await Promise.all([
    prisma.payment.findMany({
      where:  { method: CASH_METHOD, paidAt: { gte: todayStart, lte: now }, invoice: { clinicId } },
      select: { amount: true, paidAt: true },
    }),
    prisma.cashRegister.findMany({
      where:  { clinicId, status: "CLOSED", closedAt: { gte: todayStart } },
      select: { openedAt: true, closedAt: true },
    }),
  ]);

  const isCounted = (at: Date) =>
    closedToday.some((r) => r.closedAt != null && at >= r.openedAt && at <= r.closedAt);

  return cashPayments.reduce((sum, p) => (isCounted(p.paidAt) ? sum : sum + (p.amount ?? 0)), 0);
}

/**
 * Resumen de facturación del día natural (México), independiente del turno:
 *  - billedToday:  Σ total de facturas EMITIDAS hoy (excluye DRAFT/CANCELLED).
 *  - pendingToday: Σ saldo por cobrar de esas mismas facturas de hoy.
 *  - overdueToday: Σ saldo de facturas VENCIDAS (dueDate < hoy) con saldo > 0.
 */
async function computeDayBilling(clinicId: string, todayStart: Date, now: Date) {
  const issuedToday: Prisma.InvoiceWhereInput = {
    clinicId,
    status:    { notIn: ["DRAFT", "CANCELLED"] },
    createdAt: { gte: todayStart, lte: now },
  };
  const overdue: Prisma.InvoiceWhereInput = {
    clinicId,
    status:  { notIn: ["DRAFT", "CANCELLED"] },
    balance: { gt: 0 },
    dueDate: { lt: todayStart },
  };

  const [billedAgg, pendingAgg, overdueAgg] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { total: true },   where: issuedToday }),
    prisma.invoice.aggregate({ _sum: { balance: true }, where: issuedToday }),
    prisma.invoice.aggregate({ _sum: { balance: true }, where: overdue }),
  ]);

  return {
    billedToday:  billedAgg._sum.total    ?? 0,
    pendingToday: pendingAgg._sum.balance ?? 0,
    overdueToday: overdueAgg._sum.balance ?? 0,
  };
}

/**
 * Estado completo de la caja para la UI y GET /api/caja/current.
 * Si no hay caja abierta → register/totals null (list vacía), pero el resumen
 * del día (suggestedOpening + facturación) SIEMPRE se calcula y devuelve.
 */
export async function getCajaState(clinicId: string): Promise<CajaState> {
  const now = new Date();
  const todayStart = startOfTodayMx(now);

  const [reg, suggestedOpening, dayBilling] = await Promise.all([
    getOpenRegister(clinicId),
    computeSuggestedOpening(clinicId, todayStart, now),
    computeDayBilling(clinicId, todayStart, now),
  ]);

  const day = {
    suggestedOpening: money(suggestedOpening),
    billedToday:      money(dayBilling.billedToday),
    pendingToday:     money(dayBilling.pendingToday),
    overdueToday:     money(dayBilling.overdueToday),
  };

  if (!reg) return { register: null, totals: null, withdrawals: [], list: [], ...day };

  const from = reg.openedAt;
  const derived = await deriveWindow(clinicId, from, now);

  const withdrawalsTotal = reg.withdrawals.reduce((s, w) => s + (w.amount ?? 0), 0);
  const expectedCash = reg.openingBalance + derived.cashIncome - withdrawalsTotal;

  const totals: CajaTotals = {
    openingBalance:   money(reg.openingBalance),
    cashIncome:       money(derived.cashIncome),
    cardDebitIncome:  money(derived.cardDebitIncome),
    cardCreditIncome: money(derived.cardCreditIncome),
    // otherIncome de deriveWindow incluye tarjeta; aquí se resta para dejar
    // solo transfer/check/other.
    otherIncome:      money(derived.otherIncome - derived.cardDebitIncome - derived.cardCreditIncome),
    totalIncome:      money(derived.totalIncome),
    discounts:        money(derived.discounts),
    tax:              money(derived.tax),
    withdrawals:      money(withdrawalsTotal),
    expectedCash:     money(expectedCash),
  };

  return {
    register: {
      id:             reg.id,
      openedAt:       reg.openedAt.toISOString(),
      openingBalance: money(reg.openingBalance),
      operatorName:   fullName(reg.operator),
    },
    totals,
    withdrawals: reg.withdrawals.map((w) => ({
      id:             w.id,
      amount:         money(w.amount ?? 0),
      reason:         w.reason,
      recordedAt:     w.recordedAt.toISOString(),
      recordedByName: fullName(w.recordedByUser),
    })),
    list: derived.list,
    ...day,
  };
}

/** Historial de cortes CERRADOS (para la pestaña de historial). */
export async function getCajaHistory(clinicId: string, limit = 30) {
  const rows = await prisma.cashRegister.findMany({
    where:   { clinicId, status: "CLOSED" },
    include: { operator: { select: { firstName: true, lastName: true } } },
    orderBy: { closedAt: "desc" },
    take:    Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((r) => ({
    id:                    r.id,
    openedAt:              r.openedAt.toISOString(),
    closedAt:              r.closedAt ? r.closedAt.toISOString() : null,
    operatorName:          fullName(r.operator),
    openingBalance:        money(r.openingBalance),
    countedClosingBalance: r.countedClosingBalance == null ? null : money(r.countedClosingBalance),
    closingNotes:          r.closingNotes ?? null,
    cashIncome:            r.snapshotCashIncome == null ? null : money(r.snapshotCashIncome),
    otherIncome:           r.snapshotOtherIncome == null ? null : money(r.snapshotOtherIncome),
    discounts:             r.snapshotDiscounts == null ? null : money(r.snapshotDiscounts),
    tax:                   r.snapshotTax == null ? null : money(r.snapshotTax),
    withdrawals:           r.snapshotWithdrawals == null ? null : money(r.snapshotWithdrawals),
    expectedCash:          r.snapshotExpectedCash == null ? null : money(r.snapshotExpectedCash),
    variance:              r.snapshotVariance == null ? null : money(r.snapshotVariance),
  }));
}

export type CajaHistoryRow = Awaited<ReturnType<typeof getCajaHistory>>[number];
