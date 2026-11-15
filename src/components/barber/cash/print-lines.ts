/**
 * Líneas del ticket IMPRESO. Módulo puro (client-safe).
 *
 * QA B (15-nov): con descuento, el ticket salía con «Descuento -$18.00» entre
 * los conceptos Y otra vez en los totales («Descuento −$18.00»): parecían
 * dos descuentos. Cuando el ticket pinta el resumen del descuento (bruto,
 * descuento, subtotal), las líneas negativas que ya suma ese resumen no se
 * repiten en los conceptos: solo la línea «Descuento» del ticket (la que
 * escribe createSale, DISCOUNT_DESCRIPTION en cash.ts). Un bono con nombre se
 * queda (dice QUÉ bono fue) y las del anticipo también: no son descuento.
 */
/** Igual que DISCOUNT_DESCRIPTION de cash.ts (servidor). */
export const TICKET_DISCOUNT_LINE = "Descuento";

export function ticketPrintLines<T extends { unitPrice: number; description: string }>(
  items: T[],
  discountShownInTotals: boolean,
): T[] {
  if (!discountShownInTotals) return items;
  return items.filter((it) => !(it.unitPrice < 0 && it.description.trim() === TICKET_DISCOUNT_LINE));
}
