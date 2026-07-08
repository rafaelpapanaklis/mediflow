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
import { prisma } from "@/lib/prisma";

/** IVA embebido asumido. Invoice no tiene campo de impuesto (ver schema);
 *  el IVA se estima como monto incluido al 16%. */
export const IVA_RATE = 0.16;

/** Efectivo = método "cash" de PaymentMethod (payment-modal.tsx). */
export const CASH_METHOD = "cash";

export interface CajaListRow {
  paymentId:   string;
  at:          string; // ISO — paidAt del pago
  patientName: string;
  concept:     string; // descripciones de invoice.items unidas
  amount:      number;
  method:      string;
  doctorName:  string; // vía invoice.appointment.doctor, o "—"
}

export interface CajaTotals {
  openingBalance: number;
  cashIncome:     number; // ingresos en efectivo
  otherIncome:    number; // tarjeta / transferencia / otros
  totalIncome:    number; // cash + other
  discounts:      number; // SUM invoice.discount de facturas creadas en la ventana
  tax:            number; // IVA estimado (incluido) sobre el ingreso del turno
  withdrawals:    number; // SUM retiros de la caja
  expectedCash:   number; // opening + cashIncome − withdrawals
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
 */
export async function deriveWindow(clinicId: string, from: Date, to: Date) {
  const [payments, discountAgg] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: from, lte: to }, invoice: { clinicId } },
      include: {
        invoice: {
          select: {
            items:       true,
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
  let otherIncome = 0;
  const list: CajaListRow[] = payments.map((p) => {
    const amount = p.amount ?? 0;
    if (p.method === CASH_METHOD) cashIncome += amount;
    else otherIncome += amount;
    return {
      paymentId:   p.id,
      at:          p.paidAt.toISOString(),
      patientName: fullName(p.invoice?.patient),
      concept:     conceptOf(p.invoice?.items),
      amount,
      method:      p.method,
      doctorName:  fullName(p.invoice?.appointment?.doctor),
    };
  });

  const totalIncome = cashIncome + otherIncome;
  const discounts = discountAgg._sum.discount ?? 0;
  // IVA estimado (incluido) sobre el ingreso del turno: total − total/1.16.
  const tax = totalIncome > 0 ? totalIncome - totalIncome / (1 + IVA_RATE) : 0;

  return { cashIncome, otherIncome, totalIncome, discounts, tax, list };
}

/** Redondea a 2 decimales para evitar ruido de punto flotante en dinero. */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Estado completo de la caja para la UI y GET /api/caja/current.
 * Si no hay caja abierta → register/totals null (list vacía).
 */
export async function getCajaState(clinicId: string): Promise<CajaState> {
  const reg = await getOpenRegister(clinicId);
  if (!reg) return { register: null, totals: null, withdrawals: [], list: [] };

  const from = reg.openedAt;
  const to = new Date();
  const derived = await deriveWindow(clinicId, from, to);

  const withdrawalsTotal = reg.withdrawals.reduce((s, w) => s + (w.amount ?? 0), 0);
  const expectedCash = reg.openingBalance + derived.cashIncome - withdrawalsTotal;

  const totals: CajaTotals = {
    openingBalance: money(reg.openingBalance),
    cashIncome:     money(derived.cashIncome),
    otherIncome:    money(derived.otherIncome),
    totalIncome:    money(derived.totalIncome),
    discounts:      money(derived.discounts),
    tax:            money(derived.tax),
    withdrawals:    money(withdrawalsTotal),
    expectedCash:   money(expectedCash),
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
