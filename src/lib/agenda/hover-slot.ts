/**
 * Geometría de la guía de horario de la vista Día.
 *
 * Con 3-4 columnas de doctor abiertas, el rótulo de la hora queda muy
 * lejos del punto donde se hace click: quien agenda no sabe si le está
 * atinando a las 12:15 o a las 12:30. La agenda resalta la fila bajo el
 * cursor, y para que el resalte SIRVA tiene que caer exactamente en el
 * mismo slot que va a crear el click.
 *
 * Por eso el cálculo vive aquí y no dentro del componente: es el mismo
 * Math.floor(y / alto-de-slot) + clamp que usa AgendaColumn.handleClick.
 * Si uno cambia, el otro tiene que cambiar con él.
 */

/** Slot bajo el cursor. `y` es relativo al techo de la grilla de columnas. */
export function slotFromOffsetY(
  y: number,
  slotHpx: number,
  gridHeight: number,
): number {
  if (slotHpx <= 0) return 0;
  const lastSlot = Math.max(0, Math.ceil(gridHeight / slotHpx) - 1);
  return Math.max(0, Math.min(lastSlot, Math.floor(y / slotHpx)));
}

/** Columna bajo el cursor. Todas miden igual (grid de N tracks 1fr). */
export function columnFromOffsetX(
  x: number,
  gridWidth: number,
  columnCount: number,
): number {
  if (gridWidth <= 0 || columnCount <= 0) return 0;
  const idx = Math.floor((x / gridWidth) * columnCount);
  return Math.max(0, Math.min(columnCount - 1, idx));
}

/**
 * Hora de inicio del slot, "HH:MM" en 24h — el mismo formato de la regla
 * de horas. `slotAxisLabel` no sirve aquí: devuelve "" cuando el slot no
 * cae en punto, y esta guía justamente tiene que decir "12:15".
 */
export function slotStartLabel(
  slotIdx: number,
  dayStart: number,
  slotMinutes: number,
): string {
  const totalMin = dayStart * 60 + slotIdx * slotMinutes;
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
