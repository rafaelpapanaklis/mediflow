// src/lib/home/revenue-buckets.ts
//
// Ventana + buckets de la gráfica "Tendencia de ingresos" del home admin.
//
// ¿Por qué existe este archivo? Porque el KPI "Ingresos del mes" y la gráfica
// leían la MISMA tabla con el MISMO `where`… pero con ventanas distintas:
//
//   KPI      → periodRangeUtc("month")  = [día 1 00:00, mes siguiente 00:00)
//   Gráfica  → [día 1 00:00, AHORA + 1h)  y buckets sólo hasta el día de hoy
//
// Cualquier pago con `paidAt` posterior a "ahora + 1h" (el seed de demo escribe
// `paidAt = fin de la cita + 1..2 h`, así que los cobros de las citas de hoy
// caen a futuro) contaba para el KPI y NO tenía dónde caer en la gráfica: la
// tarjeta decía $1,224 y la línea se quedaba plana en $0.
//
// Regla de esta capa: **la ventana de la gráfica es SIEMPRE el periodo
// calendario completo, el mismo que usa el KPI**, y los buckets teselan esa
// ventana sin huecos. Así la suma de la serie es, por construcción, el número
// de la tarjeta. La prueba `revenue-buckets.test.ts` verifica ambas cosas.
//
// Importes RELATIVOS a propósito: `tsx --test` corre este módulo sin el alias
// "@/" de Next.
import { getTzParts, tzLocalToUtc, periodRangeUtc } from "../agenda/time-utils";

export type RevenueRange = "hoy" | "semana" | "mes" | "anio";

export interface RevenueBucket {
  /** Clave de agrupación en zona de la clínica; ver `bucketKeyFor`. */
  key: string;
  /** Etiqueta del eje X. */
  label: string;
  /** Instante UTC en que ARRANCA el bucket (sirve para marcar los futuros). */
  start: Date;
}

export interface RevenueWindow {
  buckets: RevenueBucket[];
  /** Filtro `paidAt >= from`. */
  from: Date;
  /** Filtro `paidAt < to`. NUNCA es "ahora": es el fin del periodo calendario. */
  to: Date;
}

export function parseRevenueRange(v: string | null | undefined): RevenueRange {
  return v === "hoy" || v === "semana" || v === "anio" || v === "mes" ? v : "mes";
}

/** El rango de la gráfica que le corresponde a cada periodo del toggle del home. */
export function rangeForPeriod(period: "day" | "month" | "quarter" | "year"): RevenueRange {
  if (period === "day") return "hoy";
  if (period === "year") return "anio";
  return "mes"; // "quarter" no tiene gráfica propia: se muestra el mes en curso
}

/**
 * Ventana y buckets del rango pedido, en la zona horaria de la clínica.
 *
 * - `hoy`    → periodRangeUtc("day")   · 24 buckets, una hora cada uno (00:00…23:00)
 * - `semana` → semana ISO lunes→domingo · 7 buckets de un día
 * - `mes`    → periodRangeUtc("month") · un bucket por día del mes, del 1 al último
 * - `anio`   → periodRangeUtc("year")  · 12 buckets, uno por mes del año en curso
 *
 * Los buckets cubren el rango COMPLETO (incluidos los tramos que aún no
 * ocurren). Un tramo futuro se distingue por `start > now`; la UI decide si lo
 * dibuja o corta la línea ahí, pero el dato nunca se pierde.
 */
export function buildRevenueWindow(
  range: RevenueRange,
  tz: string,
  now: Date = new Date(),
): RevenueWindow {
  const np = getTzParts(now, tz);

  if (range === "hoy") {
    const { from, to } = periodRangeUtc("day", tz, now);
    const dayISO = isoDate(np.year, np.month, np.day);
    const buckets: RevenueBucket[] = [];
    for (let h = 0; h < 24; h++) {
      buckets.push({
        key: hourKey(np.year, np.month, np.day, h),
        label: `${pad(h)}:00`,
        start: tzLocalToUtc(dayISO, h, 0, tz),
      });
    }
    return { buckets, from, to };
  }

  if (range === "semana") {
    // Semana ISO (lunes → domingo), la misma convención que la vista Semana de
    // la agenda. getTzParts.weekday viene Dom=0..Sáb=6.
    const sinceMonday = (np.weekday + 6) % 7;
    const buckets: RevenueBucket[] = [];
    for (let i = 0; i < 7; i++) {
      const d = civilDay(np.year, np.month, np.day - sinceMonday + i);
      buckets.push({
        key: dayKey(d.y, d.m, d.d),
        label: weekdayLabel(d.y, d.m, d.d),
        start: tzLocalToUtc(isoDate(d.y, d.m, d.d), 0, 0, tz),
      });
    }
    const nextMonday = civilDay(np.year, np.month, np.day - sinceMonday + 7);
    return {
      buckets,
      from: buckets[0].start,
      to: tzLocalToUtc(isoDate(nextMonday.y, nextMonday.m, nextMonday.d), 0, 0, tz),
    };
  }

  if (range === "anio") {
    const { from, to } = periodRangeUtc("year", tz, now);
    const buckets: RevenueBucket[] = [];
    for (let m = 1; m <= 12; m++) {
      buckets.push({
        key: monthKey(np.year, m),
        label: monthLabel(np.year, m),
        start: tzLocalToUtc(isoDate(np.year, m, 1), 0, 0, tz),
      });
    }
    return { buckets, from, to };
  }

  // "mes": un bucket por día del mes en curso — del 1 al ÚLTIMO, no al de hoy.
  const { from, to } = periodRangeUtc("month", tz, now);
  const total = daysInMonth(np.year, np.month);
  const buckets: RevenueBucket[] = [];
  for (let day = 1; day <= total; day++) {
    buckets.push({
      key: dayKey(np.year, np.month, day),
      label: String(day),
      start: tzLocalToUtc(isoDate(np.year, np.month, day), 0, 0, tz),
    });
  }
  return { buckets, from, to };
}

/**
 * Clave del bucket al que pertenece un pago. Se deriva SIEMPRE de la fecha
 * LOCAL de la clínica (getTzParts), así que el agrupamiento es a prueba de
 * husos y de DST: un pago cae en su bucket por su fecha local, no por UTC.
 */
export function bucketKeyFor(
  range: RevenueRange,
  parts: { year: number; month: number; day: number; hour: number },
): string {
  if (range === "hoy") return hourKey(parts.year, parts.month, parts.day, normHour(parts.hour));
  if (range === "anio") return monthKey(parts.year, parts.month);
  return dayKey(parts.year, parts.month, parts.day); // semana + mes
}

/** Atajo: clave de un instante concreto en la zona de la clínica. */
export function bucketKeyForDate(range: RevenueRange, date: Date, tz: string): string {
  return bucketKeyFor(range, getTzParts(date, tz));
}

// ── helpers ────────────────────────────────────────────────────────────────

// Algunos V8 devuelven hour===24 para la medianoche local con hour12:false
// (mismo parche que formatSlotTime en time-utils). Sin esto el pago de las
// 00:xx quedaría con clave "…-24" y ningún bucket lo reclamaría.
function normHour(h: number): number {
  return h === 24 ? 0 : h;
}

/** Aritmética de calendario con desbordes (día 0, día 32…) ya resueltos. */
function civilDay(y: number, m: number, d: number): { y: number; m: number; d: number } {
  // Mediodía UTC: inmune a cualquier corrimiento de ±14 h entre husos.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function hourKey(y: number, m: number, d: number, h: number): string {
  return `${y}-${pad(m)}-${pad(d)}-${pad(h)}`;
}
function dayKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function monthKey(y: number, m: number): string {
  return `${y}-${pad(m)}`;
}
function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function weekdayLabel(y: number, m: number, d: number): string {
  const s = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)))
    .replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthLabel(y: number, m: number): string {
  const s = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 15, 12)))
    .replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
