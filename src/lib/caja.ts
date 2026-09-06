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
//
// El IVA del corte NO se asume: se suma pago por pago con `invoiceTaxPortion`
// a partir del desglose REAL de cada factura (taxRate/taxIncluded) resuelto con
// la preferencia fiscal de la clínica — el mismo criterio con el que se timbra.
// Una clínica exenta (Clinic.cfdiTaxMode = "exempt", el default de la
// odontología) reporta 0, no un IVA fantasma del 16%.
// ═══════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invoiceTaxPortion } from "@/lib/invoice-totals";

// Métodos de pago (PaymentMethod en payment-modal.tsx):
// "cash" | "debit" | "credit" | "transfer" | "check" | "other".
/** Efectivo. */
export const CASH_METHOD   = "cash";
/** Tarjeta de débito. */
export const DEBIT_METHOD  = "debit";
/** Tarjeta de crédito. */
export const CREDIT_METHOD = "credit";
/** Reembolso. Se guarda con monto POSITIVO: es un movimiento, no un ingreso. */
export const REFUND_METHOD = "refund";

/**
 * `where` de Payment para sumar INGRESOS reales. Es el MISMO criterio que ya
 * usan /api/dashboard/home/revenue, /api/dashboard/home/admin y
 * lib/agenda/server (la referencia): fuera los reembolsos —/refund los guarda
 * como Payment con method "refund" y monto POSITIVO, así que sin este filtro
 * se SUMAN como cobro— y fuera los pagos de facturas CANCELADAS. Payment no
 * tiene clinicId: el tenant se aísla SIEMPRE vía invoice.clinicId, y `clinicId`
 * es string obligatorio para que un undefined no borre el filtro.
 */
export function revenuePaymentWhere(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
): Prisma.PaymentWhereInput {
  return {
    paidAt,
    method:  { not: REFUND_METHOD },
    invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
  };
}

/**
 * `where` de Payment para sumar los REEMBOLSOS de una ventana — el espejo
 * exacto de revenuePaymentWhere: mismo tenant, misma exclusión de facturas
 * CANCELADAS, y `method` invertido. Es lo que permite que un reporte reste lo
 * devuelto SIN doble conteo: si algún día /refund pasa a CANCELAR la factura
 * reembolsada, sus pagos —el cobro original Y el reembolso— salen de las DOS
 * consultas a la vez.
 *
 * ⚠️ Eso se conserva DENTRO de una misma ventana. Entre periodos no: hoy
 * /api/invoices/[id]/cancel exige reembolsar primero, así que una factura
 * cobrada en enero, reembolsada y cancelada en febrero desaparece de enero al
 * volver a consultarlo (comportamiento de revenuePaymentWhere que ya existía,
 * no lo introduce este filtro) y su salida no aparece en febrero. Cerrarlo
 * pide decidir si un mes ya cerrado se re-expresa; ver el reporte de WS1-T6.
 */
export function refundPaymentWhere(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
): Prisma.PaymentWhereInput {
  return {
    paidAt,
    method:  REFUND_METHOD,
    invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
  };
}

/**
 * `where` del EFECTIVO cobrado en una ventana — el que decide qué billetes se
 * supone que hay en el cajón. Es revenuePaymentWhere con el método fijado a
 * "cash" (mismo patrón que /api/finanzas), así que hereda sus dos filtros: sin
 * reembolsos (que ya no son un cobro) y sin facturas CANCELADAS. Existe para
 * que ningún consumidor vuelva a escribir el filtro a mano y se deje una línea.
 */
export function cashOnHandPaymentWhere(clinicId: string, from: Date, to: Date): Prisma.PaymentWhereInput {
  return { ...revenuePaymentWhere(clinicId, { gte: from, lte: to }), method: CASH_METHOD };
}

/** Facturas con saldo POR COBRAR: emitidas (ni DRAFT ni CANCELLED) y balance > 0. */
export function receivableInvoiceWhere(clinicId: string): Prisma.InvoiceWhereInput {
  return {
    clinicId,
    status:  { notIn: ["DRAFT", "CANCELLED"] },
    balance: { gt: 0 },
  };
}

/**
 * Facturas VENCIDAS: por cobrar Y con `dueDate` anterior al inicio de HOY en la
 * zona de la clínica. Se deriva SIEMPRE de la fecha de vencimiento, nunca del
 * status OVERDUE (ningún flujo lo escribe). Las facturas sin dueDate no
 * vencen jamás: no se les inventa una fecha.
 */
export function overdueInvoiceWhere(clinicId: string, todayStart: Date): Prisma.InvoiceWhereInput {
  return {
    ...receivableInvoiceWhere(clinicId),
    dueDate: { lt: todayStart },
  };
}

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
  discount:    number; // parte del descuento de la factura que le toca a ESTE movimiento (negativa si es reembolso)
  doctorName:  string; // vía invoice.appointment.doctor → Invoice.doctorId → "—"
}

export interface CajaTotals {
  openingBalance:   number;
  cashIncome:       number; // ingresos en efectivo ("cash")
  cardDebitIncome:  number; // ingresos con tarjeta de débito ("debit")
  cardCreditIncome: number; // ingresos con tarjeta de crédito ("credit")
  otherIncome:      number; // transfer / check / other (NO tarjeta)
  totalIncome:      number; // cash + débito + crédito + other (SIN reembolsos)
  refunds:          number; // Σ reembolsos del turno (method "refund"); se muestran en NEGATIVO, nunca suman
  discounts:        number; // descuento PRORRATEADO de lo cobrado en la ventana (misma población que los ingresos)
  tax:              number; // IVA realmente contenido en lo cobrado del turno (0 si exenta)
  withdrawals:      number; // SUM retiros de la caja
  expectedCash:     number; // opening + cashIncome − withdrawals − reembolsos en efectivo (expectedCashOf)
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
 *
 * Los REEMBOLSOS (method "refund", monto positivo) se traen a propósito: la
 * clínica debe verlos en la lista del turno. Lo que NO hacen es sumar: van a
 * `refunds` (línea propia, en negativo) y no a cashIncome/otherIncome/
 * totalIncome. Mismo criterio que revenuePaymentWhere, que además deja fuera
 * los pagos de facturas CANCELADAS (anuladas: no son ventas del turno).
 *
 * Los DESCUENTOS se prorratean pago a pago (invoiceDiscountPortion), igual que
 * el IVA: son el descuento de lo que se COBRÓ en la ventana, no el de las
 * facturas que se CREARON en ella. Mezclar las dos poblaciones hacía que una
 * factura emitida hoy con $20,000 de descuento y sin cobrar imprimiera
 * "Ingresos $2,000 · Descuentos $20,000" en el corte.
 */
export async function deriveWindow(clinicId: string, from: Date, to: Date) {
  const [payments, courtesyAgg, clinic] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: from, lte: to }, invoice: { clinicId, status: { notIn: ["CANCELLED"] } } },
      include: {
        invoice: {
          select: {
            items:       true,
            discount:    true,
            // El total es el DENOMINADOR del prorrateo del descuento (ya viene
            // con el descuento restado: ver computeInvoiceTotal).
            total:       true,
            // Desglose fiscal REAL de la factura: es lo que decide cuánto IVA
            // trae cada pago (ver invoiceTaxPortion). Sin esto el corte tendría
            // que asumir una tasa, que es justo lo que ya no hace.
            taxRate:     true,
            taxIncluded: true,
            // Doctor atribuido a mano en el editor de facturas. Es un String
            // suelto (sin relación Prisma), así que se resuelve abajo con una
            // segunda query en vez de un include.
            doctorId:    true,
            patient:     { select: { firstName: true, lastName: true } },
            appointment: { select: { doctor: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
      orderBy: { paidAt: "asc" },
    }),
    // CORTESÍAS: facturas emitidas en la ventana cuyo total quedó en 0 porque el
    // descuento se comió el precio entero (tratamiento regalado, garantía). No
    // generan ningún Payment —no hay nada que cobrar—, así que el prorrateo de
    // abajo jamás las vería y el descuento del 100 % desaparecería de TODOS los
    // cortes. Es justo la cifra con la que el dueño detecta tratamientos
    // regalados, así que se cuenta en el turno en que se emitió: es el único
    // momento en que existe. El resto de los descuentos viaja con el cobro.
    prisma.invoice.aggregate({
      _sum:  { discount: true },
      where: {
        clinicId,
        status:    { notIn: ["DRAFT", "CANCELLED"] },
        createdAt: { gte: from, lte: to },
        total:     { lte: 0 },
        discount:  { gt: 0 },
      },
    }),
    // Preferencia fiscal de la clínica — desempata las facturas que no traen una
    // señal propia (ver resolveTaxMode). SOLO esa columna: serializar la fila
    // Clinic completa filtra columnas secretas.
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { cfdiTaxMode: true } }),
  ]);
  const clinicTaxMode = clinic?.cfdiTaxMode ?? null;

  // Nombres de los doctores atribuidos a mano (facturas creadas desde Caja, que
  // no nacen de una cita y por tanto no tienen invoice.appointment.doctor).
  // Acotado a la clínica: el doctorId de la factura nunca se muestra a ciegas.
  const attributedIds = Array.from(new Set(
    payments.map((p) => (p.invoice as any)?.doctorId).filter(Boolean) as string[],
  ));
  const attributedById = new Map<string, { firstName: string | null; lastName: string | null }>();
  if (attributedIds.length > 0) {
    const docs = await prisma.user.findMany({
      where:  { id: { in: attributedIds }, clinicId },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const d of docs) attributedById.set(d.id, { firstName: d.firstName, lastName: d.lastName });
  }

  let cashIncome = 0;
  let cardDebitIncome = 0;
  let cardCreditIncome = 0;
  let otherIncome = 0; // todo lo no-efectivo (incluye tarjeta)
  let refunds = 0;     // reembolsos del turno: se muestran, NO suman
  let tax = 0;         // IVA contenido en lo cobrado, sumado pago por pago
  let discounts = 0;   // descuento prorrateado de lo cobrado, sumado pago por pago (los reembolsos lo revierten)
  const list: CajaListRow[] = payments.map((p) => {
    const amount = p.amount ?? 0;
    // Pago por pago y no sobre el total del turno: así un día MIXTO (facturas
    // exentas y gravadas) solo suma la parte gravada, y un abono parcial aporta
    // su proporción de IVA.
    //
    // Los reembolsos NO aportan IVA cobrado ni INGRESO: /refund guarda el
    // Payment con method "refund" y monto POSITIVO (es un movimiento, no un
    // ingreso). Antes caían en el `else` de abajo y engordaban otherIncome y
    // totalIncome: cobrar $1,000 y devolver $500 reportaba $1,500 de ingresos
    // (y el IVA de $1,500). Mismo criterio que /api/dashboard/home/revenue.
    //
    // Descuento de ESTE movimiento: positivo si entra dinero, negativo si sale.
    // La fila lo lleva igual que el total, para que la tabla impresa y el CSV
    // sumen exactamente la línea "Descuentos" del corte y no tres cifras
    // distintas para el mismo cobro.
    const discountPortion = paymentDiscountPortion(p.method, amount, p.invoice);
    discounts += discountPortion;
    if (p.method === REFUND_METHOD) {
      refunds += amount;
    } else {
      tax += invoiceTaxPortion(amount, p.invoice, clinicTaxMode);
      if (p.method === CASH_METHOD) {
        cashIncome += amount;
      } else {
        otherIncome += amount;
        if (p.method === DEBIT_METHOD) cardDebitIncome += amount;
        else if (p.method === CREDIT_METHOD) cardCreditIncome += amount;
      }
    }
    return {
      paymentId:   p.id,
      at:          p.paidAt.toISOString(),
      patientName: fullName(p.invoice?.patient),
      concept:     conceptOf(p.invoice?.items),
      amount,
      method:      p.method,
      discount:    money(discountPortion),
      // La cita manda (es el dato clínico); si la factura se creó suelta desde
      // Caja, se cae al doctor que el usuario eligió en el editor.
      doctorName:  fullName(p.invoice?.appointment?.doctor ?? attributedById.get((p.invoice as any)?.doctorId ?? "")),
    };
  });

  const totalIncome = cashIncome + otherIncome;

  // Reembolsos que SABEMOS que salieron en EFECTIVO del cajón. Hoy siempre 0:
  // el reembolso no guarda con qué método salió el dinero (ver expectedCashOf y
  // sql/payment-refund-method.sql). Es el ÚNICO punto a cambiar cuando exista
  // la columna; ni la pantalla ni el cierre repiten la fórmula.
  const cashRefunds = 0;

  // Descuentos del turno = los prorrateados de lo cobrado + los de las cortesías
  // emitidas en la ventana (que no pueden cobrarse nunca, ver arriba).
  const discountsTotal = discounts + (courtesyAgg._sum.discount ?? 0);

  return { cashIncome, cardDebitIncome, cardCreditIncome, otherIncome, totalIncome, refunds: money(refunds), cashRefunds, discounts: money(discountsTotal), tax: money(tax), list };
}

/** Redondea a 2 decimales para evitar ruido de punto flotante en dinero. */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Descuento que un pago del turno APORTA (cobro) o REVIERTE (reembolso).
 *
 * Firmado a propósito: sin el signo, cobrar $2,000 → reembolsar $2,000 (método
 * equivocado) → volver a cobrar $2,000 reportaba el descuento DOS veces, porque
 * el clamp de invoiceDiscountPortion acota cada pago por separado y nunca la
 * suma, y /refund devuelve el `balance` a la factura (se puede volver a cobrar).
 * Con el signo, el descuento sigue al dinero NETO: si el dinero vuelve, el
 * descuento vuelve con él.
 */
export function paymentDiscountPortion(
  method: string,
  amount: number,
  inv: { discount?: number | null; total?: number | null } | null | undefined,
): number {
  const portion = invoiceDiscountPortion(amount, inv);
  return method === REFUND_METHOD ? -portion : portion;
}

/**
 * Parte del DESCUENTO de una factura que le toca a un importe COBRADO de ella.
 *
 * Gemelo exacto de `invoiceTaxPortion`: lo que se tiene es un `Payment.amount`
 * —una fracción del total de la factura— y hay que decir cuánto de eso es
 * descuento. Es proporcional, así que un abono parcial aporta su parte y la
 * suma de todos los abonos de la factura devuelve el descuento completo.
 *
 * Existe porque el corte MEZCLABA dos poblaciones: sumaba el descuento de las
 * facturas CREADAS en la ventana junto a los ingresos COBRADOS en la ventana.
 * Una factura emitida hoy con $20,000 de descuento y sin cobrar imprimía
 * "Ingresos $2,000 · Descuentos $20,000" en un arqueo que solo habla de dinero
 * que entró. Con el prorrateo, el descuento viaja con el cobro.
 *
 * `total` es el importe REALMENTE pagable (ya lleva el descuento restado: ver
 * computeInvoiceTotal), por eso es el denominador correcto. Sin total (0 o
 * ausente) no hay proporción que calcular → 0.
 */
export function invoiceDiscountPortion(
  amount: number,
  inv: { discount?: number | null; total?: number | null } | null | undefined,
): number {
  const amt = Number(amount);
  if (!isFinite(amt) || amt === 0 || !inv) return 0;
  const discount = Number(inv.discount);
  const total = Number(inv.total);
  if (!isFinite(discount) || discount <= 0) return 0;
  if (!isFinite(total) || total <= 0) return 0;
  // Clamp: un sobrepago (amount > total) no puede repartir MÁS descuento del
  // que la factura tiene.
  return money(Math.min(discount, (discount * amt) / total));
}

/**
 * Efectivo que DEBERÍA haber en el cajón: apertura + cobros en efectivo −
 * retiros − reembolsos pagados en efectivo. Fórmula ÚNICA: la pantalla
 * (getCajaState) y el cierre (/api/caja/close) la comparten para que el papel
 * del arqueo no pueda contradecir a la fila guardada.
 *
 * ⚠️ `cashRefunds` es HOY siempre 0 y no por descuido: /api/invoices/[id]/refund
 * guarda el reembolso como un Payment con method "refund" y NO registra con qué
 * método salió el dinero, así que un reembolso en efectivo es indistinguible de
 * uno a tarjeta. Restar TODOS los reembolsos cambiaría el faltante fantasma por
 * un sobrante fantasma. El dato falta en la base: ver sql/payment-refund-method.sql.
 * Cuando exista, se alimenta este parámetro y NO hay que tocar dos fórmulas.
 */
export function expectedCashOf(args: {
  openingBalance: number;
  cashIncome:     number;
  withdrawals:    number;
  cashRefunds?:   number;
}): number {
  return money(
    (args.openingBalance ?? 0) + (args.cashIncome ?? 0) - (args.withdrawals ?? 0) - (args.cashRefunds ?? 0),
  );
}

/** Fila mínima de dinero fechado (Payment) para los reportes de periodo. */
export interface DatedAmount {
  amount: number | null;
  paidAt: Date;
}

/**
 * INGRESO NETO de un periodo y su serie por bucket: cobros − reembolsos.
 *
 * Excluir la FILA del reembolso (revenuePaymentWhere) no basta: el pago
 * ORIGINAL sigue contando. Un paciente que paga $10,000 el 5 y se le devuelve
 * todo el 20 dejaba el mes en "ingresos $10,000, utilidad $10,000" — y sobre
 * ese número se pagan comisiones y se decide la nómina. El neto es $0.
 *
 * El KPI y la serie salen de las MISMAS filas, así que la suma de la serie es
 * el KPI por construcción y no por casualidad (misma lección que
 * lib/home/revenue-buckets). El neto PUEDE ser negativo —un cobro de enero
 * devuelto en febrero es dinero que salió en febrero— y no se recorta a 0:
 * esconderlo volvería a inflar la utilidad.
 */
export function netRevenueSeries(
  payments: DatedAmount[],
  refunds:  DatedAmount[],
  bucketKey: (d: Date) => string,
): { ingresos: number; reembolsos: number; porBucket: Record<string, number> } {
  const porBucket: Record<string, number> = {};
  let ingresos = 0;
  for (const p of payments) {
    const amt = p.amount ?? 0;
    ingresos += amt;
    const k = bucketKey(p.paidAt);
    porBucket[k] = (porBucket[k] ?? 0) + amt;
  }
  let reembolsos = 0;
  for (const r of refunds) {
    const amt = r.amount ?? 0;
    reembolsos += amt;
    const k = bucketKey(r.paidAt);
    porBucket[k] = (porBucket[k] ?? 0) - amt;
  }
  return { ingresos: money(ingresos - reembolsos), reembolsos: money(reembolsos), porBucket };
}

/**
 * `suggestedOpening` — efectivo (method "cash") cobrado HOY [00:00 MX → ahora]
 * que AÚN NO fue cuadrado en un corte cerrado. Sirve para prefijar el monto de
 * apertura de la próxima caja: es el efectivo físico en el cajón que ningún
 * corte previo ya contabilizó.
 *
 * Fórmula: Σ Payment.amount (cashOnHandPaymentWhere: method "cash", paidAt ∈
 * [inicioHoyMX, ahora], invoice.clinicId = clinicId y factura NO CANCELADA)
 * EXCLUYENDO los pagos cuyo paidAt cae dentro de la ventana [openedAt, closedAt]
 * de alguna caja CERRADA hoy.
 *
 * El filtro de canceladas es el mismo que usa deriveWindow y no es cosmético:
 * sin él, el efectivo de una factura anulada prefijaba un saldo de apertura que
 * no está en el cajón. Lo que este número TODAVÍA no puede descontar es un
 * reembolso pagado en efectivo, por la misma razón que expectedCashOf: el
 * reembolso no guarda su método (sql/payment-refund-method.sql) — ahí la
 * sugerencia sale ALTA. Y en el camino contrario (reembolso a la tarjeta y luego
 * factura cancelada) el efectivo sigue en el cajón y la sugerencia sale BAJA.
 * Por eso el campo del modal de apertura es editable y sigue siéndolo: es una
 * sugerencia, no un arqueo, y quien abre la caja cuenta el dinero.
 */
async function computeSuggestedOpening(clinicId: string, todayStart: Date, now: Date): Promise<number> {
  const [cashPayments, closedToday] = await Promise.all([
    prisma.payment.findMany({
      where:  cashOnHandPaymentWhere(clinicId, todayStart, now),
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
  // Vencido = por cobrar + dueDate < hoy (overdueInvoiceWhere), el MISMO
  // criterio que el KPI de Facturas y Finanzas → Saldos.
  const overdue = overdueInvoiceWhere(clinicId, todayStart);

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

  // Ventana del TURNO: arranca en la apertura de la caja, NO a medianoche. Es lo
  // correcto para un corte (el arqueo cuadra contra el efectivo desde que se
  // abrió), pero implica que `list` y `totals` pueden abarcar varios días
  // naturales si la caja no se cierra: la UI debe etiquetarlos como del turno y
  // fechar las filas cuando cruzan de día (ver caja-client.tsx).
  const from = reg.openedAt;
  const derived = await deriveWindow(clinicId, from, now);

  const withdrawalsTotal = reg.withdrawals.reduce((s, w) => s + (w.amount ?? 0), 0);
  // Fórmula ÚNICA, compartida con /api/caja/close (antes estaba escrita dos
  // veces, palabra por palabra, en los dos archivos).
  const expectedCash = expectedCashOf({
    openingBalance: reg.openingBalance,
    cashIncome:     derived.cashIncome,
    withdrawals:    withdrawalsTotal,
    cashRefunds:    derived.cashRefunds,
  });

  const totals: CajaTotals = {
    openingBalance:   money(reg.openingBalance),
    cashIncome:       money(derived.cashIncome),
    cardDebitIncome:  money(derived.cardDebitIncome),
    cardCreditIncome: money(derived.cardCreditIncome),
    // otherIncome de deriveWindow incluye tarjeta; aquí se resta para dejar
    // solo transfer/check/other.
    otherIncome:      money(derived.otherIncome - derived.cardDebitIncome - derived.cardCreditIncome),
    totalIncome:      money(derived.totalIncome),
    refunds:          money(derived.refunds),
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

/**
 * Resumen CONGELADO de un corte — exactamente lo que se imprime en el arqueo.
 *
 * Lo arma el servidor en el mismo instante en que cierra la caja, con la misma
 * ventana con la que calcula el snapshot, y lo devuelve /api/caja/close para que
 * el cliente lo imprima TAL CUAL. Antes el cliente imprimía sus totales del
 * render SSR mezclados con la `variance` fresca del servidor: si entraba un pago
 * entre el render y el clic, el papel salía diciendo "Esperado $5,000 · Contado
 * $5,000 · Diferencia −$700" — un documento de arqueo que se contradice a sí
 * mismo y una diferencia que no está en ninguna de sus filas.
 */
export interface CajaCloseSummary {
  openedAt:         string;
  closedAt:         string;
  openingBalance:   number;
  cashIncome:       number;
  cardDebitIncome:  number;
  cardCreditIncome: number;
  otherIncome:      number;
  totalIncome:      number;
  refunds:          number;
  discounts:        number;
  tax:              number;
  withdrawals:      number;
  expectedCash:     number;
  counted:          number;
  variance:         number;
  list:             CajaListRow[];
}

export function buildCloseSummary(args: {
  openedAt:       Date;
  closedAt:       Date;
  openingBalance: number;
  withdrawals:    number;
  counted:        number;
  derived:        Awaited<ReturnType<typeof deriveWindow>>;
}): CajaCloseSummary {
  const { derived } = args;
  const expectedCash = expectedCashOf({
    openingBalance: args.openingBalance,
    cashIncome:     derived.cashIncome,
    withdrawals:    args.withdrawals,
    cashRefunds:    derived.cashRefunds,
  });
  return {
    openedAt:         args.openedAt.toISOString(),
    closedAt:         args.closedAt.toISOString(),
    openingBalance:   money(args.openingBalance),
    cashIncome:       money(derived.cashIncome),
    cardDebitIncome:  money(derived.cardDebitIncome),
    cardCreditIncome: money(derived.cardCreditIncome),
    // Mismo significado que CajaTotals.otherIncome (solo transfer/check/other):
    // el de deriveWindow incluye tarjeta y el papel ya la desglosa aparte.
    otherIncome:      money(derived.otherIncome - derived.cardDebitIncome - derived.cardCreditIncome),
    totalIncome:      money(derived.totalIncome),
    refunds:          money(derived.refunds),
    discounts:        money(derived.discounts),
    tax:              money(derived.tax),
    withdrawals:      money(args.withdrawals),
    expectedCash,
    counted:          money(args.counted),
    variance:         money(args.counted - expectedCash),
    list:             derived.list,
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
