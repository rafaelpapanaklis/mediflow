// ═══════════════════════════════════════════════════════════════════════════
// Manager de cuenta — disponibilidad (PURO y testeable).
//
// Se evalúa SIEMPRE en el servidor y en la timezone del MANAGER, no en la del
// visitante: si la clínica está en Tijuana y el manager en Mérida, "en línea"
// significa que el manager está en su horario, que es lo único que importa.
//
// Reusa getTzParts de @/lib/agenda/time-utils (el helper de TZ que ya existe en
// el repo) — nada de librerías nuevas ni de aritmética de offsets a mano.
// ═══════════════════════════════════════════════════════════════════════════

import { getTzParts } from "@/lib/agenda/time-utils";
import type { AccountManagerSchedule } from "./types";

const MINUTES_PER_DAY = 24 * 60;
const DAYS_IN_WEEK = 7;

/**
 * Locale de los textos. El panel soporta es/en (ver src/i18n/dictionaries.ts);
 * "es" es el default porque es el idioma fuente del producto.
 */
export type AmLocale = "es" | "en";

function loc(locale?: string): AmLocale {
  return locale === "en" ? "en" : "es";
}

/** 0=Domingo … 6=Sábado. Índice = valor de `days`. */
const DAY_NAMES: Record<AmLocale, string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

const DAY_SHORT: Record<AmLocale, string[]> = {
  es: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

const ALL_DAYS_LABEL: Record<AmLocale, string> = {
  es: "Todos los días",
  en: "Every day",
};

/** Plantillas del texto de "vuelve a atender". {at} = hora, {day} = día. */
const NEXT_AVAILABLE: Record<AmLocale, { today: string; tomorrow: string; weekday: string }> = {
  es: {
    today:    "te responde hoy a las {at}",
    tomorrow: "te responde mañana a las {at}",
    weekday:  "te responde el {day} a las {at}",
  },
  en: {
    today:    "replies today at {at}",
    tomorrow: "replies tomorrow at {at}",
    weekday:  "replies on {day} at {at}",
  },
};

/**
 * Minutos transcurridos del día y día de la semana del manager, ahora mismo.
 *
 * getTzParts usa Intl con hour12:false, que en algunos runtimes devuelve "24"
 * para la medianoche en vez de "0" — normalizamos con % 24 para que 00:15 no se
 * lea como 24:15 (1455 min) y rompa toda comparación de horario.
 */
function localNow(timezone: string, now: Date): { weekday: number; minutes: number } {
  const parts = getTzParts(now, timezone);
  const hour = parts.hour % 24;
  return { weekday: parts.weekday, minutes: hour * 60 + parts.minute };
}

/** Días válidos, deduplicados y ordenados. Descarta basura (null, 9, -1…). */
function normalizedDays(days: number[] | null | undefined): number[] {
  const seen = new Set<number>();
  for (const d of Array.isArray(days) ? days : []) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n);
  }
  // TS target < es2015 en este repo: nada de [...set] (ver tsconfig).
  return Array.from(seen).sort((a, b) => a - b);
}

/** El horario es utilizable: activo, con días y con una ventana no vacía. */
function hasUsableSchedule(m: AccountManagerSchedule): boolean {
  return (
    m.status === "active" &&
    normalizedDays(m.days).length > 0 &&
    Number.isFinite(m.startMinutes) &&
    Number.isFinite(m.endMinutes) &&
    m.endMinutes > m.startMinutes
  );
}

/**
 * ¿El manager está atendiendo AHORA?
 *
 * true si status==='active', el día actual (en su timezone) está en `days` y
 * la hora cae en [startMinutes, endMinutes) — apertura INCLUSIVA, cierre
 * EXCLUSIVO: a las 9:00 en punto ya está en línea; a las 18:00 en punto ya no.
 */
export function isOnline(m: AccountManagerSchedule, now: Date): boolean {
  if (!hasUsableSchedule(m)) return false;
  const { weekday, minutes } = localNow(m.timezone, now);
  if (normalizedDays(m.days).indexOf(weekday) === -1) return false;
  return minutes >= m.startMinutes && minutes < m.endMinutes;
}

/** "9:00" — sin cero a la izquierda en la hora, como el prototipo. */
export function formatMinutes(minutes: number): string {
  const total = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Rango de días legible: "Lun–Vie", "Dom, Sáb", "Lun, Mié, Vie".
 * Sólo colapsa a rango cuando los días son consecutivos (y son 3 o más).
 */
export function formatDays(days: number[], locale?: string): string {
  const l = loc(locale);
  const list = normalizedDays(days);
  if (list.length === 0) return "";
  if (list.length === DAYS_IN_WEEK) return ALL_DAYS_LABEL[l];

  let consecutive = true;
  for (let i = 1; i < list.length; i++) {
    if (list[i] !== list[i - 1] + 1) { consecutive = false; break; }
  }
  if (consecutive && list.length >= 3) {
    return `${DAY_SHORT[l][list[0]]}–${DAY_SHORT[l][list[list.length - 1]]}`;
  }
  return list.map((d) => DAY_SHORT[l][d]).join(", ");
}

/** "Lun–Vie · 9:00–18:00" — la línea de horario de la tarjeta. */
export function formatSchedule(m: AccountManagerSchedule, locale?: string): string {
  const days = formatDays(m.days, locale);
  const hours = `${formatMinutes(m.startMinutes)}–${formatMinutes(m.endMinutes)}`;
  return days ? `${days} · ${hours}` : hours;
}

/**
 * Texto tranquilizador para el estado fuera de horario:
 *   "te responde mañana a las 9:00"
 *   "te responde el lunes a las 9:00"   (si el próximo hábil no es mañana)
 *   "te responde hoy a las 9:00"        (hoy es hábil y aún no abre)
 *
 * Devuelve "" cuando no hay nada sensato que prometer (manager pausado o sin
 * días configurados): la tarjeta simplemente omite la frase.
 */
export function nextAvailableText(m: AccountManagerSchedule, now: Date, locale?: string): string {
  if (!hasUsableSchedule(m)) return "";

  const l = loc(locale);
  const tpl = NEXT_AVAILABLE[l];
  const days = normalizedDays(m.days);
  const { weekday, minutes } = localNow(m.timezone, now);
  const at = formatMinutes(m.startMinutes);

  // Hoy es hábil y todavía no abre → abre hoy mismo.
  if (days.indexOf(weekday) !== -1 && minutes < m.startMinutes) {
    return tpl.today.replace("{at}", at);
  }

  // Busca el siguiente día hábil (1..7 días adelante). Con days no vacío
  // siempre encuentra uno dentro de la semana.
  for (let offset = 1; offset <= DAYS_IN_WEEK; offset++) {
    const candidate = (weekday + offset) % DAYS_IN_WEEK;
    if (days.indexOf(candidate) === -1) continue;
    if (offset === 1) return tpl.tomorrow.replace("{at}", at);
    return tpl.weekday.replace("{day}", DAY_NAMES[l][candidate]).replace("{at}", at);
  }

  return "";
}
