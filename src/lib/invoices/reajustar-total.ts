// Fijar el TOTAL final de una factura respetando sus conceptos: la misma regla
// que la rama {total} de POST /api/invoices/[id]/edit-price (bajar el precio =
// descuento explícito; subirlo = línea «Ajuste de precio»), para que el CFDI,
// que se emite por conceptos, siga cuadrando. Lo usa el reembolso que baja el
// total (auditoría de uso C-02/C-03, 4-oct-2026). Puro.

import { sumInvoiceItems, computeInvoiceTotal, round2, PRICE_ADJUST_FLAG } from "@/lib/invoice-totals";

export interface FacturaParaReajustar {
  items: unknown;
  subtotal?: number | null;
  total?: number | null;
  discount: number | null;
  taxRate: number | null;
  taxIncluded: boolean | null;
}

export function reajustarAlTotal(f: FacturaParaReajustar, totalNuevo: number): {
  items: any[];
  subtotal: number;
  discount: number;
  total: number;
} {
  const rawItems = Array.isArray(f.items) ? (f.items as any[]) : [];
  // Factura vieja sin conceptos: no hay contra qué cuadrar; la baja va como
  // descuento sobre el total guardado.
  if (rawItems.length === 0) {
    const antes = round2(Number(f.total ?? 0));
    const nuevo = round2(totalNuevo);
    return {
      items: rawItems,
      subtotal: round2(Number(f.subtotal ?? antes)),
      discount: round2(Math.max(0, Number(f.discount ?? 0) + antes - nuevo)),
      total: nuevo,
    };
  }
  // Las líneas de ajuste de ediciones anteriores se descartan y recalculan.
  const baseItems = rawItems.filter((it: any) => !it?.[PRICE_ADJUST_FLAG]);
  const itemsSum = sumInvoiceItems(baseItems);
  const taxIncluded = f.taxIncluded !== false;
  const taxRate = f.taxRate ?? 16;
  // Con IVA agregado, lo que se fija es el bruto: se deriva la base.
  const targetBase = taxIncluded ? round2(totalNuevo) : round2(totalNuevo / (1 + taxRate / 100));

  let items = baseItems;
  let subtotal = itemsSum;
  let discount: number;
  if (targetBase <= itemsSum) {
    discount = round2(itemsSum - targetBase);
  } else {
    const delta = round2(targetBase - itemsSum);
    items = [...baseItems, { description: "Ajuste de precio", quantity: 1, unitPrice: delta, total: delta, [PRICE_ADJUST_FLAG]: true }];
    discount = 0;
    subtotal = round2(itemsSum + delta);
  }
  const total = computeInvoiceTotal(items, discount, taxRate, taxIncluded).total;
  return { items, subtotal, discount, total };
}
