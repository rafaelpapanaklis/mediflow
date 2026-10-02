// Contrato compartido del módulo Presupuestos / Cotizaciones (WS1-T1).
// Lo consumen API, UI del panel, página pública y PDF. Money SIEMPRE en number
// (ya serializado desde Decimal) para que el client component lo pinte directo.

import type { CondicionesPago } from "./condiciones-pago";
import type { CobroDePresupuesto } from "./aceptacion";

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
  /** "YYYY-MM-DD" de la vigencia en la zona de la clínica (solo GET /api/quotes). Ver lib/quotes/vigencia.ts. */
  validUntilDia?: string | null;
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
  /**
   * Formas de pago propuestas (tabla `quote_payment_terms`, WS1-T8).
   * `null` = el presupuesto no tiene condiciones guardadas, O el SQL
   * `sql/presupuesto-condiciones-pago.sql` todavía no está aplicado. Los dos
   * casos se pintan igual: sin sección de formas de pago, como antes.
   */
  condicionesPago: CondicionesPago | null;
  /**
   * `true` si NO se pudieron leer las condiciones (la base falló), que NO es lo
   * mismo que «no tiene». El editor lo usa para NO mandarlas de vuelta al
   * guardar: sin esto, abrir un presupuesto justo cuando la base tropieza y
   * corregirle una coma le borraría el plan de mensualidades ya firmado.
   */
  condicionesPagoIlegible?: boolean;
  /**
   * Presupuesto de ortodoncia ACEPTADO en una sede con el módulo (ws1-t5): en
   * vez de «Crear plan de tratamiento» ofrece abrir (o ver) el caso de
   * ortodoncia del paciente. Solo lo pone GET /api/quotes; ausente = el botón
   * de siempre. Ver `src/lib/quotes/ortodoncia.ts`.
   */
  casoOrtodoncia?: {
    accion: "abrir-caso" | "ver-caso" | "sin-permiso";
    etiqueta: string;
    /** `null` = quien mira no puede entrar al módulo: el botón explica quién abre el caso. */
    href: string | null;
    aviso?: string;
    /** Mixto: además ofrece «Crear plan general con el resto» (`?general=1`). */
    conPlanGeneral?: boolean;
  };
  /**
   * ws1-t6 · Aceptación por concepto y cargos. Solo los pone GET /api/quotes y
   * solo con `sql/presupuesto-aceptacion-parcial.sql` aplicado; ausentes = la
   * tarjeta de siempre («Marcar aceptado» todo, «Generar factura» por el total).
   */
  porConcepto?: boolean;
  /** Lo aceptado, lo cargado y lo que queda (solo presupuestos ACEPTADOS). */
  cobro?: CobroDePresupuesto;
  /** Qué puede hacer la sesión aquí: aceptar = billing.edit, cargar = billing.create. */
  permisos?: { aceptar: boolean; cargar: boolean };
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
  /** "YYYY-MM-DD" de la vigencia en la zona de la clínica: el mismo día que ve el panel. */
  validUntilDia: string | null;
  expired: boolean;
  subtotal: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  acceptedAt: string | null;
  /** Formas de pago propuestas, para que el paciente vea su plan. Ver QuoteDTO. */
  condicionesPago: CondicionesPago | null;
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
