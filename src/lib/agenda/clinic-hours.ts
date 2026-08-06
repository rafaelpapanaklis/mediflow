import { getTzParts } from "./time-utils";

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
 *  - El EJE del panel usa la UNIÓN de ambas ventanas (nunca más angosto que
 *    hoy): una clínica que declara 07:00–21:00 ve sus slots de las 7; una que
 *    declara 09:00–14:00 conserva el eje 8–20 de siempre y ninguna cita vieja
 *    fuera de ventana desaparece del grid.
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
 * Ventana horaria (horas enteras) para el EJE de la agenda: unión de
 * agendaDayStart/End con el horario configurado de los días habilitados.
 * Sin ClinicSchedule utilizable → exactamente la ventana de siempre.
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
