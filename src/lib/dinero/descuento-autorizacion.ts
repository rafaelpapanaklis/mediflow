// ═══════════════════════════════════════════════════════════════════
// DESCUENTOS: por encima de un % de la clínica, solo el dueño (ws1-t5,
// punto 7; auditoría del dinero, decisión 5). Sin I/O.
//
// Hoy quien tiene `billing.edit` (recepción y doctor por defecto) puede dejar
// una factura en $0 con un descuento del 100 % sin que nadie lo autorice. La
// regla: el descuento TOTAL de la factura (el de cada concepto + el global)
// sobre su importe bruto (Σ cantidad × precio) no pasa del % que fije la
// clínica, salvo que lo aplique el dueño (rol SUPER_ADMIN). Por defecto 20 %
// (decisión de Rafael, anotada en el reporte de ws1-t5).
// ═══════════════════════════════════════════════════════════════════

import { itemDiscount, itemQuantity, itemUnitPrice, round2 } from "@/lib/invoice-totals";

/** % máximo de descuento sin autorización del dueño, si la clínica no fijó otro. */
export const DESCUENTO_MAX_PCT_POR_DEFECTO = 20;

/** Quién puede pasar del tope: el dueño de la clínica. */
export function puedeAutorizarDescuentos(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

/** % del importe bruto que se va en descuentos (conceptos + global). 0 si no hay importe. */
export function porcentajeDeDescuento(items: unknown, descuentoGlobal: number): number {
  const lista = Array.isArray(items) ? items : [];
  let bruto = 0;
  let porConcepto = 0;
  for (const it of lista) {
    bruto += round2(itemQuantity(it) * itemUnitPrice(it));
    // ws1-t5 (F10): lo ya abonado del presupuesto (anticipo aplicado) no es
    // un descuento comercial: no cuenta para el tope.
    const anticipo = Number((it as { anticipoAplicado?: unknown })?.anticipoAplicado);
    porConcepto += Math.max(0, itemDiscount(it) - (Number.isFinite(anticipo) && anticipo > 0 ? anticipo : 0));
  }
  if (!(bruto > 0)) return 0;
  const total = round2(porConcepto + Math.max(0, Number(descuentoGlobal) || 0));
  return round2((total / bruto) * 100);
}

export interface RevisionDescuento {
  /** null = se permite. */
  error: null | { code: "DESCUENTO_REQUIERE_DUENO"; pct: number; limite: number };
}

/**
 * ¿Se permite este descuento? `antes` es el % que la factura ya tenía (al
 * editar): bajar o dejar igual un descuento que ya estaba nunca se bloquea,
 * solo SUBIRLO por encima del tope.
 */
export function revisarDescuento(args: {
  pct: number;
  limite: number;
  role: string | null | undefined;
  antes?: number | null;
}): RevisionDescuento {
  const limite = Number.isFinite(args.limite) ? Math.min(100, Math.max(0, args.limite)) : DESCUENTO_MAX_PCT_POR_DEFECTO;
  const pct = round2(args.pct);
  if (pct <= limite + 0.005) return { error: null };
  if (args.antes != null && pct <= round2(args.antes) + 0.005) return { error: null };
  if (puedeAutorizarDescuentos(args.role)) return { error: null };
  return { error: { code: "DESCUENTO_REQUIERE_DUENO", pct, limite } };
}

/** Mensaje del 403 (es; la pantalla lo muestra tal cual). */
export function mensajeDescuentoRequiereDueno(pct: number, limite: number): string {
  return `Un descuento del ${pct}% pasa del ${limite}% que la clínica permite sin autorización. Solo el dueño de la clínica puede aplicarlo.`;
}
