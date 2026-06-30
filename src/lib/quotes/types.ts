// Contrato compartido del módulo Presupuestos / Cotizaciones (WS1-T1).
// Lo consumen API, UI del panel, página pública y PDF. Money SIEMPRE en number
// (ya serializado desde Decimal) para que el client component lo pinte directo.

export type QuoteStatus =
  | "DRAFT"
  | "PRESENTED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

export const QUOTE_STATUSES: QuoteStatus[] = [
  "DRAFT",
  "PRESENTED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
];

/** Ítem tal cual lo manda el editor del panel (precios en number). */
export interface QuoteItemInput {
  procedureId?: string | null;
  name: string;
  toothFdi?: string | null;
  quantity: number;
  unitPrice: number;
  discount?: number | null;
  phase?: number | null;
  notes?: string | null;
}

/** Ítem serializado que devuelve la API. */
export interface QuoteItemDTO {
  id: string;
  procedureId: string | null;
  name: string;
  toothFdi: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  phase: number | null;
  notes: string | null;
  sortOrder: number;
}

/** Presupuesto serializado que devuelve la API del panel. */
export interface QuoteDTO {
  id: string;
  clinicId: string;
  patientId: string;
  folio: string;
  title: string;
  status: QuoteStatus;
  validUntil: string | null;
  subtotal: number;
  discountPct: number | null;
  discountAmount: number;
  total: number;
  notes: string | null;
  /** Presencia del token = ya presentado; la liga pública es /presupuesto/<acceptToken>. */
  acceptToken: string | null;
  presentedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  /** true si ya hay firma guardada (nunca exponemos el path crudo a la UI). */
  signed: boolean;
  invoiceId: string | null;
  treatmentPlanId: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  patientName: string | null;
  items: QuoteItemDTO[];
}

/** Ítem de factura tal como se guarda en el JSON `Invoice.items`. */
export interface BillingInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/** Pago serializado (money en number, fecha en ISO). */
export interface BillingPaymentLite {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  paidAt: string;
}

/**
 * Factura serializada mínima que consume la tabla de "Facturación" del
 * expediente y el modal de cobro. Money SIEMPRE en number; createdAt en ISO.
 * Es la shape que devuelve createInvoiceFromQuote y que el cliente inserta en
 * el state `invoices` sin recargar.
 */
export interface BillingInvoiceLite {
  id: string;
  invoiceNumber: string;
  patientId: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  notes: string | null;
  items: BillingInvoiceItem[];
  payments: BillingPaymentLite[];
  createdAt: string;
}

/**
 * Vista pública (solo lectura) que ve el paciente en /presupuesto/[token].
 * NO incluye datos sensibles extra (clinicId, patientId, ids internos, notas
 * internas del staff fuera de las líneas, etc.).
 */
export interface PublicQuoteView {
  folio: string;
  title: string;
  status: QuoteStatus;
  validUntil: string | null;
  expired: boolean;
  subtotal: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  acceptedAt: string | null;
  clinicName: string;
  clinicLogoUrl: string | null;
  patientFirstName: string;
  /** signed URL de corta vida para que el paciente vea su firma ya estampada. */
  signatureUrl: string | null;
  items: Array<{
    name: string;
    toothFdi: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    lineTotal: number;
    phase: number | null;
    notes: string | null;
  }>;
}
