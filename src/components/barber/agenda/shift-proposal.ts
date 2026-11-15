// ═══════════════════════════════════════════════════════════════════════
// Qué turno propone «Agregar turno» en Horarios.
//
// Antes proponía «una hora después del último, cuatro horas»: con el turno
// de fábrica (10:00–20:00) el segundo salía 21:00–00:00, que ninguna
// barbería trabaja y que además cruza la medianoche.
//
// La pista de la pantalla dice para qué sirve el segundo turno: «¿Cierran a
// comer? Agrega dos turnos al mismo día». Así que la propuesta sigue ese
// orden:
//   1. Si después del último turno cabe uno razonable antes del cierre
//      habitual, va ahí (9–14 → 15–19).
//   2. Si no cabe y el último turno es de día completo, se PARTE en dos con
//      una hora de comida en medio (10–20 → 10–14 y 15–20). Nada se guarda
//      hasta «Guardar horario», y las horas quedan a la vista para ajustar.
//   3. Si tampoco, se usa el hueco libre más grande del día.
//   4. Último recurso: una hora pegada al final, sin tocar la medianoche.
//
// Función pura (sin React) para poder probarla sola.
// ═══════════════════════════════════════════════════════════════════════

export interface Shift {
  start: number;
  end: number;
}

/** Primer turno de un día vacío. */
export const DEFAULT_SHIFT: Shift = { start: 10 * 60, end: 20 * 60 };

/** Descanso que se deja entre dos turnos (la comida). */
const BREAK_MINUTES = 60;
/** Lo que dura un turno propuesto cuando hay espacio de sobra. */
const SHIFT_MINUTES = 4 * 60;
/** Menos que esto no vale la pena proponerlo como turno. */
const MIN_SHIFT_MINUTES = 2 * 60;
/** Ventana en la que se proponen turnos: nunca de madrugada. */
const EARLIEST_START = 7 * 60;
const LATEST_END = 22 * 60;

const byStart = (a: Shift, b: Shift) => a.start - b.start;

/** Devuelve la lista del día con un turno más (ordenada por hora de entrada). */
export function withNextShift(shifts: Shift[]): Shift[] {
  if (shifts.length === 0) return [{ ...DEFAULT_SHIFT }];

  const sorted = shifts.map((s) => ({ ...s })).sort(byStart);
  const lastIndex = sorted.reduce((best, s, i) => (s.end > sorted[best].end ? i : best), 0);
  const last = sorted[lastIndex];

  // 1) Después del último, dejando la hora de comida.
  const after = last.end + BREAK_MINUTES;
  if (after + MIN_SHIFT_MINUTES <= LATEST_END) {
    return [...sorted, { start: after, end: Math.min(after + SHIFT_MINUTES, LATEST_END) }].sort(byStart);
  }

  // 2) Partir el último turno si es de día completo.
  const length = last.end - last.start;
  if (length >= MIN_SHIFT_MINUTES * 2 + BREAK_MINUTES) {
    const middle = last.start + length / 2;
    const firstEnd = Math.floor((middle - BREAK_MINUTES / 2) / 60) * 60;
    const next = sorted.slice();
    next[lastIndex] = { start: last.start, end: firstEnd };
    next.push({ start: firstEnd + BREAK_MINUTES, end: last.end });
    return next.sort(byStart);
  }

  // 3) El hueco libre más grande del día (con su descanso a cada lado).
  let gap: Shift | null = null;
  let cursor = EARLIEST_START;
  for (const shift of sorted) {
    const free = { start: cursor, end: shift.start - BREAK_MINUTES };
    if (free.end - free.start > (gap ? gap.end - gap.start : 0)) gap = free;
    cursor = Math.max(cursor, shift.end + BREAK_MINUTES);
  }
  if (gap && gap.end - gap.start >= MIN_SHIFT_MINUTES) {
    // Pegado al turno que sigue: 18–22 propone 13–17, no 7–11.
    const start = Math.max(gap.start, gap.end - SHIFT_MINUTES);
    return [...sorted, { start, end: gap.end }].sort(byStart);
  }

  // 4) No hay hueco razonable: una hora al final, sin llegar a medianoche.
  const start = Math.min(last.end, LATEST_END);
  return [...sorted, { start, end: start + 60 }].sort(byStart);
}
