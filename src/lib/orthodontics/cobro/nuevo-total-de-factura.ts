// Ortodoncia — cambiar el COSTO de un caso que ya tiene factura (ws1-t12). Puro. El costo del plan de tratamiento
// y el total de la factura del tratamiento son el mismo dato: al cambiar el costo, la factura se edita con las
// MISMAS reglas que «editar factura con pagos» (`editar-factura-core.ts`): nunca por debajo de lo ya pagado, nunca
// timbrada ni cancelada, y con plan a plazos se AVISA que las mensualidades se recalculan.
//
// Aquí solo se arma cómo queda la factura para llegar a ese total, con el mismo criterio que «Editar precio»:
// subir el precio agrega una línea «Ajuste de precio»; bajarlo lo representa como descuento (nunca borra conceptos).

import { PRICE_ADJUST_FLAG, computeInvoiceTotal, round2, sumInvoiceItems } from "@/lib/invoice-totals";

export interface FacturaParaNuevoTotal {
  items: unknown;
  discount: number | null;
  taxRate: number | null;
  taxIncluded: boolean | null;
}

export interface PropuestaDeTotal {
  items: unknown[];
  discount: number;
  /** El total al que llega la factura (con IVA agregado, puede diferir 1-2 ¢ por el redondeo por concepto). */
  total: number;
  subtotal: number;
}

export function propuestaParaNuevoTotal(f: FacturaParaNuevoTotal, totalNuevo: number): PropuestaDeTotal {
  const crudos = Array.isArray(f.items) ? (f.items as Record<string, unknown>[]) : [];
  // Las líneas de ajuste de ediciones anteriores se descartan y se recalculan.
  const base = crudos.filter((it) => !it?.[PRICE_ADJUST_FLAG]);
  const suma = sumInvoiceItems(base);
  const taxIncluded = f.taxIncluded !== false;
  const taxRate = f.taxRate ?? 16;
  // Con IVA agregado, lo capturado es el bruto: se deriva la base antes de compararla con los conceptos.
  const objetivo = taxIncluded ? round2(totalNuevo) : round2(totalNuevo / (1 + taxRate / 100));
  let items: unknown[] = base;
  let discount = 0;
  let subtotal = suma;
  if (objetivo <= suma) {
    discount = round2(suma - objetivo);
  } else {
    const delta = round2(objetivo - suma);
    items = [...base, { description: "Ajuste de precio", quantity: 1, unitPrice: delta, total: delta, [PRICE_ADJUST_FLAG]: true }];
    subtotal = round2(suma + delta);
  }
  const { total } = computeInvoiceTotal(items, discount, taxRate, taxIncluded);
  return { items, discount, total, subtotal };
}
