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

/**
 * Lo mismo para lo YA pagado (QA de cierre E). El «Ya pagado» de cada fila
 * llega con signo: positivo = se le pagó al barbero; negativo = el de renta de
 * silla le pagó al dueño. Sumados juntos, una renta cobrada de $300 tapaba
 * $300 de pagos a barberos («Ya pagado en el periodo: $51.50» con $351.50
 * entregados). SOLO PRESENTACIÓN: paidToBarbers − rentReceived = Σ «ya pagado».
 */
export function splitPaid(rows: ReadonlyArray<{ paidTotal: number }>): {
  paidToBarbers: number;
  rentReceived: number;
} {
  let paidToBarbers = 0;
  let rentReceived = 0;
  for (const r of rows) {
    if (r.paidTotal > 0) paidToBarbers += r.paidTotal;
    else if (r.paidTotal < 0) rentReceived -= r.paidTotal;
  }
  const redondea = (n: number) => Math.round(n * 100) / 100;
  return { paidToBarbers: redondea(paidToBarbers), rentReceived: redondea(rentReceived) };
}
