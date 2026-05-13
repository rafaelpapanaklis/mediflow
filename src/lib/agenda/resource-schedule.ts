/**
 * Resource working-hours helpers.
 *
 * - `loadResourceSchedule(resourceId)`: server-side fetch from DB.
 * - `validateResourceSchedule(startsAt, endsAt, schedule, timezone)`: pure.
 *   Works in client + server. `schedule === null` means "always open".
 * - `buildOpenSlotSet(schedule, dateISO, config)`: pre-computes which slot
 *   indices are inside an open window for a given date. `null` means no
 *   filtering needed.
 */

import type { ResourceScheduleWindow, WeekScheduleDTO } from "./types";
import { getTzParts, tzLocalToUtc, type ClinicTimeConfig } from "./time-utils";

/**
 * Convert a JS Date's day-of-week in a given timezone to our Monday-based
 * convention (0=Mon..6=Sun). `getTzParts.weekday` is 0=Sun..6=Sat.
 */
export function tzDayOfWeekMondayBased(date: Date, timezone: string): number {
  const parts = getTzParts(date, timezone);
  // Sun=0 in getTzParts → Sun=6 in Monday-based; Mon=1 → Mon=0; etc.
  return (parts.weekday + 6) % 7;
}

export type ValidationReason =
  | "outside_schedule"
  | "resource_closed_this_day";

export interface ValidationResult {
  ok: boolean;
  reason?: ValidationReason;
  matchingWindow?: ResourceScheduleWindow;
}

/**
 * Validate that an appointment (startsAt..endsAt) falls entirely within
 * one of the resource's open windows for the appointment's day (in the
 * clinic's timezone).
 *
 * Returns `{ ok: true }` if schedule is null (always open).
 *
 * V1 limitation: cross-midnight windows not supported. If startsAt and
 * endsAt fall on different calendar days in the clinic TZ, returns
 * `outside_schedule` unless both days have a window covering both halves.
 */
export function validateResourceSchedule(
  startsAt: Date,
  endsAt: Date,
  schedule: WeekScheduleDTO | null,
  timezone: string,
): ValidationResult {
  if (schedule === null) return { ok: true };

  const dow = tzDayOfWeekMondayBased(startsAt, timezone) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const windows = schedule.days[dow];

  if (!windows || windows.length === 0) {
    return { ok: false, reason: "resource_closed_this_day" };
  }

  const parts = getTzParts(startsAt, timezone);
  const dateISO = `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;

  for (const w of windows) {
    const [sh, sm] = w.startTime.split(":").map((n) => parseInt(n, 10));
    const [eh, em] = w.endTime.split(":").map((n) => parseInt(n, 10));
    const windowStartUtc = tzLocalToUtc(dateISO, sh, sm, timezone);
    const windowEndUtc = tzLocalToUtc(dateISO, eh, em, timezone);

    if (startsAt >= windowStartUtc && endsAt <= windowEndUtc) {
      return { ok: true, matchingWindow: w };
    }
  }

  return { ok: false, reason: "outside_schedule" };
}

/**
 * Pre-compute which slot indices on a given date are inside an open window.
 * Used by the SlotGridPicker to grey-out slots outside hours.
 *
 * Returns `null` if schedule is null (no filtering). Returns an empty Set
 * if the resource is closed that day.
 */
export function buildOpenSlotSet(
  schedule: WeekScheduleDTO | null,
  dateISO: string,
  config: ClinicTimeConfig,
): Set<number> | null {
  if (schedule === null) return null;

  // Compute dayOfWeek for the given dateISO in the clinic's TZ.
  // We probe noon of that date in UTC and ask the TZ what weekday it sees.
  const probe = tzLocalToUtc(dateISO, 12, 0, config.timezone);
  const dow = tzDayOfWeekMondayBased(probe, config.timezone) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const windows = schedule.days[dow];
  const result = new Set<number>();
  if (!windows || windows.length === 0) return result;

  const slotsPerHour = 60 / config.slotMinutes;
  const totalSlots = Math.max(0, (config.dayEnd - config.dayStart) * slotsPerHour) | 0;

  for (const w of windows) {
    const [sh, sm] = w.startTime.split(":").map((n) => parseInt(n, 10));
    const [eh, em] = w.endTime.split(":").map((n) => parseInt(n, 10));
    const startMin = (sh - config.dayStart) * 60 + sm;
    const endMin = (eh - config.dayStart) * 60 + em;
    const startIdx = Math.max(0, Math.floor(startMin / config.slotMinutes));
    const endIdx = Math.min(totalSlots, Math.ceil(endMin / config.slotMinutes));
    for (let i = startIdx; i < endIdx; i++) result.add(i);
  }
  return result;
}
