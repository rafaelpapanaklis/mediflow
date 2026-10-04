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
import { canSeePatient, type VisibilityViewer } from "@/lib/patient-visibility";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { calendarioDeCuotas, esPlanAPlazos, estadoDelPlan, pagosDesdeFilas } from "@/lib/invoices/plan-de-pagos";
import { conceptoConCuota, rotuloDeCuotasDelPago } from "@/lib/invoices/concepto-de-cuota";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { cargarVencimientosDeCargosDeControl } from "@/lib/orthodontics/cobranza-controles-db";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";
import {
  FUENTES_CREDITO_QUE_SON_INGRESO,
  REEMBOLSO_A_SALDO_A_FAVOR,
  esReembolsoEnEfectivo,
  esTraspasoASaldoAFavor,
} from "@/lib/dinero/reembolsos";
import { cobrosAsignados } from "@/lib/dinero/ajustes.server";
import { cobrosFueraDeCorte, diasAbierta, medianocheAnterior } from "@/lib/dinero/caja-core";

/**
 * Lo único que Caja LEE de la base, y nada más.
 *
 * Existe para que Sabina pueda leer la caja con ESTAS funciones —no con una copia
 * de sus reglas— pasándoles su propio cliente (`ctx.db`): en producción es el
 * mismo `prisma`, y en las pruebas es el doble con dos clínicas sembradas, que es
 * lo único que demuestra que la lectura no cruza de clínica. Por defecto sigue
 * siendo `prisma`, así que la pantalla y las rutas no cambian. Y como solo lista
 * lecturas, por aquí no entra un `create` ni por accidente.
 */
export type CajaDb = {
  cashRegister: Pick<typeof prisma.cashRegister, "findFirst" | "findMany">;
  payment:      Pick<typeof prisma.payment, "findMany">;
  invoice:      Pick<typeof prisma.invoice, "aggregate" | "findMany">;
  clinic:       Pick<typeof prisma.clinic, "findUnique">;
  user:         Pick<typeof prisma.user, "findMany">;
  /**
   * ws1-t5: el anticipo cobrado por Mercado Pago SIN factura vive solo en el
   * libro del saldo a favor (no hay Payment). Opcional para no obligar a los
   * dobles de prueba que ya existían: sin él, esas filas no se leen.
   */
  patientCredit?: Pick<typeof prisma.patientCredit, "findMany">;
};

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
 * Saldo a favor (anticipo) APLICADO a una factura. No es ingreso (ws1-t5, F2):
 * el dinero contó el día que se cobró —como Payment de su factura o como fila
 * de `patient_credits` (anticipoCobradoCreditWhere)— o es historia migrada.
 * Mismo valor que METODO_ANTICIPO de patient-credit-core.
 */
export const APPLIED_CREDIT_METHOD = "anticipo";

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
    // ws1-t5 (F2): tampoco el saldo a favor APLICADO («anticipo»). El ingreso
    // de un anticipo se acumula el día que se COBRA, no el día que se usa
    // (LISR art. 102: «aun cuando correspondan a anticipos»; art. 113-E,
    // RESICO: ingresos efectivamente cobrados). Contarlo al aplicarlo lo
    // contaba en el mes equivocado, y el saldo migrado de otro sistema
    // entraba como ingreso nuevo. CONFIRMAR CON CONTADOR (reporte ws1-t5).
    method:  { notIn: [REFUND_METHOD, APPLIED_CREDIT_METHOD] },
    invoice: facturaConDineroQueCuentaWhere(clinicId),
  };
}

/**
 * De qué facturas cuenta el DINERO (cobros y reembolsos). Auditoría de uso
 * C-01 (4-oct-2026): las no canceladas, y TAMBIÉN las canceladas cuyo dinero
 * salió por un «refund» — devuelto al paciente o pasado a su saldo a favor.
 *
 * Antes se descartaba toda factura CANCELADA, y eso borraba dinero que sí
 * entró: el anticipo de $500 de una cita que se canceló con «Dejarlo como saldo
 * a favor» (la factura se cancela, el cobro deja de contar y la aplicación
 * posterior —«anticipo»— tampoco cuenta) no era ingreso en ningún lado, y
 * además desaparecía RETROACTIVAMENTE del día en que se cobró. Ahora:
 *   · el cobro cuenta el día que entró, se cancele lo que se cancele después;
 *   · el traspaso a saldo a favor no resta (refundPaymentWhere lo excluye) y la
 *     aplicación tampoco suma: el dinero cuenta UNA vez;
 *   · un reembolso real de una factura cancelada resta el día que se devolvió
 *     (antes salía junto con el cobro y re-expresaba el mes del cobro).
 * Una factura cancelada SIN ningún «refund» se queda fuera como siempre: con
 * los flujos de hoy no puede tener cobros (/cancel exige reembolsar antes) y
 * así no se reinterpreta ninguna fila vieja de la que no se sabe qué pasó.
 */
export function facturaConDineroQueCuentaWhere(clinicId: string): Prisma.InvoiceWhereInput {
  return {
    clinicId,
    OR: [
      { status: { notIn: ["CANCELLED"] } },
      { status: "CANCELLED", payments: { some: { method: REFUND_METHOD } } },
    ],
  };
}

/**
 * `where` de `patient_credits` del dinero que ENTRÓ sin pasar por una factura
 * (no tiene Payment): el anticipo pagado por Mercado Pago sin factura y el
 * excedente de un cobro automático. Es ingreso el día de `creditDate` (ws1-t5,
 * F2). Quien sume ingresos de un periodo suma revenuePaymentWhere − reembolsos
 * + estas filas; la aplicación posterior («anticipo») ya no cuenta.
 */
export function anticipoCobradoCreditWhere(
  clinicId: string,
  creditDate: Prisma.DateTimeFilter,
): Prisma.PatientCreditWhereInput {
  return {
    clinicId,
    creditDate,
    source: { in: [...FUENTES_CREDITO_QUE_SON_INGRESO] },
    amount: { gt: 0 },
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
 * Entre periodos (C-01, 4-oct-2026): una factura cobrada en enero, reembolsada
 * y cancelada en febrero ya NO desaparece de enero — su cobro cuenta en enero y
 * su reembolso resta en febrero (facturaConDineroQueCuentaWhere).
 */
export function refundPaymentWhere(
  clinicId: string,
  paidAt: Prisma.DateTimeFilter,
): Prisma.PaymentWhereInput {
  return {
    paidAt,
    method:  REFUND_METHOD,
    // ws1-t5 (F3): el traspaso de un excedente, de una cita cancelada o de un
    // anticipo al saldo a favor también es un «refund» (baja `paid`), pero no
    // sale dinero: no es reembolso. Los viejos (NULL) siguen contando.
    OR: [{ refundMethod: null }, { refundMethod: { not: REEMBOLSO_A_SALDO_A_FAVOR } }],
    // C-01: el mismo conjunto de facturas que los cobros (espejo exacto).
    invoice: facturaConDineroQueCuentaWhere(clinicId),
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

// «Hoy» de la Caja: `medianocheAnterior(now, zona de la clínica)` (lib/dinero/caja-core,
// ws1-t5 F16). Antes era UTC−6 fijo y una clínica de Tijuana o Cancún veía el
// día corrido una o dos horas.

export interface CajaListRow {
  paymentId:   string;
  at:          string; // ISO — paidAt del pago
  patientName: string;
  concept:     string; // descripciones de invoice.items unidas
  amount:      number;
  method:      string;
  /** ws1-t5: solo en reembolsos — "saldo_a_favor" si fue un traspaso, o por dónde salió el dinero. */
  refundMethod?: string | null;
  discount:    number; // parte del descuento de la factura que le toca a ESTE movimiento (negativa si es reembolso)
  doctorName:  string; // vía invoice.appointment.doctor → Invoice.doctorId → "—"
}

export interface CajaTotals {
  openingBalance:   number;
  cashIncome:       number; // ingresos en efectivo ("cash")
  cardDebitIncome:  number; // ingresos con tarjeta de débito ("debit")
  cardCreditIncome: number; // ingresos con tarjeta de crédito ("credit")
  otherIncome:      number; // transfer / check / other (NO tarjeta)
  totalIncome:      number; // cash + débito + crédito + other (SIN reembolsos ni saldo a favor aplicado)
  refunds:          number; // Σ reembolsos REALES del turno (dinero que salió); se muestran en NEGATIVO, nunca suman
  /** ws1-t5: de `refunds`, lo que salió del cajón en efectivo (lo único que baja el esperado). */
  cashRefunds?:     number;
  /** ws1-t5: reembolsos viejos sin método registrado (no se sabe si salieron del cajón). */
  refundsUnknownMethod?: number;
  /** ws1-t5: saldo a favor APLICADO a facturas en el turno. No es ingreso: no entra dinero. */
  appliedCredit?:   number;
  /** ws1-t5: dinero que pasó de una factura al saldo a favor (excedente, cita cancelada). No sale dinero. */
  toCredit?:        number;
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
  // Vencido (H21a): facturas de un pago → balance completo si dueDate < hoy
  // (de siempre); facturas A PLAZOS (invoice_payment_terms) → SOLO sus cuotas
  // vencidas (estadoDelPlan.importeVencido), nunca el balance completo. Ver
  // computeOverdueAmount.
  overdueToday:     number;
  // Los saldos de TODA la clínica, de `computeReceivables` (fila 87): la
  // pestaña Facturas pinta estos mismos números, no otra cuenta. Opcionales en
  // el tipo para no romper a quien arma un CajaState a mano; `getCajaState`
  // los manda siempre.
  receivableTotal?:  number;                 // POR COBRAR: todo lo que falta por cobrar
  overdueByInvoice?: Record<string, number>; // lo vencido de cada factura con algo vencido
  receivablesIncompleto?: boolean;           // true = se tocó el techo de lectura: las dos cifras son un mínimo
  /** ws1-t5 (F7): cobros en efectivo que ningún corte recoge (últimos 90 días). */
  fueraDeCorte?: CobroFueraDeCorte[];
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

/**
 * A qué cuota fue cada cobro del turno, para los que son de una factura A
 * PLAZOS: `paymentId` → «mensualidad 7 de 24» (`rotuloDeCuotasDelPago`). Dos
 * lecturas, y solo si el turno tiene cobros: las condiciones de esas facturas
 * en lote y, de las que sí son a plazos, todos sus pagos (hace falta el
 * historial entero para saber por cuál cuota iba). Es un adorno del concepto:
 * si algo falla devuelve el mapa vacío y el corte sale como siempre.
 */
async function cuotaDeCadaPago(
  clinicId: string,
  payments: Array<{ id: string; invoiceId: string; invoice?: { total?: number | null } | null }>,
  db: CajaDb,
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  const totalPorFactura = new Map<string, number>();
  for (const p of payments) if (p.invoiceId) totalPorFactura.set(p.invoiceId, p.invoice?.total ?? 0);
  if (!clinicId || totalPorFactura.size === 0) return salida;
  try {
    const { porFactura } = await leerCondicionesDeFacturas(db as unknown as typeof prisma, {
      clinicId,
      invoiceIds: Array.from(totalPorFactura.keys()),
    });
    const aPlazos = Array.from(totalPorFactura.keys()).filter((id) => esPlanAPlazos(porFactura.get(id)));
    if (aPlazos.length === 0) return salida;

    const historial = await db.payment.findMany({
      where:  { invoiceId: { in: aPlazos }, invoice: { clinicId } },
      select: { id: true, invoiceId: true, amount: true, method: true, paidAt: true },
    });
    const pagosPorFactura = new Map<string, typeof historial>();
    for (const h of historial) {
      const lista = pagosPorFactura.get(h.invoiceId);
      if (lista) lista.push(h);
      else pagosPorFactura.set(h.invoiceId, [h]);
    }
    for (const p of payments) {
      const condiciones = porFactura.get(p.invoiceId);
      if (!esPlanAPlazos(condiciones)) continue;
      const rotulo = rotuloDeCuotasDelPago(condiciones, totalPorFactura.get(p.invoiceId) ?? 0, pagosPorFactura.get(p.invoiceId) ?? [], p.id);
      if (rotulo) salida.set(p.id, rotulo);
    }
    return salida;
  } catch (e) {
    console.warn("[caja] no se pudo saber a qué cuota fue cada cobro:", e);
    return new Map();
  }
}

/** Caja OPEN de la clínica (o null). Incluye operador y retiros. */
export async function getOpenRegister(clinicId: string, db: CajaDb = prisma) {
  return db.cashRegister.findFirst({
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
 *
 * `opts.viewer`: si llega, el nombre de un paciente restringido que ese usuario
 * no puede ver sale como "Paciente privado" — el criterio de la pestaña Facturas
 * (canSeePatient), que enmascara SIN sacar la fila para que los totales cuadren.
 * Sin viewer, la lista sale como siempre (la pantalla de Caja no lo pasa hoy).
 */
export async function deriveWindow(
  clinicId: string,
  from: Date,
  to: Date,
  opts: {
    db?: CajaDb;
    viewer?: VisibilityViewer;
    /**
     * ws1-t5 (F7): cobros en efectivo fuera de todo corte que alguien pasó a
     * ESTA caja (caja_cobros_asignados). Entran al turno aunque su `paidAt`
     * quede fuera de la ventana.
     */
    asignados?: ReadonlySet<string>;
  } = {},
) {
  const db = opts.db ?? prisma;
  const idsAsignados = Array.from(opts.asignados ?? []);
  const enVentana: Prisma.PaymentWhereInput = idsAsignados.length > 0
    ? { OR: [{ paidAt: { gte: from, lte: to } }, { id: { in: idsAsignados } }] }
    : { paidAt: { gte: from, lte: to } };
  const [payments, courtesyAgg, clinic] = await Promise.all([
    db.payment.findMany({
      // C-01: también las canceladas cuyo dinero se devolvió o pasó a saldo a
      // favor (el anticipo cobrado sigue en el turno en que entró).
      where: { ...enVentana, invoice: facturaConDineroQueCuentaWhere(clinicId) },
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
            // visibleUserIds solo decide el enmascarado de `opts.viewer`; no sale en la fila.
            patient:     { select: { firstName: true, lastName: true, visibleUserIds: true } },
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
    db.invoice.aggregate({
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
    db.clinic.findUnique({ where: { id: clinicId }, select: { cfdiTaxMode: true } }),
  ]);
  const clinicTaxMode = clinic?.cfdiTaxMode ?? null;
  const anticiposCobrados = await leerAnticiposCobrados(clinicId, from, to, db);

  // Nombres de los doctores atribuidos a mano (facturas creadas desde Caja, que
  // no nacen de una cita y por tanto no tienen invoice.appointment.doctor).
  // Acotado a la clínica: el doctorId de la factura nunca se muestra a ciegas.
  const attributedIds = Array.from(new Set(
    payments.map((p) => (p.invoice as any)?.doctorId).filter(Boolean) as string[],
  ));
  const attributedById = new Map<string, { firstName: string | null; lastName: string | null }>();
  if (attributedIds.length > 0) {
    const docs = await db.user.findMany({
      where:  { id: { in: attributedIds }, clinicId },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const d of docs) attributedById.set(d.id, { firstName: d.firstName, lastName: d.lastName });
  }

  const cuotaDelPago = await cuotaDeCadaPago(clinicId, payments, db);

  let cashIncome = 0;
  let cardDebitIncome = 0;
  let cardCreditIncome = 0;
  let otherIncome = 0; // todo lo no-efectivo (incluye tarjeta)
  let refunds = 0;     // reembolsos REALES del turno: se muestran, NO suman
  let cashRefunds = 0; // de ellos, los que salieron del cajón
  let refundsUnknownMethod = 0; // de ellos, los viejos sin método (NULL)
  let toCredit = 0;    // traspasos a saldo a favor: ni ingreso ni reembolso
  let appliedCredit = 0; // saldo a favor aplicado: no entra dinero
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
      // ws1-t5 (F3/F5): el traspaso a saldo a favor no es salida de dinero, y
      // solo el reembolso EN EFECTIVO sale del cajón.
      const mov = { method: p.method, refundMethod: (p as { refundMethod?: string | null }).refundMethod ?? null };
      if (esTraspasoASaldoAFavor(mov)) {
        toCredit += amount;
      } else {
        refunds += amount;
        if (esReembolsoEnEfectivo(mov)) cashRefunds += amount;
        else if (mov.refundMethod == null) refundsUnknownMethod += amount;
      }
    } else if (p.method === APPLIED_CREDIT_METHOD) {
      // ws1-t5 (F2): aplicar saldo a favor no mete dinero al turno; su IVA y
      // su ingreso contaron el día que se cobró el anticipo.
      appliedCredit += amount;
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
      patientName: opts.viewer && p.invoice?.patient && !canSeePatient(opts.viewer, p.invoice.patient.visibleUserIds)
        ? "Paciente privado"
        : fullName(p.invoice?.patient),
      // Si el cobro fue a una factura a plazos, dice a qué cuota: «… —
      // mensualidad 7 de 24». Doce abonos iguales ya no se confunden en el corte.
      concept:     conceptoConCuota(conceptOf(p.invoice?.items), cuotaDelPago.get(p.id) ?? null),
      amount,
      method:      p.method,
      ...(p.method === REFUND_METHOD ? { refundMethod: (p as { refundMethod?: string | null }).refundMethod ?? null } : {}),
      discount:    money(discountPortion),
      // La cita manda (es el dato clínico); si la factura se creó suelta desde
      // Caja, se cae al doctor que el usuario eligió en el editor.
      doctorName:  fullName(p.invoice?.appointment?.doctor ?? attributedById.get((p.invoice as any)?.doctorId ?? "")),
    };
  });

  // ws1-t5 (F2): el anticipo cobrado por Mercado Pago sin factura entra al
  // turno el día que se cobró (no es efectivo: va con «otros»). Lleva su fila
  // en la lista para que el corte diga de dónde salió el número.
  for (const c of anticiposCobrados) {
    otherIncome += c.amount;
    tax += invoiceTaxPortion(c.amount, { taxRate: null, taxIncluded: null }, clinicTaxMode);
    list.push({
      paymentId:   `credito:${c.id}`,
      at:          c.creditDate.toISOString(),
      patientName: opts.viewer && c.patient && !canSeePatient(opts.viewer, c.patient.visibleUserIds)
        ? "Paciente privado"
        : fullName(c.patient),
      concept:     "Anticipo (queda como saldo a favor)",
      amount:      c.amount,
      method:      "mercadopago",
      discount:    0,
      doctorName:  "—",
    });
  }
  if (anticiposCobrados.length > 0) list.sort((a, b) => a.at.localeCompare(b.at));

  const totalIncome = cashIncome + otherIncome;

  // Descuentos del turno = los prorrateados de lo cobrado + los de las cortesías
  // emitidas en la ventana (que no pueden cobrarse nunca, ver arriba).
  const discountsTotal = discounts + (courtesyAgg._sum.discount ?? 0);

  return {
    cashIncome, cardDebitIncome, cardCreditIncome, otherIncome, totalIncome,
    refunds: money(refunds), cashRefunds: money(cashRefunds), refundsUnknownMethod: money(refundsUnknownMethod),
    toCredit: money(toCredit), appliedCredit: money(appliedCredit),
    discounts: money(discountsTotal), tax: money(tax), list,
  };
}

/** Anticipos cobrados sin factura en la ventana (anticipoCobradoCreditWhere). Tolerante: sin el libro, nada. */
async function leerAnticiposCobrados(clinicId: string, from: Date, to: Date, db: CajaDb) {
  if (!clinicId || !db.patientCredit) return [];
  try {
    const filas = await db.patientCredit.findMany({
      where:   anticipoCobradoCreditWhere(clinicId, { gte: from, lte: to }),
      select:  {
        id: true, amount: true, creditDate: true,
        patient: { select: { firstName: true, lastName: true, visibleUserIds: true } },
      },
      orderBy: { creditDate: "asc" },
    });
    return filas as Array<{ id: string; amount: number; creditDate: Date; patient: { firstName: string | null; lastName: string | null; visibleUserIds: string[] } | null }>;
  } catch (e) {
    console.warn("[caja] no se pudieron leer los anticipos cobrados:", (e as Error)?.message);
    return [];
  }
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
 * `cashRefunds` (ws1-t5, F5): los reembolsos con `refundMethod = "cash"`. El
 * modal de reembolso pide siempre por dónde salió el dinero; los viejos (NULL)
 * no se restan: restar TODOS cambiaría el faltante fantasma por un sobrante
 * fantasma en las clínicas que devuelven a la tarjeta.
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
 * no está en el cajón. Desde ws1-t5 se resta también lo reembolsado EN
 * EFECTIVO hoy (`refundMethod = "cash"`); un reembolso viejo sin método no se
 * resta (no se sabe si salió del cajón). Y en el camino contrario (reembolso a la tarjeta y luego
 * factura cancelada) el efectivo sigue en el cajón y la sugerencia sale BAJA.
 * Por eso el campo del modal de apertura es editable y sigue siéndolo: es una
 * sugerencia, no un arqueo, y quien abre la caja cuenta el dinero.
 */
export async function computeSuggestedOpening(clinicId: string, todayStart: Date, now: Date, db: CajaDb = prisma): Promise<number> {
  const [cashPayments, cashRefundRows, closedToday] = await Promise.all([
    db.payment.findMany({
      where:  cashOnHandPaymentWhere(clinicId, todayStart, now),
      select: { amount: true, paidAt: true },
    }),
    // ws1-t5 (F5): lo reembolsado EN EFECTIVO hoy salió del cajón.
    db.payment.findMany({
      where:  { ...refundPaymentWhere(clinicId, { gte: todayStart, lte: now }), refundMethod: CASH_METHOD },
      select: { amount: true, paidAt: true },
    }),
    db.cashRegister.findMany({
      where:  { clinicId, status: "CLOSED", closedAt: { gte: todayStart } },
      select: { openedAt: true, closedAt: true },
    }),
  ]);

  const isCounted = (at: Date) =>
    closedToday.some((r) => r.closedAt != null && at >= r.openedAt && at <= r.closedAt);

  const entra = cashPayments.reduce((sum, p) => (isCounted(p.paidAt) ? sum : sum + (p.amount ?? 0)), 0);
  const sale = cashRefundRows.reduce((sum, p) => (isCounted(p.paidAt) ? sum : sum + (p.amount ?? 0)), 0);
  return Math.max(0, entra - sale);
}

/** Una factura A PLAZOS, con lo que hace falta para saber cuánto de ella está
 *  vencido de verdad: su total (denominador del calendario) y sus cobros. */
export interface FacturaAPlazosParaVencido {
  total:       number | null;
  condiciones: CondicionesPago;
  cobros:      Array<{ amount: unknown; method?: string | null }>;
}

/**
 * Cuánto de UNA factura a plazos está REALMENTE vencido hoy: la suma de
 * `falta` de sus cuotas vencidas (`estadoDelPlan.importeVencido`,
 * `plan-de-pagos.ts`) — el MISMO motor que ya usan el Tablero y las Alertas
 * de ortodoncia (`computeOverdueBalances`, `specialty-kpis.ts`), no una copia.
 *
 * Nunca por `Invoice.dueDate`: es un campo de texto libre ("Vence el") que la
 * recepcionista llena a mano en el editor de facturas, y guardar las
 * condiciones a plazos (PUT /api/invoices/[id]/condiciones) NO lo toca —
 * puede quedar vacío, o con una fecha que no tiene ninguna relación con el
 * calendario de cuotas acordado.
 */
export function overdueInstallmentsOf(f: FacturaAPlazosParaVencido, hoy: string): number {
  const cuotas = calendarioDeCuotas(f.condiciones, f.total ?? 0);
  const pagos = pagosDesdeFilas(f.cobros);
  return estadoDelPlan(cuotas, pagos, hoy).importeVencido;
}

/** Una factura por cobrar, tal como la necesita `computeOverdueAmount`. */
export interface FacturaPorCobrarParaVencido {
  id:          string;
  balance:     number | null;
  dueDate:     Date | null;
  total:       number | null;
  /** `null`/`undefined` = de un solo pago (o sin `invoice_payment_terms` aplicado todavía). */
  condiciones: CondicionesPago | null | undefined;
  /** Solo se usan si `condiciones` es a plazos. */
  cobros:      Array<{ amount: unknown; method?: string | null }>;
  /**
   * Solo para un CARGO DE CONTROL de ortodoncia (modo «pago por control»): el
   * día "YYYY-MM-DD" en que vence (`vencimientoDeCargoDeControl`). Esas
   * facturas nacen sin `dueDate` al firmar la hoja, y Cobranza de ortodoncia
   * las da por vencidas al día siguiente; sin esto, Caja nunca las contaba.
   */
  vencimientoControl?: string | null;
}

/**
 * Cuánto de UNA factura por cobrar está vencido hoy. Tres poblaciones
 * disjuntas, en este orden:
 *   1. a plazos → solo sus cuotas vencidas (`overdueInstallmentsOf`);
 *   2. cargo de control de ortodoncia → su saldo completo si ya pasó su día;
 *   3. de un solo pago → su saldo completo si `dueDate` < hoy (sin `dueDate`
 *      no vence jamás).
 */
export function overdueOfInvoice(f: FacturaPorCobrarParaVencido, todayStart: Date, hoy: string): number {
  if (esPlanAPlazos(f.condiciones)) {
    return overdueInstallmentsOf({ total: f.total, condiciones: f.condiciones, cobros: f.cobros }, hoy);
  }
  if (f.vencimientoControl) return f.vencimientoControl < hoy ? f.balance ?? 0 : 0;
  if (f.dueDate && f.dueDate.getTime() < todayStart.getTime()) return f.balance ?? 0;
  return 0;
}

/**
 * El «Vencido» de TODAS las facturas por cobrar de una clínica (H21a, ronda 4).
 *
 * Dos poblaciones disjuntas por `esPlanAPlazos`, así que nada se cuenta dos
 * veces: de un solo pago → el criterio de SIEMPRE (`dueDate < hoy`, balance
 * completo); a plazos → SOLO `overdueInstallmentsOf` (nunca el balance
 * completo, que contaría como vencido un plan al corriente con `dueDate`
 * vacío o pasado, o de menos si `dueDate` es futuro y ya hay una mensualidad
 * vieja sin cubrir).
 *
 * Sin ninguna factura a plazos, el resultado es IDÉNTICO al de siempre.
 */
export function computeOverdueAmount(
  facturas: FacturaPorCobrarParaVencido[],
  todayStart: Date,
  hoy: string,
): number {
  let total = 0;
  for (const f of facturas) total += overdueOfInvoice(f, todayStart, hoy);
  return money(total);
}

/** "YYYY-MM-DD" de `now` en la zona de la clínica — mismo criterio que
 *  `hoyEnZona` (lib/whatsapp/cobranza/sweep.ts) y el Tablero de ortodoncia,
 *  sin acoplar Caja al módulo de WhatsApp por una función de una línea. */
function hoyEnZonaClinica(now: Date, timezone: string): string {
  const p = getTzParts(now, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Los dos saldos de la clínica, con UNA sola definición para todo el panel. */
export interface SaldosDeLaClinica {
  /** POR COBRAR: todo lo que falta por cobrar de las facturas emitidas (ni borrador ni cancelada). */
  porCobrar: number;
  /** VENCIDO: la parte de lo por cobrar cuya fecha ya pasó (por cuota en las facturas a plazos). */
  vencido:   number;
  /** Lo vencido de cada factura que tiene algo vencido: `invoiceId` → pesos. */
  vencidoPorFactura: Record<string, number>;
  /**
   * `true` solo si se tocó el techo de seguridad (`RECEIVABLES_MAX_PAGINAS` ×
   * `RECEIVABLES_PAGINA` facturas abiertas): las cifras son un MÍNIMO. Por
   * debajo de ese techo se leen TODAS, en tandas, y es siempre `false`.
   */
  incompleto: boolean;
}

/** Facturas por cobrar por tanda en `computeReceivables` (lista `IN` acotada). */
export const RECEIVABLES_PAGINA = 2000;
/** Techo de tandas: 50 × 2000 = 100 000 facturas abiertas. Pasado eso, `incompleto`. */
export const RECEIVABLES_MAX_PAGINAS = 50;

/** Opciones de `computeReceivables` para quien necesita un SUBCONJUNTO (Sabina). */
export interface OpcionesDeSaldos {
  /**
   * Filtro EXTRA sobre las facturas por cobrar (p. ej. la visibilidad por
   * paciente, o `createdAt`). Se añade con `AND`: nunca ensancha ni reemplaza
   * `receivableInvoiceWhere(clinicId)`.
   */
  filtro?:   Prisma.InvoiceWhereInput;
  /** Zona de la clínica si quien llama ya la tiene: ahorra la lectura de `Clinic.timezone`. */
  timezone?: string;
  /** Solo para pruebas: tamaño de tanda y techo de tandas. */
  pagina?:     number;
  maxPaginas?: number;
}

const SALDOS_VACIOS = (): SaldosDeLaClinica => ({ porCobrar: 0, vencido: 0, vencidoPorFactura: {}, incompleto: false });

/**
 * «POR COBRAR» y «VENCIDO» de la clínica (fila 87 de la revisión de lógica de
 * uso). Es LA función: la usan la pestaña Caja, la pestaña Facturas (KPIs, la
 * píldora «Vencida» y el filtro «Vencidas»), Finanzas y Sabina, que antes daban
 * cifras distintas el mismo día (contaban vencido por `dueDate` y el saldo
 * entero; Caja, por cuota).
 *
 * Lee las facturas por cobrar EN TANDAS de `RECEIVABLES_PAGINA` (cursor por
 * `id`), sin `payments` (la inmensa mayoría es de un solo pago y no los
 * necesita). Por cada tanda: sus condiciones de pago EN LOTE
 * (`leerCondicionesDeFacturas` — sin `sql/factura-condiciones-pago.sql`
 * aplicado no revienta: no encuentra ninguna a plazos) y, SOLO para las que sí
 * son a plazos, sus pagos. Una vez: la zona de la clínica y los cargos de
 * control de ortodoncia (tolerante). Antes había un `take: 5000` que cortaba
 * en silencio; ahora se lee todo hasta un techo de 100 000 y, si se toca,
 * `incompleto: true` (y un aviso en el log). «Hoy» es el día de la CLÍNICA.
 * Como mucho dos consultas a la vez.
 */
export async function computeReceivables(
  clinicId: string,
  now: Date = new Date(),
  db: CajaDb = prisma,
  /** Solo para pruebas: de dónde salen los cargos de control de ortodoncia. */
  leerCargosDeControl: (clinicId: string) => Promise<Map<string, string>> = cargarVencimientosDeCargosDeControl,
  opciones: OpcionesDeSaldos = {},
): Promise<SaldosDeLaClinica> {
  // `clinicId: undefined` no filtra nada en Prisma: sin clínica no se consulta.
  if (!clinicId) return SALDOS_VACIOS();
  const pagina = Math.max(1, opciones.pagina ?? RECEIVABLES_PAGINA);
  const maxPaginas = Math.max(1, opciones.maxPaginas ?? RECEIVABLES_MAX_PAGINAS);

  const leerTanda = (despuesDe: string | null) => db.invoice.findMany({
    where: {
      ...receivableInvoiceWhere(clinicId),
      AND: [
        ...(opciones.filtro ? [opciones.filtro] : []),
        ...(despuesDe ? [{ id: { gt: despuesDe } }] : []),
      ],
    },
    select:  { id: true, balance: true, dueDate: true, total: true },
    orderBy: { id: "asc" },
    take:    pagina,
  });

  let tanda = await leerTanda(null);
  if (tanda.length === 0) return SALDOS_VACIOS();

  const [clinic, vencimientosControl] = await Promise.all([
    opciones.timezone
      ? Promise.resolve({ timezone: opciones.timezone })
      : db.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }),
    leerCargosDeControl(clinicId).catch(() => new Map<string, string>()),
  ]);
  const timezone = clinic?.timezone || DEFAULT_INVOICE_TZ;
  const hoy = hoyEnZonaClinica(now, timezone);
  const todayStart = tzLocalToUtc(hoy, 0, 0, timezone);

  let porCobrarC = 0;
  let vencidoC = 0;
  const vencidoPorFactura: Record<string, number> = {};
  let incompleto = false;

  for (let n = 1; ; n++) {
    const { porFactura } = await leerCondicionesDeFacturas(db as unknown as typeof prisma, { clinicId, invoiceIds: tanda.map((f) => f.id) });
    const idsAPlazos = tanda.filter((f) => esPlanAPlazos(porFactura.get(f.id))).map((f) => f.id);
    const cobrosPorFactura = idsAPlazos.length === 0
      ? new Map<string, Array<{ amount: unknown; method: string | null }>>()
      : new Map((await db.invoice.findMany({
          where:  { id: { in: idsAPlazos }, clinicId },
          select: { id: true, payments: { select: { amount: true, method: true } } },
        })).map((i) => [i.id, i.payments]));

    for (const f of tanda) {
      porCobrarC += Math.round((f.balance ?? 0) * 100);
      const v = overdueOfInvoice(
        { ...f, condiciones: porFactura.get(f.id), cobros: cobrosPorFactura.get(f.id) ?? [], vencimientoControl: vencimientosControl.get(f.id) ?? null },
        todayStart,
        hoy,
      );
      if (v > 0) {
        vencidoC += Math.round(v * 100);
        vencidoPorFactura[f.id] = money(v);
      }
    }

    if (tanda.length < pagina) break;
    if (n >= maxPaginas) {
      // Quedan (o pueden quedar) más: se dice, no se corta en silencio.
      incompleto = true;
      console.warn(`[caja:saldos] clínica ${clinicId}: más de ${pagina * maxPaginas} facturas abiertas; «Por cobrar» y «Vencido» son un mínimo.`);
      break;
    }
    tanda = await leerTanda(tanda[tanda.length - 1].id);
    if (tanda.length === 0) break;
  }
  return { porCobrar: porCobrarC / 100, vencido: vencidoC / 100, vencidoPorFactura, incompleto };
}

/**
 * El `where` de «facturas VENCIDAS» para una lista (el filtro «Vencidas» de
 * GET /api/invoices): las que `computeReceivables` dio por vencidas, y nada
 * más — la misma regla que el KPI «Vencido», sin volver a decidirla. Siempre
 * con el `clinicId` de quien pregunta. `null` = ninguna vencida (no consultes:
 * un `in: []` no aporta nada y un `where` vacío traería todas).
 */
export function whereFacturasVencidas(clinicId: string, saldos: Pick<SaldosDeLaClinica, "vencidoPorFactura">): Prisma.InvoiceWhereInput | null {
  if (!clinicId) return null;
  const ids = Object.keys(saldos.vencidoPorFactura).filter((id) => (saldos.vencidoPorFactura[id] ?? 0) > 0);
  if (ids.length === 0) return null;
  return { clinicId, id: { in: ids } };
}

/**
 * Resumen de facturación del día natural (México), independiente del turno:
 *  - billedToday:  Σ total de facturas EMITIDAS hoy (excluye DRAFT/CANCELLED).
 *  - pendingToday: Σ saldo por cobrar de esas mismas facturas de hoy.
 *  - overdueToday: el «vencido» de `computeReceivables` — el mismo de la
 *    pestaña Facturas y de Finanzas.
 */
async function computeDayBilling(clinicId: string, todayStart: Date, now: Date, db: CajaDb = prisma) {
  const issuedToday: Prisma.InvoiceWhereInput = {
    clinicId,
    status:    { notIn: ["DRAFT", "CANCELLED"] },
    createdAt: { gte: todayStart, lte: now },
  };

  const [billedAgg, pendingAgg, saldos] = await Promise.all([
    db.invoice.aggregate({ _sum: { total: true },   where: issuedToday }),
    db.invoice.aggregate({ _sum: { balance: true }, where: issuedToday }),
    computeReceivables(clinicId, now, db),
  ]);

  return {
    billedToday:  billedAgg._sum.total    ?? 0,
    pendingToday: pendingAgg._sum.balance ?? 0,
    overdueToday: saldos.vencido,
    receivableTotal:  saldos.porCobrar,
    overdueByInvoice: saldos.vencidoPorFactura,
    receivablesIncompleto: saldos.incompleto,
  };
}

/** El TURNO abierto: la parte de CajaState que no depende del «hoy». */
export type CajaShift = Pick<CajaState, "register" | "totals" | "withdrawals" | "list">;

/**
 * Estado completo de la caja para la UI y GET /api/caja/current.
 * Si no hay caja abierta → register/totals null (list vacía), pero el resumen
 * del día (suggestedOpening + facturación) SIEMPRE se calcula y devuelve.
 */
export async function getCajaState(clinicId: string, opts: { timezone?: string | null } = {}): Promise<CajaState> {
  const now = new Date();
  // ws1-t5 (F16): «hoy» es el día de la CLÍNICA (Tijuana, Cancún…), no UTC−6
  // fijo. Quien llama suele tenerla ya (la página la trae en la sesión).
  const timezone = opts.timezone
    || (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }).catch(() => null))?.timezone
    || DEFAULT_INVOICE_TZ;
  const todayStart = medianocheAnterior(now, timezone);

  const [reg, suggestedOpening, dayBilling, fueraDeCorte] = await Promise.all([
    getOpenRegister(clinicId),
    computeSuggestedOpening(clinicId, todayStart, now),
    computeDayBilling(clinicId, todayStart, now),
    computeCobrosFueraDeCorte(clinicId, now),
  ]);

  const day = {
    suggestedOpening: money(suggestedOpening),
    billedToday:      money(dayBilling.billedToday),
    pendingToday:     money(dayBilling.pendingToday),
    overdueToday:     money(dayBilling.overdueToday),
    receivableTotal:  money(dayBilling.receivableTotal),
    overdueByInvoice: dayBilling.overdueByInvoice,
    receivablesIncompleto: dayBilling.receivablesIncompleto,
  };

  const asignados = reg ? await cobrosAsignados(clinicId, { cashRegisterId: reg.id }) : new Set<string>();
  return { ...(await shiftOf(clinicId, reg, now, { asignados })), ...day, fueraDeCorte };
}

/** Cuántos días atrás se buscan cobros en efectivo fuera de corte. */
export const DIAS_FUERA_DE_CORTE = 90;

export interface CobroFueraDeCorte {
  paymentId:   string;
  at:          string;
  patientName: string;
  concept:     string;
  amount:      number;
}

/**
 * ws1-t5 (F7): cobros en EFECTIVO de los últimos 90 días que ningún corte
 * recoge (ver `cobrosFueraDeCorte`). Tolerante: si algo falla, lista vacía y
 * la Caja se pinta como siempre.
 */
export async function computeCobrosFueraDeCorte(
  clinicId: string,
  now: Date,
  db: CajaDb = prisma,
  asignadosDe: (clinicId: string) => Promise<ReadonlySet<string>> = (c) => cobrosAsignados(c),
): Promise<CobroFueraDeCorte[]> {
  if (!clinicId) return [];
  try {
    const desde = new Date(now.getTime() - DIAS_FUERA_DE_CORTE * 86_400_000);
    const [primera, cajas, cobros, asignados] = await Promise.all([
      db.cashRegister.findFirst({ where: { clinicId }, orderBy: { openedAt: "asc" }, select: { openedAt: true } }),
      db.cashRegister.findMany({
        where:  { clinicId, OR: [{ status: "OPEN" }, { closedAt: { gte: desde } }] },
        select: { id: true, openedAt: true, closedAt: true },
      }),
      db.payment.findMany({
        where:   cashOnHandPaymentWhere(clinicId, desde, now),
        select:  {
          id: true, amount: true, paidAt: true,
          invoice: { select: { items: true, patient: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { paidAt: "desc" },
        take:    500,
      }),
      asignadosDe(clinicId),
    ]);
    const fuera = cobrosFueraDeCorte(
      cobros as Array<{ id: string; paidAt: Date; amount: number | null; invoice: { items: unknown; patient: { firstName: string | null; lastName: string | null } | null } | null }>,
      cajas,
      asignados,
      now,
      primera?.openedAt ?? null,
    );
    return fuera.map((c) => ({
      paymentId:   c.id,
      at:          c.paidAt.toISOString(),
      patientName: fullName(c.invoice?.patient),
      concept:     conceptOf(c.invoice?.items),
      amount:      money(c.amount ?? 0),
    }));
  } catch (e) {
    console.warn("[caja] no se pudieron leer los cobros fuera de corte:", (e as Error)?.message);
    return [];
  }
}

/** ws1-t5: días completos que lleva abierta la caja abierta (0 = menos de 24 h o ninguna). */
export async function diasDeCajaAbierta(clinicId: string, now: Date = new Date(), db: CajaDb = prisma): Promise<number> {
  if (!clinicId) return 0;
  const reg = await db.cashRegister.findFirst({
    where: { clinicId, status: "OPEN" }, orderBy: { openedAt: "asc" }, select: { openedAt: true },
  });
  return reg ? diasAbierta(reg.openedAt, now) : 0;
}

/**
 * Solo el turno abierto, sin el resumen del día. Lo usa Sabina.
 *
 * Es el mismo cálculo que getCajaState —las dos pasan por shiftOf—, sin las
 * cinco consultas del resumen del día: Sabina no repite esas cuatro cifras
 * («cobrado hoy» no es lo cobrado y la apertura sugerida no es un conteo), y
 * además van en UTC−6 fijo, no en la zona de la clínica.
 */
export async function getCajaShift(
  clinicId: string,
  opts: { db?: CajaDb; viewer?: VisibilityViewer; now?: Date } = {},
): Promise<CajaShift> {
  const db = opts.db ?? prisma;
  const reg = await getOpenRegister(clinicId, db);
  // Los cobros pasados a mano a esta caja se leen con SQL crudo: solo con la
  // base real (un doble de pruebas no los tiene).
  const asignados = reg && db === prisma ? await cobrosAsignados(clinicId, { cashRegisterId: reg.id }) : new Set<string>();
  return shiftOf(clinicId, reg, opts.now ?? new Date(), { db, viewer: opts.viewer, asignados });
}

async function shiftOf(
  clinicId: string,
  reg: Awaited<ReturnType<typeof getOpenRegister>>,
  now: Date,
  opts: { db?: CajaDb; viewer?: VisibilityViewer; asignados?: ReadonlySet<string> },
): Promise<CajaShift> {
  if (!reg) return { register: null, totals: null, withdrawals: [], list: [] };

  // Ventana del TURNO: arranca en la apertura de la caja, NO a medianoche. Es lo
  // correcto para un corte (el arqueo cuadra contra el efectivo desde que se
  // abrió), pero implica que `list` y `totals` pueden abarcar varios días
  // naturales si la caja no se cierra: la UI debe etiquetarlos como del turno y
  // fechar las filas cuando cruzan de día (ver caja-client.tsx).
  const from = reg.openedAt;
  const derived = await deriveWindow(clinicId, from, now, opts);

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
    cashRefunds:      money(derived.cashRefunds),
    refundsUnknownMethod: money(derived.refundsUnknownMethod),
    appliedCredit:    money(derived.appliedCredit),
    toCredit:         money(derived.toCredit),
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
  /** ws1-t5: lo reembolsado EN EFECTIVO (ya restado del esperado). */
  cashRefunds?:     number;
  appliedCredit?:   number;
  toCredit?:        number;
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
  // Los tres de ws1-t5 son opcionales: quien arma el resumen a mano sin ellos sigue valiendo.
  derived:        Omit<Awaited<ReturnType<typeof deriveWindow>>, "refundsUnknownMethod" | "toCredit" | "appliedCredit">
                  & Partial<Pick<Awaited<ReturnType<typeof deriveWindow>>, "refundsUnknownMethod" | "toCredit" | "appliedCredit">>;
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
    cashRefunds:      money(derived.cashRefunds),
    appliedCredit:    money(derived.appliedCredit ?? 0),
    toCredit:         money(derived.toCredit ?? 0),
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
export async function getCajaHistory(clinicId: string, limit = 30, db: CajaDb = prisma) {
  const rows = await db.cashRegister.findMany({
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
