// ═══════════════════════════════════════════════════════════════════
// BAJAS DEL TOTAL que NO son descuento comercial (segunda auditoría de uso,
// C-17 a medias, 4-oct-2026). Puro, client-safe.
//
// Desde C-02/C-03 una factura puede bajar su total por un reembolso «le cobré
// de más» o por «dar de baja el resto» de un tratamiento que no siguió. Para
// que el CFDI siga cuadrando por conceptos, esa baja se escribe en
// `Invoice.discount` (lib/invoices/reajustar-total.ts) y deja una marca en las
// notas: «[BAJA DEL TOTAL: $X …]» o «[RESTO DADO DE BAJA: $X …]». Aquí se lee
// esa marca para separar lo que de verdad fue DESCUENTO (lo que vigila el tope
// del 20 %) de lo que fue una baja: Caja › «Descuentos» decía $2,525 cuando
// solo $300 eran descuento.
// ═══════════════════════════════════════════════════════════════════

const RE_BAJA = /\[(?:BAJA DEL TOTAL|RESTO DADO DE BAJA):\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/g;

/** Suma de las bajas marcadas en las notas de la factura (en pesos). */
export function bajasDeLaFactura(notas: string | null | undefined): number {
  if (typeof notas !== "string" || !notas) return 0;
  let c = 0;
  for (const m of notas.matchAll(RE_BAJA)) c += Math.round(Number(m[1].replace(/,/g, "")) * 100) || 0;
  return c / 100;
}

/**
 * El descuento de una factura partido en lo COMERCIAL y lo que fue una baja.
 * Nunca negativo, y la baja nunca pasa del descuento guardado.
 */
export function partirDescuento(inv: { discount?: number | null; notes?: string | null } | null | undefined): { comercial: number; bajas: number } {
  const total = Math.max(0, Math.round((Number(inv?.discount) || 0) * 100));
  const bajas = Math.min(total, Math.round(bajasDeLaFactura(inv?.notes) * 100));
  return { comercial: (total - bajas) / 100, bajas: bajas / 100 };
}

/** La línea que se agrega a las notas cuando un reembolso baja el total. */
export function lineaDeBaja(monto: number, motivo: string): string {
  const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(monto);
  return `[BAJA DEL TOTAL: ${pesos} · ${motivo}]`;
}
