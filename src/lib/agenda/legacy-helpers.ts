import { formatSlotTime } from "./time-utils";

export function dateISOInTz(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export function timeHHMMInTz(date: Date, timezone: string): string {
  return formatSlotTime(date.toISOString(), timezone);
}

export function durationMinutes(startsAt: Date, endsAt: Date): number {
  return Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
}

/**
 * "YYYY-MM-DDTHH:MM:SS-06:00" — RFC3339 con offset explícito de la tz.
 * Necesario para Google Calendar API.
 */
export function rfc3339InTz(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = new Map(parts.map((p) => [p.type, p.value]));
  const dateStr = `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
  const hour = map.get("hour") === "24" ? "00" : map.get("hour");
  const timeStr = `${hour}:${map.get("minute")}:${map.get("second")}`;

  const offsetMs = tzOffsetMsAt(date, timezone);
  const sign = offsetMs >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMs) / 60_000;
  const offH = Math.floor(absMin / 60).toString().padStart(2, "0");
  const offM = (absMin % 60).toString().padStart(2, "0");

  return `${dateStr}T${timeStr}${sign}${offH}:${offM}`;
}

function tzOffsetMsAt(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const m = new Map(parts.map((p) => [p.type, p.value]));
  const hourStr = m.get("hour") === "24" ? "0" : m.get("hour")!;
  const asUtc = Date.UTC(
    parseInt(m.get("year")!, 10),
    parseInt(m.get("month")!, 10) - 1,
    parseInt(m.get("day")!, 10),
    parseInt(hourStr, 10),
    parseInt(m.get("minute")!, 10),
    parseInt(m.get("second")!, 10),
  );
  return asUtc - date.getTime();
}
