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
 * Tasa de IVA que el CFDI sabe desglosar (Facturapi recibe rate 0.16 fijo).
 *
 * El sufijo `_PCT` es deliberado: se expresa en PUNTOS PORCENTUALES (16), igual
 * que `Invoice.taxRate`, no como fracción (0.16). Antes convivía con un
 * `IVA_RATE = 0.16` en `src/lib/caja.ts` — dos constantes homónimas con un
 * factor 100 de diferencia, cada una correcta en su archivo y catastrófica en el
 * otro. Ésta es la ÚNICA fuente; la de caja.ts se eliminó.
 */
export const IVA_RATE_PCT = 16;

/**
 * Impuestos con los que NACE una factura nueva, según la preferencia fiscal de
 * la clínica (Clinic.cfdiTaxMode: "exempt" | "iva16"). Es la contraparte de
 * resolveTaxMode: lo que aquí se guarda en la factura es lo que allá se lee al
 * timbrar, así el desglose interno y el CFDI no pueden contradecirse.
 *
 *   "exempt" (default, odontología/servicios médicos) → 0%, sin desglose.
 *   "iva16"                                           → 16% ya incluido en el precio.
 *
 * El usuario lo puede cambiar factura por factura (venta de producto gravado en
 * una clínica exenta, por ejemplo).
 */
export function clinicInvoiceTaxDefaults(clinicTaxMode?: string | null): { taxRate: number; taxIncluded: boolean } {
  return clinicTaxMode === "iva16"
    ? { taxRate: IVA_RATE_PCT, taxIncluded: true }
    : { taxRate: 0, taxIncluded: true };
}

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
 * Igual que defaultTaxMode, pero tomando en cuenta la preferencia de la clínica
 * (Clinic.cfdiTaxMode: "exempt" = servicios exentos | "iva16" = IVA 16%). Con eso
 * una clínica que SÍ causa IVA no tiene que corregir el selector factura por
 * factura, y la odontología —que es el caso común— sigue saliendo exenta.
 *
 * La FACTURA manda sobre la preferencia: si internamente ya se le agregó IVA al
 * paciente, timbrar exento no cuadraría nunca (la guarda de integridad total ↔
 * conceptos lo bloquea), así que ahí se respeta "iva16" sin importar la clínica.
 * El selector del modal sigue pudiendo sobreescribir esto por factura.
 */
export function resolveTaxMode(
  inv: { taxIncluded?: boolean | null; taxRate?: number | null },
  clinicTaxMode?: string | null,
): CfdiTaxMode {
  if (defaultTaxMode(inv) === "iva16") return "iva16";
  // La factura NO trae IVA incluido en el precio y tampoco se le agregó ninguno:
  // timbrar iva16 aquí lo agregaría sobre la base (base × 1.16) y el total ya no
  // cuadraría con lo cobrado — la guarda de integridad daría un 409 que culpa a
  // los conceptos en vez de a este ajuste. Se respeta lo que pagó el paciente.
  if (inv?.taxIncluded === false) return "exento";
  // Tasa 0 = la factura se emitió SIN IVA a propósito (el editor guarda 0 cuando
  // se elige "Exento"). Es una señal explícita —la columna nace en 16—, así que
  // manda sobre la preferencia de la clínica: una clínica que causa IVA puede
  // facturar un servicio exento y el CFDI debe salir exento, no desglosado.
  // Se exige un 0 NUMÉRICO: Number(null) también es 0, y un DTO que normalice el
  // campo ausente a null volvería exentas facturas que nadie marcó como tales.
  if (typeof inv?.taxRate === "number" && inv.taxRate === 0) return "exento";
  // Queda (tasa >0, incluido), que es también la forma por DEFECTO de la columna:
  // no distingue "el usuario eligió IVA incluido" de "factura anterior a la
  // columna". Se resuelve con la preferencia de la clínica — comportamiento
  // histórico, para no volver gravadas de golpe las facturas viejas de una
  // clínica exenta. El total no cambia en ningún caso: con IVA incluido el CFDI
  // timbra el mismo importe, solo cambia si lo desglosa.
  return clinicTaxMode === "iva16" ? "iva16" : "exento";
}

/**
 * IVA realmente contenido en un importe COBRADO de una factura.
 *
 * Se usa para reportes de dinero cobrado (corte de Caja, Finanzas), donde lo que
 * se tiene es un `Payment.amount` — una fracción del total de la factura — y hay
 * que decir cuánto de eso es IVA. NO se asume ninguna tasa: sale del desglose
 * REAL de esa factura (`taxRate`/`taxIncluded`) resuelto con la preferencia
 * fiscal de la clínica, exactamente con el mismo criterio con el que se timbra
 * (`resolveTaxMode`). Una clínica exenta —el default— o una factura marcada sin
 * IVA devuelven 0, no un IVA fantasma.
 *
 * La fórmula es la misma en los dos modos porque en ambos el TOTAL ya contiene
 * el impuesto:
 *   - IVA incluido (taxIncluded=true):  total = base            → iva = total·r/(1+r)
 *   - IVA agregado (taxIncluded=false): total = base·(1+r)      → iva = total·r/(1+r)
 * Es proporcional al importe, así que un abono parcial aporta su parte de IVA.
 */
export function invoiceTaxPortion(
  amount: number,
  inv: { taxRate?: number | null; taxIncluded?: boolean | null } | null | undefined,
  clinicTaxMode?: string | null,
): number {
  const amt = Number(amount);
  if (!isFinite(amt) || amt === 0) return 0;
  if (!inv) return 0;
  if (resolveTaxMode(inv, clinicTaxMode) !== "iva16") return 0;
  // Tasa del desglose interno de ESTA factura. El input libre 0-100 que existió
  // antes pudo dejar tasas intermedias en facturas viejas y el corte debe
  // reflejar lo que se desglosó, no un 16% de oficio. Sin tasa propia (columna
  // nula) cae a la única que el sistema sabe emitir.
  const own = Number(inv.taxRate);
  const rate = isFinite(own) && own > 0 ? own : IVA_RATE_PCT;
  const r = rate / 100;
  return round2(amt * (r / (1 + r)));
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
  // SOBRE-asignación: la cuota de la última línea es la corrección `target −
  // assigned`, y cuando las cuotas proporcionales previas redondearon hacia
  // arriba sale NEGATIVA — el Math.max(0, …) de arriba la descartaba y el
  // prorrateo terminaba repartiendo hasta 6¢ MÁS que el descuento real. Como el
  // CFDI se timbra con estos descuentos por concepto y la guarda de integridad
  // compara contra `Σitems − descuento` (sin prorratear), el desajuste era
  // invisible: el comprobante salía por unos centavos MENOS de lo cobrado.
  for (let i = lines.length - 1; i >= 0 && residue < 0; i--) {
    const take = Math.min(out[i], -residue);
    if (take <= 0) continue;
    out[i] = round2(out[i] - take);
    residue = round2(residue + take);
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
