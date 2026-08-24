// Aritmética ÚNICA factura ← presupuesto y la regla de "¿la factura ligada se
// puede regenerar?" (client-safe, sin I/O; con tests). La usan
// createInvoiceFromQuote (alta) y syncDraftInvoiceFromQuote (re-sincronizar el
// borrador cuando se EDITA el presupuesto — FIN-05): un solo camino, así los dos
// dan exactamente el mismo total y la factura nunca se queda con el importe
// viejo mientras el paciente firma el nuevo.

import { sumInvoiceItems, computeInvoiceTotal, itemLineTotal, round2 } from "@/lib/invoice-totals";
import type { BillingInvoiceItem } from "./types";

/** Lo mínimo de un QuoteItem que hace falta para derivar el concepto de la factura. */
export interface QuoteItemForInvoice {
  name: string;
  toothFdi: string | null;
  quantity: unknown;
  unitPrice: unknown;
  discount?: unknown;
}

export interface QuoteForInvoice {
  discountAmount: unknown;
  items: QuoteItemForInvoice[];
}

/** Concepto tal como se guarda en Invoice.items (JSON). El descuento de línea solo si > 0. */
export interface InvoiceItemFromQuote extends BillingInvoiceItem {
  discount?: number;
}

export interface InvoiceFieldsFromQuote {
  items: InvoiceItemFromQuote[];
  subtotal: number;
  discount: number;
  total: number;
}

function num(x: unknown): number {
  const v = Number(x);
  return isFinite(v) ? v : 0;
}

/**
 * Conceptos + subtotal + descuento + total de la factura DERIVADOS del
 * presupuesto con la aritmética canónica de invoice-totals (la misma que
 * verifica la guarda del timbrado). No se copian las columnas del presupuesto:
 * lo que se timbra es Σ round2(qty × unitPrice − desc. de línea) − descuento.
 */
export function invoiceFieldsFromQuote(quote: QuoteForInvoice): InvoiceFieldsFromQuote {
  const items: InvoiceItemFromQuote[] = quote.items.map((it) => {
    // Misma regla que itemQuantity() del timbrado (finita >0, si no 1).
    const rawQty = num(it.quantity);
    const quantity = rawQty > 0 ? rawQty : 1;
    const unitPrice = num(it.unitPrice);
    // El descuento POR LÍNEA viaja con el concepto (la guarda del CFDI calcula
    // qty × unitPrice − discount), acotado al importe de línea (regla SAT).
    const discount = Math.min(round2(num(it.discount)), round2(unitPrice * quantity));
    return {
      description: it.toothFdi ? `${it.name} (${it.toothFdi})` : it.name,
      quantity,
      unitPrice,
      ...(discount > 0 ? { discount } : {}),
      // El importe de línea se DERIVA de los campos normalizados, no se copia
      // el lineTotal del presupuesto.
      total: itemLineTotal({ quantity, unitPrice, discount }),
    };
  });
  const subtotal = sumInvoiceItems(items);
  // Clamp al subtotal derivado: un descuento mayor dejaría base 0 y un total
  // que ya no es Σconceptos − descuento (regla SAT: descuento ≤ importe).
  const discount = round2(Math.min(Math.max(0, num(quote.discountAmount)), subtotal));
  const { total } = computeInvoiceTotal(subtotal, discount, 0, true);
  return { items, subtotal, discount, total };
}

// ── ¿La factura ligada admite regenerarse? ────────────────────────────

/** Por qué la factura ligada ya NO se puede regenerar desde el presupuesto. */
export interface LinkedInvoiceLock {
  invoiceNumber: string;
  status: string;
  reason: "not-draft" | "has-payments";
}

export interface LinkedInvoiceSnapshot {
  invoiceNumber: string;
  status: string;
  paid: number;
  paymentsCount: number;
}

/**
 * Solo un BORRADOR sin un solo pago se regenera. Confirmada (cualquier status
 * que no sea DRAFT) o con pagos → bloqueada: ahí el importe ya es un hecho
 * contable y se ajusta desde Facturación, no reescribiendo el presupuesto.
 */
export function decideLinkedInvoiceLock(inv: LinkedInvoiceSnapshot): LinkedInvoiceLock | null {
  if (inv.paymentsCount > 0 || num(inv.paid) > 0) {
    return { invoiceNumber: inv.invoiceNumber, status: inv.status, reason: "has-payments" };
  }
  if (inv.status !== "DRAFT") {
    return { invoiceNumber: inv.invoiceNumber, status: inv.status, reason: "not-draft" };
  }
  return null;
}

const INVOICE_STATUS_ES: Record<string, string> = {
  PENDING:   "pendiente de pago",
  PARTIAL:   "con abonos",
  PAID:      "pagada",
  OVERDUE:   "vencida",
  CANCELLED: "cancelada",
};

/** Mensaje del 409 para la recepcionista: qué factura, por qué y qué hacer. */
export function quoteInvoiceLockedMessage(lock: LinkedInvoiceLock): string {
  const salida = "Para cambiar los importes, ajusta la factura desde Facturación (editar precio o aplicar descuento) o duplica el presupuesto y trabaja sobre el nuevo.";
  if (lock.reason === "has-payments") {
    return `La factura ${lock.invoiceNumber} de este presupuesto ya tiene pagos registrados, así que el presupuesto ya no se puede editar. ${salida}`;
  }
  const estado = INVOICE_STATUS_ES[lock.status] ?? lock.status;
  return `La factura ${lock.invoiceNumber} de este presupuesto ya está confirmada (${estado}), así que el presupuesto ya no se puede editar. ${salida}`;
}
