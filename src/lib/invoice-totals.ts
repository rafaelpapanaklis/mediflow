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
 * Desglose que Facturapi va a timbrar con los conceptos actuales y el modo de
 * impuestos elegido. Espeja el payload real:
 *  - exento           → precios tal cual, sin impuesto → base.
 *  - iva16 + incluido → tax_included:true, el bruto no cambia → base.
 *  - iva16 + agregado → tax_included:false → el IVA se calcula POR CONCEPTO.
 *
 * Ese "por concepto" es la clave. El CFDI manda `taxes` DENTRO de cada línea y
 * el impuesto se redondea línea por línea — es lo que exige el SAT: Importe e
 * Impuesto de cada concepto a 2 decimales, y el total es su suma. Calcularlo
 * sobre la base agregada, `round2(base × 1.16)`, da un número DISTINTO al que de
 * verdad se timbra en cuanto hay varios conceptos (hasta 2¢ con 8 líneas), y la
 * guarda de integridad no podía verlo porque comparaba agregado contra agregado.
 *
 * La base por línea se arma con `spreadInvoiceDiscount`, que es EXACTAMENTE el
 * descuento por concepto que viaja en el payload: así la línea de aquí y la de
 * allá son la misma línea. Sin piso en 0 a nivel factura, a propósito: si el
 * descuento global excede la capacidad de las líneas, Facturapi timbraría el
 * remanente y la guarda debe verlo, no taparlo con un 0.
 */
export function cfdiTotalBreakdown(
  items: any[],
  discount: number,
  taxMode: CfdiTaxMode,
  taxIncluded: boolean,
): { bases: number[]; base: number; tax: number; total: number } {
  const list = Array.isArray(items) ? items : [];
  const extra = spreadInvoiceDiscount(list, discount);
  const bases = list.map((it, i) =>
    round2(round2(itemQuantity(it) * itemUnitPrice(it)) - round2(itemDiscount(it) + (extra[i] ?? 0))),
  );
  const base = round2(bases.reduce((a, b) => a + b, 0));
  if (taxMode !== "iva16" || taxIncluded) return { bases, base, tax: 0, total: base };
  const tax = round2(bases.reduce((s, b) => s + round2(b * (IVA_RATE_PCT / 100)), 0));
  return { bases, base, tax, total: round2(base + tax) };
}

/** Importe que Facturapi va a timbrar (ver cfdiTotalBreakdown). */
export function expectedCfdiTotal(
  items: any[],
  discount: number,
  taxMode: CfdiTaxMode,
  taxIncluded: boolean,
): number {
  return cfdiTotalBreakdown(items, discount, taxMode, taxIncluded).total;
}

/**
 * Qué tan lejos quedó el importe REALMENTE timbrado del total guardado.
 *
 *   "match"     → el CFDI salió por el importe de la factura.
 *   "rounding"  → difieren, pero dentro de la tolerancia de redondeo por línea.
 *   "material"  → difieren MÁS de lo que el redondeo puede explicar.
 *   "unknown"   → Facturapi no devolvió un total legible: no se puede afirmar
 *                 que cuadre, y eso también hay que poder verlo.
 *
 * Se contrasta DESPUÉS de timbrar contra `result.total` de Facturapi — el hecho,
 * no la predicción. La guarda previa compara `expectedCfdiTotal` (criterio por
 * concepto) contra `invoice.total` (criterio agregado) y tiene que ser permisiva
 * para no bloquear un timbrado válido; por eso su tolerancia absorbe justo la
 * divergencia entre ambos criterios (hasta 2¢ con 8 conceptos). Aquí esa misma
 * tolerancia NO decide si hay constancia, solo si el aviso es para un humano:
 * "rounding" es diferencia real y queda registrada igual. Reutilizarla como
 * único filtro dejaba el caso común —el de la divergencia de criterio— sin
 * rastro en ninguna parte, que es exactamente lo que había que terminar.
 */
export type CfdiStampedLevel = "match" | "rounding" | "material" | "unknown";

export function cfdiStampedCheck(
  stampedTotalRaw: unknown,
  invoiceTotal: number,
  tolerance: number,
): { level: CfdiStampedLevel; stampedTotal: number | null; diff: number | null } {
  const raw = Number(stampedTotalRaw);
  // > 0 y no un total "0" fantasma: un CFDI de ingreso timbrado nunca vale 0.
  if (!isFinite(raw) || raw <= 0) return { level: "unknown", stampedTotal: null, diff: null };
  const stampedTotal = round2(raw);
  const own = Number(invoiceTotal);
  const diff = round2(Math.abs(stampedTotal - round2(isFinite(own) ? own : 0)));
  // round2 en la diferencia: el ruido de punto flotante no es una divergencia.
  // A partir de 1¢ sí lo es, y a partir de 1¢ hay constancia.
  if (diff <= 0) return { level: "match", stampedTotal, diff: 0 };
  const tol = Number(tolerance);
  return { level: diff > (isFinite(tol) ? tol : 0) ? "material" : "rounding", stampedTotal, diff };
}

/**
 * Renglones de dinero que el COMPROBANTE IMPRESO tiene que enseñar para que sus
 * columnas cuadren con su TOTAL.
 *
 * Con "IVA agregado" las líneas del comprobante suman la base y el TOTAL trae el
 * impuesto encima: sin un renglón que lo diga, el documento no cuadra y no hay
 * nada que lo explique (conceptos $1,000, descuento $100 → TOTAL $1,044).
 *
 * El IVA se toma como la DIFERENCIA REAL `total − base`, no como un 16% teórico:
 * así los renglones impresos suman SIEMPRE el total guardado, incluso en
 * facturas viejas o con un `taxRate` intermedio. Con el IVA incluido en el
 * precio la diferencia es 0 y no se imprime renglón: ahí las líneas ya suman el
 * total y añadir un desglose cambiaría el documento sin necesidad.
 */
export function invoicePrintTotals(inv: {
  subtotal: number;
  discount: number;
  total: number;
  taxRate?: number | null;
  taxIncluded?: boolean | null;
}): { base: number; discount: number; tax: number; rate: number; total: number } {
  const discount = round2(Math.max(0, Number(inv.discount) || 0));
  const base = round2((Number(inv.subtotal) || 0) - discount);
  const total = round2(Number(inv.total) || 0);
  const own = Number(inv.taxRate);
  const rate = isFinite(own) && own > 0 ? own : 0;
  const added = inv.taxIncluded === false && rate > 0;
  const tax = added ? round2(total - base) : 0;
  return { base, discount, tax: tax > 0 ? tax : 0, rate, total };
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
