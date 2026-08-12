// Fuente ÚNICA del estado de factura para las superficies que lo pintan:
// ficha del paciente (billing-tab), Caja (billing-client) y el modal de
// detalle (invoice-detail-modal). Antes cada una mantenía su propio mapa a
// mano y una divergencia pintó una CANCELLED como "Pendiente" (MF-0151): el
// fallback `?? PENDING` solo es seguro si el mapa cubre los 6 valores del
// enum InvoiceStatus de schema.prisma — aquí el Record<InvoiceStatusValue,…>
// obliga a que un estado nuevo del enum se agregue también al mapa.

export type InvoiceStatusValue =
  | "DRAFT"
  | "PENDING"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

export type InvoiceStatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand"
  | "neutral";

export interface InvoiceStatusBadge {
  tone: InvoiceStatusTone;
  /** Clave i18n — resolver con t() al momento de pintar. */
  labelKey: string;
}

// Cancelada = neutro (cancelar es un estado normal del ciclo, NO un error →
// nada de rojo de peligro) y borrador = brand. Mismos tonos que ya usaban
// Caja (STATUS_BADGE) y el detalle (INV_STATUS).
export const INVOICE_STATUS_BADGES: Record<InvoiceStatusValue, InvoiceStatusBadge> = {
  PENDING:   { tone: "warning", labelKey: "billing.billingClient.statusPending"   },
  PARTIAL:   { tone: "info",    labelKey: "billing.billingClient.statusPartial"   },
  PAID:      { tone: "success", labelKey: "billing.billingClient.statusPaid"      },
  OVERDUE:   { tone: "danger",  labelKey: "billing.billingClient.statusOverdue"   },
  DRAFT:     { tone: "brand",   labelKey: "billing.billingClient.statusDraft"     },
  CANCELLED: { tone: "neutral", labelKey: "billing.billingClient.statusCancelled" },
};

/**
 * Badge del estado. El fallback a PENDING queda SOLO para valores fuera del
 * enum (dato corrupto), nunca para un estado real: los 6 están en el mapa.
 */
export function invoiceStatusBadge(status: string | null | undefined): InvoiceStatusBadge {
  return INVOICE_STATUS_BADGES[status as InvoiceStatusValue] ?? INVOICE_STATUS_BADGES.PENDING;
}

/**
 * Una factura CANCELLED está anulada: no es plan de tratamiento, no es dinero
 * cobrado y no es saldo por cobrar. El endpoint de cancelar NO pone balance a
 * 0 (solo cambia status), así que cualquier suma o columna de saldo que no la
 * excluya la cuenta como deuda. Ojo: reembolsada ≠ cancelada.
 */
export function isVoidedInvoice(inv: { status?: string | null }): boolean {
  return inv?.status === "CANCELLED";
}

/**
 * Estados sobre los que se ofrece la acción "Cobrar" (los DRAFT se confirman
 * primero — DRAFT → PENDING — y de inmediato se registra el pago).
 */
export const CHARGEABLE_INVOICE_STATUSES: readonly InvoiceStatusValue[] = [
  "DRAFT",
  "PENDING",
  "PARTIAL",
  "OVERDUE",
];

export function isChargeableInvoice(inv: { status?: string | null }): boolean {
  return CHARGEABLE_INVOICE_STATUSES.includes((inv?.status ?? "") as InvoiceStatusValue);
}
