/**
 * ¿Los renglones de la factura suman su total? (client-safe, sin I/O)
 *
 * El CFDI se timbra por los RENGLONES (cantidad × precio de cada uno) y el dinero
 * que cuenta el panel —Caja, Finanzas, «quién me debe»— sale de `invoices.total`.
 * Si los dos números no son el mismo, el SAT declara una cifra y la clínica cobra
 * otra. Caso real: F-000155, un renglón de $3,052 con total $100 → se timbró por
 * $3,052 una factura pagada de $100.
 *
 * La comparación se hace sobre la MISMA base que se timbra, no `Σrenglones ≈
 * total` a secas:
 *   · el descuento de factura ya va restado (prorrateado por concepto, igual
 *     que en el payload) — una factura con descuento cuadra;
 *   · exento e IVA incluido → el total es la base; IVA agregado → base + IVA
 *     redondeado por concepto, que es como lo timbra Facturapi.
 *
 * Tolerancia: 1¢, más 1¢ por renglón cuando el IVA va agregado (ahí el total
 * guardado pudo calcularse sobre la base agregada y el timbrado va por concepto).
 * Aquí NO se corrige nada: decidir cuál de los dos números es el bueno es tocar
 * dinero, y eso lo hace una persona.
 */
import { expectedCfdiTotal, round2, type CfdiTaxMode } from "@/lib/invoice-totals";

export const CFDI_TOTAL_MISMATCH = "CFDI_TOTAL_MISMATCH";

export interface CfdiCuadre {
  ok: boolean;
  /** Lo que dice `invoices.total` — lo que el panel cuenta como cobrado. */
  invoiceTotal: number;
  /** Lo que se timbraría con los renglones, el descuento y el IVA actuales. */
  cfdiTotal: number;
  diff: number;
  tolerance: number;
}

export function cfdiCuadre(inv: {
  items: any[];
  discount: number | null | undefined;
  total: number;
  taxMode: CfdiTaxMode;
  taxIncluded: boolean;
}): CfdiCuadre {
  const items = Array.isArray(inv.items) ? inv.items : [];
  const discount = round2(Math.max(0, Number(inv.discount) || 0));
  const cfdiTotal = expectedCfdiTotal(items, discount, inv.taxMode, inv.taxIncluded);
  const tolerance = inv.taxMode === "iva16" && !inv.taxIncluded
    ? 0.01 + 0.01 * items.length
    : 0.01;
  // Un total ilegible (NaN, null) no cuadra con nada. Se mira aparte: `round2`
  // convierte NaN en 0 y `NaN > tolerancia` es false, así que se colaría como bueno.
  const legible = typeof inv.total === "number" && isFinite(inv.total);
  const invoiceTotal = legible ? inv.total : NaN;
  // round2 en la diferencia: sin él, una diferencia legítima de exactamente 1¢
  // excede la tolerancia por ruido de punto flotante (31.00 − 30.99 =
  // 0.010000000000001563 > 0.01) y bloquearía un caso que debe pasar.
  const diff = round2(Math.abs(cfdiTotal - invoiceTotal));
  return { ok: legible && diff <= tolerance, invoiceTotal, cfdiTotal, diff, tolerance };
}
