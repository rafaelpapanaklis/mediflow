import { getTzParts, tzLocalToUtc } from "./time-utils";

/**
 * Unificación de las DOS fuentes de horario de la clínica (P1-13):
 *
 *  - `Clinic.agendaDayStart/End` — enteros (8–20 por default) que NADIE puede
 *    editar desde la UI; eran lo único que pintaba el eje del panel y validaba
 *    el alta del staff.
 *  - `ClinicSchedule` — lo que Ajustes SÍ edita (por día: enabled +
 *    openTime/closeTime "HH:MM"); hasta ahora solo lo respetaban la reserva
 *    pública, el portal y el bot.
 *
 * Reglas:
 *  - La ventana EFECTIVA (`effectiveAgendaWindow`) es la UNIÓN de ambas: nunca
 *    más angosta que el 8–20 histórico. Es la que LEE la API (rango de
 *    `/api/appointments`, rejilla de horas del alta) — ensancharla no esconde
 *    nada, así que ahí la unión es la respuesta segura.
 *  - Lo que se DIBUJA es otra cosa: `paintedAgendaWindow` pinta el horario REAL
 *    de los días visibles, ensanchado lo justo para no esconder ninguna cita.
 *    Una clínica 09:00–18:00 dejaba 3 de 12 horas en blanco.
 *  - El alta/edición del staff AVISA (no bloquea) cuando la cita cae en día
 *    cerrado o fuera del horario configurado — ver scheduleViolation.
 *
 * Convención dayOfWeek de ClinicSchedule: 0=Lunes … 6=Domingo (≠ JS getDay).
 */
export interface ScheduleDay {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;
  closeTime: string;
}

export interface AgendaWindowSource {
  agendaDayStart: number;
  agendaDayEnd: number;
}

function parseHHMM(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}

/** Weekday 0=Lunes…6=Domingo de un instante UTC visto en la tz de la clínica. */
export function scheduleDayOf(instant: Date, timezone: string): number {
  const p = getTzParts(instant, timezone);
  const jsDay = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=Dom
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Ventana horaria (horas enteras) EFECTIVA de la clínica: unión de
 * agendaDayStart/End con el horario configurado de los días habilitados.
 * Sin ClinicSchedule utilizable → exactamente la ventana de siempre.
 *
 * La usa todo lo que LEE o valida (nunca más angosta que antes = nada
 * desaparece). Lo que el eje pinta sale de `paintedAgendaWindow`.
 */
export function effectiveAgendaWindow(
  clinic: AgendaWindowSource,
  schedules: ScheduleDay[] | null | undefined,
): { dayStart: number; dayEnd: number } {
  let dayStart = clinic.agendaDayStart;
  let dayEnd = clinic.agendaDayEnd;
  for (const day of schedules ?? []) {
    if (!day.enabled) continue;
    const open = parseHHMM(day.openTime);
    const close = parseHHMM(day.closeTime);
    if (open === null || close === null || close <= open) continue;
    dayStart = Math.min(dayStart, Math.floor(open / 60));
    dayEnd = Math.max(dayEnd, Math.ceil(close / 60));
  }
  dayStart = Math.max(0, Math.min(23, dayStart));
  dayEnd = Math.max(dayStart + 1, Math.min(24, dayEnd));
  return { dayStart, dayEnd };
}

/** Weekday 0=Lunes…6=Domingo de un día calendario `YYYY-MM-DD` de la clínica.
 *  Se mide al MEDIODÍA local para no caer en el borde de un cambio de horario. */
export function scheduleDayOfISO(dateISO: string, timezone: string): number {
  return scheduleDayOf(tzLocalToUtc(dateISO, 12, 0, timezone), timezone);
}

/** Los siete días, para las vistas que pintan la semana entera. */
export const ALL_SCHEDULE_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Una cita reducida a lo único que el eje necesita saber de ella. */
export interface AgendaSpan {
  startsAt: string;
  endsAt?: string | null;
}

export interface PaintedWindowInput {
  /**
   * Ventana EFECTIVA (`effectiveAgendaWindow`) — el 8–20 histórico unido a
   * Ajustes. Aquí es solo el SUELO para clínicas sin ClinicSchedule
   * utilizable; con horario configurado NO se usa (ese es el punto).
   */
  fallback: { dayStart: number; dayEnd: number };
  schedules: ScheduleDay[] | null | undefined;
  /** Días (0=Lun…6=Dom) que la vista pinta: uno en Día, los siete en Semana. */
  visibleDays: readonly number[];
  /** Citas que la vista pinta. */
  appointments: readonly AgendaSpan[];
  /** Vista Día: descarta las citas de otro día calendario del mismo lote. */
  onlyDayISO?: string | null;
  timezone: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Ventana horaria que el EJE de la agenda realmente PINTA. **Solo
 * presentación** — nada de lo que lee, crea o valida citas pasa por aquí.
 *
 * `effectiveAgendaWindow` (la unión con el 8–20 histórico) sigue mandando en
 * la API: el rango de lectura de `/api/appointments`, la rejilla de horas del
 * alta y el aviso de fuera-de-horario. Lo que cambia es lo que se DIBUJA:
 * una clínica 09:00–18:00 pintaba 08:00–20:00, tres horas de rejilla vacía
 * (25% del alto) que son justo las que hacían que el día no cupiera.
 *
 * Reglas:
 *  1. Base = horario configurado de los días VISIBLES (unión). Si todos los
 *     días visibles están cerrados, se usa el horario general de la clínica
 *     (unión de los días habilitados) como lienzo. Sin ClinicSchedule
 *     utilizable, `fallback` — exactamente el comportamiento de siempre.
 *  2. La base se ENSANCHA hasta cubrir toda cita del lote. Las citas fuera de
 *     horario existen (el alta solo AVISA), así que estrechar el eje no puede
 *     esconderlas: antes de este cambio una cita a las 8:00 con horario 9–18
 *     se habría clampeado al slot 0 —mintiendo sobre su hora— y una de las
 *     19:00 se habría salido del alto de la columna en la vista Semana.
 */
export function paintedAgendaWindow(
  input: PaintedWindowInput,
): { dayStart: number; dayEnd: number } {
  const { fallback, schedules, visibleDays, appointments, onlyDayISO, timezone } = input;

  const usable = (schedules ?? []).filter((d) => {
    const open = parseHHMM(d.openTime);
    const close = parseHHMM(d.closeTime);
    return open !== null && close !== null && close > open;
  });
  const enabled = usable.filter((d) => d.enabled);
  const visible = new Set(visibleDays);
  const rows = enabled.filter((d) => visible.has(d.dayOfWeek));
  const base = rows.length > 0 ? rows : enabled;

  let dayStart: number;
  let dayEnd: number;
  if (base.length === 0) {
    dayStart = fallback.dayStart;
    dayEnd = fallback.dayEnd;
  } else {
    dayStart = 24;
    dayEnd = 0;
    for (const d of base) {
      dayStart = Math.min(dayStart, Math.floor(parseHHMM(d.openTime)! / 60));
      dayEnd = Math.max(dayEnd, Math.ceil(parseHHMM(d.closeTime)! / 60));
    }
  }

  for (const a of appointments) {
    const startMs = Date.parse(a.startsAt);
    if (!Number.isFinite(startMs)) continue;
    const s = getTzParts(new Date(startMs), timezone);
    if (onlyDayISO && `${s.year}-${pad2(s.month)}-${pad2(s.day)}` !== onlyDayISO) continue;
    if (s.hour < dayStart) dayStart = s.hour;

    const endMs = a.endsAt ? Date.parse(a.endsAt) : startMs;
    const e = Number.isFinite(endMs) && endMs > startMs
      ? getTzParts(new Date(endMs), timezone)
      : s;
    // Cruza medianoche (o termina justo en ella): el eje llega hasta el final
    // del día; la cita ya no cabe entera y la vista Día es de un solo día.
    const sameDay = e.year === s.year && e.month === s.month && e.day === s.day;
    const endHour = sameDay ? e.hour + (e.minute > 0 ? 1 : 0) : 24;
    if (endHour > dayEnd) dayEnd = endHour;
  }

  dayStart = Math.max(0, Math.min(23, Math.floor(dayStart)));
  dayEnd = Math.max(dayStart + 1, Math.min(24, Math.ceil(dayEnd)));
  return { dayStart, dayEnd };
}

export interface ScheduleViolation {
  reason: "closed_day" | "before_open" | "after_close";
  /** Copy listo para toast del staff. */
  message: string;
  /** Ventana del día en "HH:MM" (null si el día está cerrado). */
  openTime: string | null;
  closeTime: string | null;
}

function fmt(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * ¿La cita cae fuera del horario configurado? Con ClinicSchedule presente
 * manda el horario del DÍA (incluye días cerrados — lo que el panel nunca
 * validaba); sin ClinicSchedule se conserva el criterio viejo
 * (agendaDayStart/End). Devuelve null si todo bien. El caller decide qué
 * hacer: el alta del staff AVISA con esto, no bloquea (P1-13).
 */
export function scheduleViolation(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  clinic: AgendaWindowSource,
  schedules: ScheduleDay[] | null | undefined,
): ScheduleViolation | null {
  const s = getTzParts(startsAt, timezone);
  const e = getTzParts(endsAt, timezone);
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;

  let openMin = clinic.agendaDayStart * 60;
  let closeMin = clinic.agendaDayEnd * 60;

  const rows = (schedules ?? []).filter(
    (d) => parseHHMM(d.openTime) !== null && parseHHMM(d.closeTime) !== null,
  );
  if (rows.length > 0) {
    const day = rows.find((d) => d.dayOfWeek === scheduleDayOf(startsAt, timezone));
    if (!day || !day.enabled) {
      return {
        reason: "closed_day",
        message: "Ojo: la clínica está cerrada ese día según el horario de Ajustes. La cita se guardó de todas formas.",
        openTime: null,
        closeTime: null,
      };
    }
    openMin = parseHHMM(day.openTime)!;
    closeMin = parseHHMM(day.closeTime)!;
  }

  if (startMin < openMin) {
    return {
      reason: "before_open",
      message: `Ojo: la cita empieza antes de la apertura (${fmt(openMin)}). Se guardó de todas formas.`,
      openTime: fmt(openMin),
      closeTime: fmt(closeMin),
    };
  }
  if (endMin > closeMin) {
    return {
      reason: "after_close",
      message: `Ojo: la cita termina después del cierre (${fmt(closeMin)}). Se guardó de todas formas.`,
      openTime: fmt(openMin),
      closeTime: fmt(closeMin),
    };
  }
  return null;
}
