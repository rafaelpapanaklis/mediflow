// H8 (revisión final): la tarjeta de cobro decía «Mensualidad vencida: $1,000 ·
// Venció el 15-ago» (la cuota más vieja) y su botón «Cobrar · $4,400» (TODO lo
// vencido). Un solo número en los dos sitios: la suma de lo vencido, y si son
// varias, cuántas. PURO.

export interface CuotaVencidaMinima {
  falta: number;
  vencimiento?: string | Date | null;
}

export interface LineaDeVencido {
  /** Suma de lo que falta de todas las cuotas vencidas. */
  total: number;
  cuantas: number;
  /** Vencimiento de la más antigua (ISO) o null. */
  masAntigua: string | null;
}

export function resumenDeVencidas(vencidas: readonly CuotaVencidaMinima[]): LineaDeVencido {
  const total = vencidas.reduce((acc, q) => acc + q.falta, 0);
  const fechas = vencidas
    .map((q) => (q.vencimiento ? new Date(q.vencimiento).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  return {
    total,
    cuantas: vencidas.length,
    masAntigua: fechas.length > 0 ? new Date(Math.min(...fechas)).toISOString() : null,
  };
}

/** «Mensualidad vencida: $1,000» o «3 mensualidades vencidas: $4,400». */
export function tituloDeVencido(r: LineaDeVencido, formato: (n: number) => string): string {
  return r.cuantas === 1
    ? `Mensualidad vencida: ${formato(r.total)}`
    : `${r.cuantas} mensualidades vencidas: ${formato(r.total)}`;
}
