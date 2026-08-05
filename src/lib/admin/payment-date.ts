/**
 * Fecha de un cobro de suscripción (subscription_invoices) para el panel /admin.
 *
 * `createdAt` es cuándo se INSERTÓ LA FILA, no cuándo se cobró. Los cobros
 * históricos de Stripe entraron de golpe por
 * POST /api/admin/billing/backfill-stripe, así que todos comparten el día de la
 * importación: la tabla mostraba la misma fecha para pagos de meses distintos.
 *
 * La fecha real vive en `paidAt` (recordStripeInvoice la toma de
 * `invoice.status_transitions.paid_at`). Un registro sin pagar no tiene `paidAt`
 * y ahí `createdAt` SÍ es lo correcto: es el alta del cobro pendiente.
 *
 * Módulo puro (sin prisma ni server-only): lo usan tanto las pages server como
 * el client component, que recibe las fechas ya serializadas a string.
 */

export interface PaymentDateFields {
  paidAt?: Date | string | null;
  createdAt: Date | string;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** La fecha que se PINTA y por la que se ORDENA: paidAt, o el alta si no hay. */
export function paymentDate(inv: PaymentDateFields): Date | string {
  return inv.paidAt ?? inv.createdAt;
}

/** Milisegundos de `paymentDate`. 0 si ninguna fecha es válida (fila corrupta). */
export function paymentDateMs(inv: PaymentDateFields): number {
  return toMs(inv.paidAt) ?? toMs(inv.createdAt) ?? 0;
}

/**
 * Comparador para ordenar de más reciente a más antiguo por la MISMA expresión
 * que se muestra. Prisma no sabe ordenar por un COALESCE de dos columnas y
 * `orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }]` tampoco sirve: en
 * Postgres los NULL van PRIMERO en DESC (los pendientes encabezarían la lista) y
 * forzarlos al final los hunde a todos, dejando la columna Fecha visualmente
 * desordenada. Por eso el orden final se decide aquí.
 */
export function comparePaymentDateDesc(a: PaymentDateFields, b: PaymentDateFields): number {
  return paymentDateMs(b) - paymentDateMs(a);
}

/**
 * Margen a partir del cual se considera que la fila entró por una importación y
 * no por el cobro del momento. Un pago por Stripe lo registra el webhook el
 * mismo día; 48 h de diferencia ya sólo pasa en un backfill (o en un pago
 * pendiente verificado mucho después).
 */
export const IMPORT_GAP_MS = 48 * 60 * 60 * 1000;

/**
 * Fecha de alta de la fila cuando el cobro es MUY anterior — el matiz que
 * explica por qué un pago viejo aparece en un registro nuevo. null cuando las
 * dos fechas son prácticamente la misma (el caso normal) o no hay `paidAt`.
 */
export function importedLaterAt(inv: PaymentDateFields): Date | null {
  const paid = toMs(inv.paidAt);
  const created = toMs(inv.createdAt);
  if (paid === null || created === null) return null;
  return created - paid > IMPORT_GAP_MS ? new Date(created) : null;
}
