/**
 * DÓNDE VA «SIN CITAS» EN UNA COLUMNA (ws1-t6, QA del push).
 *
 * El rótulo va centrado en el lienzo, que en un día de 9 a 18 cae hacia las
 * 14:00 — justo donde suele estar la hora de comida. Con la agenda flexible,
 * la franja gris «Comida» y «Sin citas» salían una encima de la otra y no se
 * leía ninguna (lunes 26, columna de «Dental S.»).
 *
 * Regla: si ninguna franja (comida o bloqueo) toca el centro, el rótulo se
 * queda donde siempre. Si alguna lo toca, baja o sube al centro del hueco
 * libre MÁS GRANDE del horario abierto. Si no queda hueco donde quepa, no se
 * pinta: la columna ya dice lo suyo con la franja.
 *
 * Todo en minutos de pared de la clínica, como el resto de la rejilla.
 */

export interface TramoMin {
  desdeMin: number;
  hastaMin: number;
}

/** Media altura del rótulo, en minutos de rejilla (12 px ≈ 6 min a 112 px/h). */
export const MARGEN_ROTULO_MIN = 10;

/**
 * `"centro"` = donde siempre; un número = el minuto en que va su centro;
 * `null` = no cabe en ningún hueco libre y no se pinta.
 */
export function minutoDelRotuloVacio(
  abierto: TramoMin,
  franjas: readonly TramoMin[],
  centroMin: number,
  margenMin: number = MARGEN_ROTULO_MIN,
): number | "centro" | null {
  const tapan = franjas.filter((f) => f.hastaMin > f.desdeMin);
  const pisaCentro = tapan.some(
    (f) => f.desdeMin < centroMin + margenMin && f.hastaMin > centroMin - margenMin,
  );
  if (!pisaCentro) return "centro";

  // Huecos libres = el horario abierto menos las franjas.
  const ordenadas = [...tapan].sort((a, b) => a.desdeMin - b.desdeMin);
  let cursor = abierto.desdeMin;
  let mejor: TramoMin | null = null;
  const proponer = (desde: number, hasta: number) => {
    if (hasta - desde <= 0) return;
    if (!mejor || hasta - desde > mejor.hastaMin - mejor.desdeMin) mejor = { desdeMin: desde, hastaMin: hasta };
  };
  for (const f of ordenadas) {
    proponer(cursor, Math.min(f.desdeMin, abierto.hastaMin));
    cursor = Math.max(cursor, f.hastaMin);
  }
  proponer(cursor, abierto.hastaMin);

  const elegido = mejor as TramoMin | null;
  if (!elegido || elegido.hastaMin - elegido.desdeMin < margenMin * 2) return null;
  return (elegido.desdeMin + elegido.hastaMin) / 2;
}
