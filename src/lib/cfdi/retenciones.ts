// Retenciones de ISR e IVA en el CFDI (ws1-t4, vuelta 2: F-01). CONFIRMAR CON CONTADOR.
//
// Cuando una PERSONA MORAL le paga a una persona física por servicios
// profesionales, la empresa retiene y el CFDI lo tiene que decir:
//   · ISR, emisor RESICO persona FÍSICA (626, RFC de 13): 1.25% sobre el valor
//     sin IVA — art. 113-J LISR. El RESICO de personas MORALES (626, RFC de 12;
//     arts. 206-215 LISR) no lleva retención de ISR ni de IVA (auditoría de uso
//     C-41): su CFDI sale sin retenciones y sin candado.
//   · ISR, emisor actividad profesional (612): 10% — art. 106, último párrafo, LISR.
//   · IVA retenido: 2/3 del IVA trasladado (10.6667% del valor) SOLO si el
//     servicio está gravado — art. 1-A, fr. II, inciso a) LIVA y art. 3, fr. I,
//     RLIVA. Un servicio dental exento no lleva IVA y no hay nada que retener.
// A personas físicas y a público en general no se les retiene.
//
// Va detrás de un ajuste por clínica APAGADO por defecto («Facturar a empresas
// con retención»). Apagado, sigue el candado de la Tanda 0 (no se timbra a una
// empresa desde 612/626).
//
// Las cuentas siguen a Facturapi: se manda el precio SIN IVA (tax_included
// false) con sus traslados y retenciones, y cada impuesto se redondea por
// concepto. PURO.

import { retencionDelEmisor, tipoDePersona } from "@/lib/invoices/cfdi-reglas";

export const TASA_ISR_RESICO = 0.0125;
export const TASA_ISR_612 = 0.10;
/** 2/3 de 16% = 10.6667% (Facturapi admite 6 decimales en la tasa). */
export const TASA_IVA_RETENIDO = 0.106667;

export interface TasasRetencion {
  isr: number;
  /** Solo para conceptos gravados con 16%. */
  ivaRetenido: number;
}

/**
 * ¿Este timbrado lleva retenciones? null = no (receptor persona física o genérico, emisor sin
 * retención, o emisor del que no se sabe si es persona física: ahí manda el candado).
 */
export function tasasDeRetencion(args: { regimenEmisor: string | null | undefined; rfcEmisor?: unknown; rfcReceptor: unknown }): TasasRetencion | null {
  if (tipoDePersona(args.rfcReceptor) !== "moral") return null;
  // C-41: solo a un emisor persona física (612, o 626 con RFC de 13).
  if (retencionDelEmisor(args) !== "si") return null;
  const r = typeof args.regimenEmisor === "string" ? args.regimenEmisor.trim() : "";
  if (r === "626") return { isr: TASA_ISR_RESICO, ivaRetenido: TASA_IVA_RETENIDO };
  if (r === "612") return { isr: TASA_ISR_612, ivaRetenido: TASA_IVA_RETENIDO };
  return null;
}

function r2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export interface ConceptoParaRetencion {
  /** Lo que dice la factura interna: precio unitario, cantidad y descuento del renglón (con el IVA dentro si `ivaIncluido`). */
  precio: number;
  cantidad: number;
  descuento: number;
  ivaModo: "exento" | "iva16";
  /** ¿El precio de la factura interna trae el IVA dentro? */
  ivaIncluido: boolean;
}

/** El concepto como va a Facturapi: precio y descuento SIN IVA, con traslado y retenciones. */
export function conceptoConRetenciones(c: ConceptoParaRetencion, tasas: TasasRetencion): {
  price: number;
  discount: number;
  taxes: { type: string; rate: number; factor?: string; withholding?: boolean }[];
} {
  const divisor = c.ivaModo === "iva16" && c.ivaIncluido ? 1.16 : 1;
  const price = Math.round((c.precio / divisor) * 1e6) / 1e6;
  const discount = Math.round((c.descuento / divisor) * 1e6) / 1e6;
  const taxes = c.ivaModo === "exento"
    ? [{ type: "IVA", factor: "Exento", rate: 0 }, { type: "ISR", rate: tasas.isr, withholding: true }]
    : [{ type: "IVA", rate: 0.16 }, { type: "ISR", rate: tasas.isr, withholding: true }, { type: "IVA", rate: tasas.ivaRetenido, withholding: true }];
  return { price, discount, taxes };
}

export interface TotalesConRetencion {
  /** Valor sin IVA, ya con descuentos. */
  base: number;
  iva: number;
  isrRetenido: number;
  ivaRetenido: number;
  /** Lo que debe pagar la empresa: base + IVA − retenciones. */
  neto: number;
  /** Lo que dice la factura interna (base + IVA). */
  bruto: number;
}

/** Totales del CFDI con retenciones, redondeando cada impuesto por concepto. */
export function totalesConRetenciones(conceptos: readonly ConceptoParaRetencion[], tasas: TasasRetencion): TotalesConRetencion {
  let base = 0, iva = 0, isr = 0, ivaRet = 0;
  for (const c of conceptos) {
    const k = conceptoConRetenciones(c, tasas);
    const b = r2(k.price * c.cantidad - k.discount);
    base += b;
    if (c.ivaModo === "iva16") {
      iva += r2(b * 0.16);
      ivaRet += r2(b * tasas.ivaRetenido);
    }
    isr += r2(b * tasas.isr);
  }
  base = r2(base); iva = r2(iva); isr = r2(isr); ivaRet = r2(ivaRet);
  return { base, iva, isrRetenido: isr, ivaRetenido: ivaRet, bruto: r2(base + iva), neto: r2(base + iva - isr - ivaRet) };
}

function en(locale?: string | null): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en");
}

export const CFDI_RETENCION_POR_PAGO = "CFDI_RETENCION_POR_PAGO";

export function errorRetencionPorPago(locale?: string | null): string {
  return en(locale)
    ? "A single-payment CFDI with ISR withholding isn't available yet: stamp the whole invoice once the company has paid it."
    : "El CFDI de un pago suelto con retención de ISR todavía no existe: timbra la factura completa cuando la empresa la haya pagado.";
}

/** Lo que se le dice a quien timbra: cuánto retiene la empresa y qué queda en la factura interna. */
export function avisoDeRetencion(t: TotalesConRetencion, locale?: string | null): string {
  const f = (x: number) => `$${x.toLocaleString(en(locale) ? "en-US" : "es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const ret = r2(t.isrRetenido + t.ivaRetenido);
  return en(locale)
    ? `The company withholds ${f(ret)} (ISR ${f(t.isrRetenido)}${t.ivaRetenido > 0 ? `, VAT ${f(t.ivaRetenido)}` : ""}) and pays ${f(t.neto)}.`
    : `La empresa retiene ${f(ret)} (ISR ${f(t.isrRetenido)}${t.ivaRetenido > 0 ? `, IVA ${f(t.ivaRetenido)}` : ""}) y paga ${f(t.neto)}.`;
}
