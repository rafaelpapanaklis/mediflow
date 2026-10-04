// ═══════════════════════════════════════════════════════════════════════════
// El descuento de una factura en PESOS o en PORCENTAJE (pedido de Rafael,
// 4-oct-2026). Puro, client-safe.
//
// Se captura como se quiera ($ o %), pero se GUARDA siempre en pesos, como
// siempre (`invoices.discount`): con % se calcula sobre el subtotal. Redondeo a
// centavos y nunca más que el subtotal. Sin tope de porcentaje (decisión de
// Rafael: cualquier descuento).
// ═══════════════════════════════════════════════════════════════════════════

export type ModoDescuento = "pesos" | "porcentaje";

const centavos = (n: number) => Math.round(n * 100);

/** «1,250.50» / « 10 » → número; vacío → 0; basura o negativo → null. */
export function leerNumero(texto: string | number | null | undefined): number | null {
  const limpio = String(texto ?? "").replace(/[,\s$%]/g, "");
  if (limpio === "") return 0;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface DescuentoCalculado {
  /** Lo que se guarda, en pesos, a centavos. null = lo tecleado no es un número válido. */
  pesos: number | null;
  /** El porcentaje equivalente del subtotal (a dos decimales). */
  porcentaje: number | null;
  /** Se pidió más que el subtotal y se dejó en el subtotal. */
  recortado: boolean;
}

export function calcularDescuento(modo: ModoDescuento, valor: string | number | null | undefined, subtotal: number): DescuentoCalculado {
  const n = leerNumero(valor);
  const base = Math.max(0, centavos(Number(subtotal) || 0));
  if (n === null) return { pesos: null, porcentaje: null, recortado: false };
  const pedido = modo === "porcentaje" ? Math.round((base * n) / 100) : centavos(n);
  const recortado = pedido > base;
  const c = Math.min(pedido, base);
  return {
    pesos: c / 100,
    porcentaje: base > 0 ? Math.round((c / base) * 10_000) / 100 : 0,
    recortado,
  };
}

/** Lo tecleado al cambiar de modo, para que el descuento no cambie: $50 de $500 ↔ 10 %. */
export function convertirEntrada(de: ModoDescuento, a: ModoDescuento, valor: string, subtotal: number): string {
  if (de === a) return valor;
  const r = calcularDescuento(de, valor, subtotal);
  if (r.pesos === null) return valor;
  if (r.pesos === 0) return "";
  return a === "porcentaje" ? String(r.porcentaje) : r.pesos.toFixed(2);
}
