// Formato compartido de Inicio y Reportes (client-safe). El dinero y la hora
// se formatean con los MISMOS helpers que la caja (money.ts) para que un
// importe se vea igual en las tres pantallas.
export { fmtMoney, fmtPct, fmtTime, fmtDateTime } from "@/components/barber/cash/money";

function intlLocale(locale: string | null | undefined): string {
  return locale === "en" ? "en-US" : "es-MX";
}

/** "YYYY-MM-DD" (día calendario, sin zona) → texto. */
export function fmtDayKey(
  key: string,
  locale: string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  if (!m) return key ?? "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  try {
    return d.toLocaleDateString(intlLocale(locale), { ...opts, timeZone: "UTC" });
  } catch {
    return key;
  }
}

/** "lunes, 24 de agosto" */
export function fmtLongDay(key: string, locale: string | null | undefined): string {
  return fmtDayKey(key, locale, { weekday: "long", day: "numeric", month: "long" });
}

/** "24 ago" */
export function fmtShortDay(key: string, locale: string | null | undefined): string {
  return fmtDayKey(key, locale, { day: "numeric", month: "short" });
}

/** "24 ago 2026" */
export function fmtMediumDay(key: string, locale: string | null | undefined): string {
  return fmtDayKey(key, locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Día de la semana (0 = domingo) de una clave YYYY-MM-DD. */
export function weekdayOfKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  if (!m) return 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

export function fmtInt(n: number | null | undefined, locale?: string | null): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  try {
    return v.toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 });
  } catch {
    return String(Math.round(v));
  }
}

/** Dinero sin centavos para ejes y etiquetas compactas. */
export function fmtMoneyCompact(n: number, locale?: string | null, currency = "MXN"): string {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(v);
  } catch {
    return `$${Math.round(v)}`;
  }
}

/** "+12.5%" / "−3%" / "0%" */
export function fmtPctSigned(n: number, locale?: string | null): string {
  const v = Number.isFinite(n) ? n : 0;
  const body = `${Math.abs(v).toLocaleString(intlLocale(locale), { maximumFractionDigits: 1 })}%`;
  if (v > 0) return `+${body}`;
  if (v < 0) return `−${body}`;
  return body;
}

export function fmtHour(h: number): string {
  return `${h < 10 ? "0" : ""}${h}:00`;
}
