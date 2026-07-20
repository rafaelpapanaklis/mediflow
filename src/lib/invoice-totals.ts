/**
 * Aritmética compartida de la factura interna y su CFDI (client-safe, sin I/O).
 *
 * Invariante del sistema: `invoice.total` SIEMPRE debe poder derivarse de sus
 * conceptos: total = Σ(conceptos) − descuento (+IVA si taxIncluded=false).
 * Los endpoints que mutan precio/descuento usan estos helpers para mantenerla,
 * y el timbrado (`POST /api/cfdi`) la verifica ANTES de emitir: un CFDI jamás
 * debe salir por un monto distinto al de la factura interna (caso F-000155:
 * total editado $100 pero conceptos por $3,052 → se timbró $3,052).
 *
 * IMPORTANTE: `itemUnitPrice`/`itemQuantity` replican EXACTAMENTE los fallbacks
 * del mapeo de conceptos del timbrado. Si cambian aquí, cambian en ambos lados
 * a la vez — esa simetría es lo que hace válida la verificación.
 */

import { round2 } from "@/lib/quotes/compute";

export { round2 };

/**
 * Marca de la línea "Ajuste de precio" que agrega Editar precio cuando el
 * nuevo total SUPERA la suma de conceptos (el caso inverso — bajar el precio —
 * se representa como descuento de la factura, nunca borrando conceptos).
 */
export const PRICE_ADJUST_FLAG = "_priceAdjust";

/** Cantidad efectiva de una línea (mismo default que el mapeo del CFDI). */
export function itemQuantity(it: any): number {
  const q = Number(it?.quantity ?? 1);
  return isFinite(q) && q > 0 ? q : 1;
}

/** Precio unitario efectivo — mismos fallbacks que el mapeo del CFDI. */
export function itemUnitPrice(it: any): number {
  const v = it?.unitPrice ?? it?.price ?? it?.total ?? 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** Descuento propio de la línea (campo opcional del item JSON). */
export function itemDiscount(it: any): number {
  const n = Number(it?.discount ?? 0);
  return isFinite(n) && n > 0 ? round2(n) : 0;
}

/** Importe de la línea: cantidad × precio − descuento de línea. */
export function itemLineTotal(it: any): number {
  return round2(itemQuantity(it) * itemUnitPrice(it) - itemDiscount(it));
}

/** Suma de conceptos (con sus descuentos de línea). */
export function sumInvoiceItems(items: any[]): number {
  if (!Array.isArray(items)) return 0;
  return round2(items.reduce((s, it) => s + itemLineTotal(it), 0));
}

/**
 * Total interno canónico: base = Σconceptos − descuento; si el IVA va AGREGADO
 * (taxIncluded=false) se suma sobre la base; si va incluido, el total es la base.
 */
export function computeInvoiceTotal(
  itemsSum: number,
  discount: number,
  taxRate: number | null | undefined,
  taxIncluded: boolean,
): { base: number; tax: number; total: number } {
  const disc = round2(Math.max(0, Number(discount) || 0));
  const base = round2(Math.max(0, itemsSum - disc));
  const rate = isFinite(Number(taxRate)) && Number(taxRate) > 0 ? Number(taxRate) : 0;
  const tax = taxIncluded ? 0 : round2(base * (rate / 100));
  return { base, tax, total: round2(base + tax) };
}

export type CfdiTaxMode = "exento" | "iva16";

/**
 * Modo de impuestos con el que se pre-llena el timbrado. Los servicios
 * médicos/dentales son mayormente EXENTOS de IVA (art. 15 LIVA) → default
 * exento, salvo que la factura interna haya AGREGADO IVA sobre la base
 * (taxIncluded=false con tasa >0): ahí el paciente pagó IVA y timbrar exento
 * nunca cuadraría.
 */
export function defaultTaxMode(inv: { taxIncluded?: boolean | null; taxRate?: number | null }): CfdiTaxMode {
  if (inv?.taxIncluded === false && Number(inv?.taxRate) > 0) return "iva16";
  return "exento";
}

/**
 * Total que Facturapi va a timbrar con los conceptos actuales y el modo de
 * impuestos elegido. Espeja el payload real:
 *  - exento           → precios tal cual, sin impuesto → base.
 *  - iva16 + incluido → tax_included:true, el bruto no cambia → base.
 *  - iva16 + agregado → tax_included:false → base × 1.16 (el CFDI siempre
 *    desglosa 16%, sin importar el taxRate interno; si difieren, la guarda
 *    lo bloquea y se corrige la factura).
 */
export function expectedCfdiTotal(
  items: any[],
  discount: number,
  taxMode: CfdiTaxMode,
  taxIncluded: boolean,
): number {
  const { base } = computeInvoiceTotal(sumInvoiceItems(items), discount, 0, true);
  if (taxMode === "iva16" && !taxIncluded) return round2(base * 1.16);
  return base;
}

/**
 * Prorratea el descuento a nivel factura entre las líneas (adicional al
 * descuento propio de cada una), proporcional a su importe, con el residuo de
 * centavos en la última línea con capacidad. El SAT exige descuento ≤ importe
 * por concepto, por eso se reparte con clamp en vez de mandarse en una sola línea.
 * Devuelve un arreglo paralelo a `items` con el descuento extra por línea.
 */
export function spreadInvoiceDiscount(items: any[], discountTotal: number): number[] {
  const lines = items.map((it) => Math.max(0, itemLineTotal(it)));
  const target = round2(Math.max(0, Number(discountTotal) || 0));
  const sum = round2(lines.reduce((a, b) => a + b, 0));
  const out = lines.map(() => 0);
  if (target <= 0 || sum <= 0) return out;

  let assigned = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = i === lines.length - 1
      ? round2(target - assigned)
      : round2((target * lines[i]) / sum);
    out[i] = Math.min(lines[i], Math.max(0, raw));
    assigned = round2(assigned + out[i]);
  }
  // Residuo por clamps/redondeo → a cualquier línea con capacidad restante.
  let residue = round2(target - assigned);
  for (let i = 0; i < lines.length && residue > 0; i++) {
    const room = round2(lines[i] - out[i]);
    if (room <= 0) continue;
    const add = Math.min(room, residue);
    out[i] = round2(out[i] + add);
    residue = round2(residue - add);
  }
  return out;
}

/** Método de pago interno → forma de pago SAT (c_FormaPago). */
export const METHOD_TO_SAT_FORM: Record<string, string> = {
  cash: "01",     // Efectivo
  check: "02",    // Cheque nominativo
  transfer: "03", // Transferencia electrónica de fondos
  credit: "04",   // Tarjeta de crédito
  debit: "28",    // Tarjeta de débito
  online: "04",   // Pago en línea del portal (tarjeta vía Stripe)
};

/**
 * Forma de pago SAT derivada de los pagos REALES de la factura: el método del
 * último pago (excluyendo reembolsos) manda — también en pagos mixtos. Sin
 * pagos mapeables cae a `invoice.paymentMethod` y al final a "03".
 */
export function derivePaymentForm(
  payments: any[] | null | undefined,
  invoicePaymentMethod?: string | null,
): string {
  if (Array.isArray(payments) && payments.length > 0) {
    const sorted = [...payments].sort((a, b) => {
      const ta = a?.paidAt ? new Date(a.paidAt).getTime() : 0;
      const tb = b?.paidAt ? new Date(b.paidAt).getTime() : 0;
      return ta - tb;
    });
    for (let i = sorted.length - 1; i >= 0; i--) {
      const m = sorted[i]?.method;
      if (m === "refund") continue;
      if (m && METHOD_TO_SAT_FORM[m]) return METHOD_TO_SAT_FORM[m];
    }
  }
  if (invoicePaymentMethod && METHOD_TO_SAT_FORM[invoicePaymentMethod]) {
    return METHOD_TO_SAT_FORM[invoicePaymentMethod];
  }
  return "03";
}
