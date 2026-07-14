/**
 * Horario de atención de la clínica (ClinicSchedule) — helpers PUROS,
 * usables en cliente y servidor (sin prisma, sin "server-only").
 *
 * Convención de días: dayOfWeek 0=Lunes … 6=Domingo (la del modelo
 * ClinicSchedule y el seed del registro). El manejo de hora local replica
 * el patrón de isWithinClinicHours de /api/appointments (getTzParts sobre
 * start y end) y el mapeo de día ya compartido de resource-schedule
 * (tzDayOfWeekMondayBased) — el mismo que usa bot-booking-service.
 */

import { getTzParts, tzLocalToUtc, type ClinicTimeConfig } from "./time-utils";
import { tzDayOfWeekMondayBased } from "./resource-schedule";
import type { ClinicScheduleDayDTO } from "./types";

const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export interface OutsideScheduleInfo {
  reason: "closed_day" | "outside_hours";
  /** Mensaje legible en español, listo para mostrarse tal cual en la UI. */
  message: string;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

/**
 * Evalúa si una cita (startsAt..endsAt, instantes UTC) cae fuera del horario
 * de atención de la clínica. Devuelve `null` si está dentro — o si la clínica
 * no tiene ClinicSchedule configurado (sin filas = sin señal, igual que la
 * reserva pública). Día sin fila o con enabled=false → closed_day.
 */
export function isOutsideClinicSchedule(
  schedules: ClinicScheduleDayDTO[] | null | undefined,
  startsAt: Date,
  endsAt: Date,
  timezone: string,
): OutsideScheduleInfo | null {
  if (!schedules || schedules.length === 0) return null;

  const scheduleDay = tzDayOfWeekMondayBased(startsAt, timezone);
  const dayName = DAY_NAMES[scheduleDay];
  const row = schedules.find((d) => d.dayOfWeek === scheduleDay);
  if (!row || !row.enabled) {
    return {
      reason: "closed_day",
      message: `El ${dayName} la clínica está cerrada.`,
    };
  }

  const s = getTzParts(startsAt, timezone);
  const e = getTzParts(endsAt, timezone);
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;
  // endMin < startMin = la cita cruza medianoche local: ninguna ventana
  // openTime..closeTime del mismo día puede contenerla.
  if (endMin < startMin || startMin < minutesOf(row.openTime) || endMin > minutesOf(row.closeTime)) {
    return {
      reason: "outside_hours",
      message: `Fuera del horario de atención del ${dayName} (${row.openTime}–${row.closeTime}).`,
    };
  }
  return null;
}

/**
 * Pre-computa qué índices de slot de una fecha caen dentro del horario de la
 * clínica — espejo de buildOpenSlotSet de resource-schedule, para que el
 * SlotGridPicker atenúe (sin deshabilitar) los slots fuera de horario.
 * `null` = sin ClinicSchedule configurado (no filtrar). Set vacío = día cerrado.
 */
export function buildClinicOpenSlotSet(
  schedules: ClinicScheduleDayDTO[] | null | undefined,
  dateISO: string,
  config: ClinicTimeConfig,
): Set<number> | null {
  if (!schedules || schedules.length === 0) return null;

  const probe = tzLocalToUtc(dateISO, 12, 0, config.timezone);
  const scheduleDay = tzDayOfWeekMondayBased(probe, config.timezone);
  const row = schedules.find((d) => d.dayOfWeek === scheduleDay);
  const result = new Set<number>();
  if (!row || !row.enabled) return result;

  const slotsPerHour = 60 / config.slotMinutes;
  const totalSlots = Math.max(0, (config.dayEnd - config.dayStart) * slotsPerHour) | 0;
  const startMin = minutesOf(row.openTime) - config.dayStart * 60;
  const endMin = minutesOf(row.closeTime) - config.dayStart * 60;
  const startIdx = Math.max(0, Math.floor(startMin / config.slotMinutes));
  const endIdx = Math.min(totalSlots, Math.ceil(endMin / config.slotMinutes));
  for (let i = startIdx; i < endIdx; i++) result.add(i);
  return result;
}
