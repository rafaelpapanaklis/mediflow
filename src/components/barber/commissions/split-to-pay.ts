/**
 * Las dos cifras de arriba de Comisiones. SOLO PRESENTACIÓN: parte el «A pagar»
 * por fila (que ya llega calculado por el servidor) en
 *   · lo que se le debe a los barberos (suma de las filas positivas) y
 *   · lo que los de renta de silla le deben al dueño (suma de las negativas,
 *     en positivo).
 * No recalcula nada: toPay − rentOwed = Σ «a pagar» de siempre.
 */
export function splitToPay(rows: ReadonlyArray<{ totalToPay: number }>): {
  toPayBarbers: number;
  rentOwed: number;
} {
  let toPayBarbers = 0;
  let rentOwed = 0;
  for (const r of rows) {
    if (r.totalToPay > 0) toPayBarbers += r.totalToPay;
    else if (r.totalToPay < 0) rentOwed -= r.totalToPay;
  }
  // Centavos: sumas de decimales sin arrastrar 0.30000000000000004.
  const redondea = (n: number) => Math.round(n * 100) / 100;
  return { toPayBarbers: redondea(toPayBarbers), rentOwed: redondea(rentOwed) };
}
