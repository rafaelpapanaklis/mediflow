import { tzLocalToUtc, getTzParts } from "./time-utils";
import type { AgendaViewMode } from "./types";

export interface AgendaDateRange {
  /** YYYY-MM-DD inclusivo en tz local. */
  fromISO: string;
  /** YYYY-MM-DD inclusivo en tz local. */
  toISO: string;
  /** UTC `>=` para Prisma. Corresponde a `fromISO 00:00 tz`. */
  fromUtc: Date;
  /** UTC `<` para Prisma. Corresponde a `(toISO + 1) 00:00 tz`. */
  toUtc: Date;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function fmtUtcISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addCalendarDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return fmtUtcISO(dt);
}

/**
 * Devuelve el día de la semana (Lun=0 .. Dom=6) que corresponde al
 * mediodía local en `dateISO`. Usamos mediodía para evitar saltos de
 * DST en bordes raros.
 */
function tzWeekday(dateISO: string, timezone: string): number {
  const utc = tzLocalToUtc(dateISO, 12, 0, timezone);
  const parts = getTzParts(utc, timezone);
  // getTzParts.weekday: Dom=0..Sab=6. Convertimos a Lun=0..Dom=6.
  return (parts.weekday + 6) % 7;
}

/**
 * Convierte un par `[fromISO, toISO]` (ambos YYYY-MM-DD inclusivos en
 * tz local) al rango UTC `[fromISO 00:00 tz, toISO+1 00:00 tz)`. Esta
 * es la primitiva sobre la que se construye `viewRangeUtc`; expuesta
 * para casos custom (ej. el endpoint /api/agenda/range que ya recibe
 * from/to del cliente).
 */
export function calendarRangeUtc(
  fromISO: string,
  toISO: string,
  timezone: string,
): AgendaDateRange {
  const fromUtc = tzLocalToUtc(fromISO, 0, 0, timezone);
  const toUtc = tzLocalToUtc(addCalendarDaysISO(toISO, 1), 0, 0, timezone);
  return { fromISO, toISO, fromUtc, toUtc };
}

/**
 * Rango canónico para cada vista de la agenda.
 *
 * Semántica: **día calendario en la tz de la clínica** (NO desplazado por
 * `agendaDayStart`). Una cita a las 23:59 hora local pertenece al día
 * calendario local, no al día UTC.
 *
 * - day: el día completo `[00:00, 24:00)` tz.
 * - week: lunes 00:00 → próximo lunes 00:00 tz (semana ISO).
 * - month: grid 6×7 que contiene `dayISO` (incluye colas de meses
 *   vecinos para que la grilla del mes siempre tenga 42 celdas).
 * - list: mes calendario completo que contiene `dayISO`.
 *
 * Esta es la **única fuente de verdad** para los rangos de fecha.
 * Tanto SSR como `/api/agenda/range` como contadores deben usar este
 * helper, sobre la misma query base. Sin esto, los contadores y el
 * renderizado se desincronizan (bug histórico de la agenda).
 */
export function viewRangeUtc(
  view: AgendaViewMode,
  dayISO: string,
  timezone: string,
): AgendaDateRange {
  if (view === "day") {
    return calendarRangeUtc(dayISO, dayISO, timezone);
  }
  if (view === "week") {
    const dow = tzWeekday(dayISO, timezone);
    const monISO = addCalendarDaysISO(dayISO, -dow);
    const sunISO = addCalendarDaysISO(monISO, 6);
    return calendarRangeUtc(monISO, sunISO, timezone);
  }
  if (view === "month") {
    // Primer día del mes en tz local.
    const [y, m] = dayISO.split("-").map((n) => parseInt(n, 10));
    const firstISO = `${y}-${pad(m)}-01`;
    const dow = tzWeekday(firstISO, timezone);
    const gridStart = addCalendarDaysISO(firstISO, -dow);
    const gridEnd = addCalendarDaysISO(gridStart, 41);
    return calendarRangeUtc(gridStart, gridEnd, timezone);
  }
  // list → mes calendario completo.
  const [y, m] = dayISO.split("-").map((n) => parseInt(n, 10));
  const firstISO = `${y}-${pad(m)}-01`;
  // Último día del mes: día 0 del mes siguiente.
  const lastDayDate = new Date(Date.UTC(y, m, 0));
  const lastISO = `${y}-${pad(m)}-${pad(lastDayDate.getUTCDate())}`;
  return calendarRangeUtc(firstISO, lastISO, timezone);
}

/**
 * Helper liviano para los componentes cliente que solo necesitan el
 * `from`/`to` como ISO YYYY-MM-DD (la query string para
 * `/api/agenda/range` no necesita los Date UTC).
 */
export function viewRangeISO(
  view: AgendaViewMode,
  dayISO: string,
  timezone: string,
): { from: string; to: string } {
  const r = viewRangeUtc(view, dayISO, timezone);
  return { from: r.fromISO, to: r.toISO };
}

/**
 * Devuelve el `dayISO` calendario (en tz local) al que pertenece un
 * timestamp ISO arbitrario. Útil para clasificar citas en buckets de
 * día/semana/mes.
 */
export function calendarDayISO(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
