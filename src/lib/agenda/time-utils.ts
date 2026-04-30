export interface ClinicTimeConfig {
  timezone: string;
  slotMinutes: number;
  dayStart: number;
  dayEnd: number;
}

export interface DayRange {
  startUtc: Date;
  endUtc: Date;
}

export type AdminPeriod = "day" | "month" | "quarter" | "year";

const WEEKDAY: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function getTzParts(date: Date, timezone: string): TzParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = new Map<string, string>();
  for (const p of fmt.formatToParts(date)) map.set(p.type, p.value);
  return {
    year:    parseInt(map.get("year") ?? "1970", 10),
    month:   parseInt(map.get("month") ?? "1", 10),
    day:     parseInt(map.get("day") ?? "1", 10),
    hour:    parseInt(map.get("hour") ?? "0", 10),
    minute:  parseInt(map.get("minute") ?? "0", 10),
    weekday: WEEKDAY[map.get("weekday") ?? "Sun"] ?? 0,
  };
}

export function tzLocalToUtc(
  dateISO: string,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const probeUtc = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));
  const parts = getTzParts(probeUtc, timezone);
  const desired = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  const tzSeesAs = Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0,
  );
  return new Date(desired - (tzSeesAs - desired));
}

export function dayRangeUtc(dateISO: string, config: ClinicTimeConfig): DayRange {
  return {
    startUtc: tzLocalToUtc(dateISO, config.dayStart, 0, config.timezone),
    endUtc:   tzLocalToUtc(dateISO, config.dayEnd, 0, config.timezone),
  };
}

export function slotsPerDay(config: ClinicTimeConfig): number {
  const hours = config.dayEnd - config.dayStart;
  return Math.max(0, (hours * 60) / config.slotMinutes) | 0;
}

/**
 * Devuelve el slot al que pertenece un timestamp dentro de `dateISO`.
 * Devuelve `-1` SOLO cuando el timestamp pertenece a un **día calendario
 * distinto** en `config.timezone`. Citas en el mismo día calendario pero
 * fuera del horario de trabajo (`[dayStart, dayEnd)`) devuelven slots
 * negativos (antes del horario) o superiores al rango (después). El
 * consumidor decide cómo posicionarlas (clamp visual o extender la
 * columna). Antes esta función filtraba duro estos casos y la cita
 * desaparecía del DOM aunque se contara en el contador — bug histórico
 * de la vista Día.
 */
export function timeToSlotIndex(
  iso: string,
  dateISO: string,
  config: ClinicTimeConfig,
): number {
  const parts = getTzParts(new Date(iso), config.timezone);
  const [y, m, dy] = dateISO.split("-").map((n) => parseInt(n, 10));
  if (parts.year !== y || parts.month !== m || parts.day !== dy) return -1;
  const minutesFromStart = (parts.hour - config.dayStart) * 60 + parts.minute;
  return Math.floor(minutesFromStart / config.slotMinutes);
}

export function slotIndexToUtc(
  slotIdx: number,
  dateISO: string,
  config: ClinicTimeConfig,
): Date {
  const totalMin = config.dayStart * 60 + slotIdx * config.slotMinutes;
  return tzLocalToUtc(
    dateISO,
    Math.floor(totalMin / 60),
    totalMin % 60,
    config.timezone,
  );
}

export function appointmentSlotSpan(
  startsAt: string,
  endsAt: string,
  config: ClinicTimeConfig,
): number {
  const durationMin =
    (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000;
  return Math.max(1, Math.ceil(durationMin / config.slotMinutes));
}

export function formatSlotTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatSlotRange(
  startsAtIso: string,
  endsAtIso: string,
  timezone: string,
): string {
  return `${formatSlotTime(startsAtIso, timezone)}–${formatSlotTime(endsAtIso, timezone)}`;
}

export function slotAxisLabel(
  slotIdx: number,
  config: ClinicTimeConfig,
): string {
  const totalMin = config.dayStart * 60 + slotIdx * config.slotMinutes;
  if (totalMin % 60 !== 0) return "";
  return `${Math.floor(totalMin / 60).toString().padStart(2, "0")}:00`;
}

export function todayInTz(timezone: string): string {
  const p = getTzParts(new Date(), timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isValidDateISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
}

export function periodRangeUtc(
  period: AdminPeriod,
  timezone: string,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const parts = getTzParts(now, timezone);
  const y = parts.year;
  const m = parts.month;

  switch (period) {
    case "day": {
      const fromISO = `${y}-${pad(m)}-${pad(parts.day)}`;
      const tomorrow = new Date(
        tzLocalToUtc(fromISO, 0, 0, timezone).getTime() + 86_400_000,
      );
      const tp = getTzParts(tomorrow, timezone);
      const toISO = `${tp.year}-${pad(tp.month)}-${pad(tp.day)}`;
      return {
        from: tzLocalToUtc(fromISO, 0, 0, timezone),
        to:   tzLocalToUtc(toISO, 0, 0, timezone),
      };
    }
    case "month": {
      const fromISO = `${y}-${pad(m)}-01`;
      const toM = m === 12 ? 1 : m + 1;
      const toY = m === 12 ? y + 1 : y;
      return {
        from: tzLocalToUtc(fromISO, 0, 0, timezone),
        to:   tzLocalToUtc(`${toY}-${pad(toM)}-01`, 0, 0, timezone),
      };
    }
    case "quarter": {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      const fromISO = `${y}-${pad(qStart)}-01`;
      const qEndMonth = qStart + 3;
      const toM = qEndMonth > 12 ? qEndMonth - 12 : qEndMonth;
      const toY = qEndMonth > 12 ? y + 1 : y;
      return {
        from: tzLocalToUtc(fromISO, 0, 0, timezone),
        to:   tzLocalToUtc(`${toY}-${pad(toM)}-01`, 0, 0, timezone),
      };
    }
    case "year":
      return {
        from: tzLocalToUtc(`${y}-01-01`, 0, 0, timezone),
        to:   tzLocalToUtc(`${y + 1}-01-01`, 0, 0, timezone),
      };
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
