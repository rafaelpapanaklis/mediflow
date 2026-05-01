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

/**
 * TZ default cuando el caller no provee una válida. MediFlow opera en
 * México: usar este fallback evita que un `state.timezone` vacío caiga
 * al runtime default (UTC en SSR Vercel) y produzca el offset de -6h
 * que se observó en la vista Mes (Bug D).
 */
export const DEFAULT_TZ = "America/Mexico_City";

function safeTz(tz: string | null | undefined): string {
  return tz && tz.length > 0 ? tz : DEFAULT_TZ;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Formatea un timestamp ISO como `HH:mm` en la timezone indicada.
 *
 * **Única fuente de verdad** para mostrar la hora de una cita en cualquier
 * vista de la agenda (Día, Semana, Mes, Lista, panel de detalle, banner
 * de validación, modal de edit). Antes vista Mes usaba un formatter
 * local separado y vista Día/Semana usaba `formatSlotTime` con un
 * locale distinto — ambos pasaban por `Intl.DateTimeFormat` pero
 * dependían de paths separados que podían divergir si la `state.timezone`
 * llegaba vacía (Bug D).
 *
 * Usa `getTzParts` (mismo motor que el resto de helpers de TZ del
 * módulo) en lugar de invocar directo a `Intl.DateTimeFormat` para
 * mantener el formato `HH:mm` consistente entre runtimes (algunos v8
 * devuelven "24:00" para medianoche con `hour12: false`, este helper
 * normaliza a "00:00").
 */
export function formatTimeInTz(iso: string, timezone: string | null | undefined): string {
  const tz = safeTz(timezone);
  const p = getTzParts(new Date(iso), tz);
  const hour = p.hour === 24 ? 0 : p.hour;
  return `${pad(hour)}:${pad(p.minute)}`;
}

/**
 * Formatea un rango de cita como `HH:mm – HH:mm` en la timezone
 * indicada. Si no hay `endsAt`, devuelve solo el `start`.
 */
export function formatTimeRangeInTz(
  startsAtIso: string,
  endsAtIso: string | null | undefined,
  timezone: string | null | undefined,
): string {
  const start = formatTimeInTz(startsAtIso, timezone);
  if (!endsAtIso) return start;
  return `${start}–${formatTimeInTz(endsAtIso, timezone)}`;
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

/** Horizonte de la vista Lista en días (rolling desde `dayISO`). */
export const LIST_VIEW_HORIZON_DAYS = 30;

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
 * - list: rolling window de `LIST_VIEW_HORIZON_DAYS` días desde
 *   `dayISO` (el provider pasa `todayInTz(tz)` aquí, así que en la
 *   práctica es "hoy → +30 días"). Antes era el mes calendario
 *   completo y mostraba citas pasadas — Bug E.
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
  // list → desde `dayISO` (típicamente hoy en tz) hasta +30 días.
  const endISO = addCalendarDaysISO(dayISO, LIST_VIEW_HORIZON_DAYS);
  return calendarRangeUtc(dayISO, endISO, timezone);
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
