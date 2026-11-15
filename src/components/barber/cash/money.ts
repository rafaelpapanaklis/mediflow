// Formato y aritmética de CENTAVOS para la UI del dinero barber.
// Client-safe (sin Prisma). Los totales de la UI son una VISTA PREVIA: el
// servidor recalcula en Decimal y es la única fuente de verdad.
import type { BarberPaymentMethod } from "@/lib/barber/types";

export function fmtMoney(n: number | null | undefined, currency = "MXN"): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

/** Signo explícito para diferencias (+$20.00 / −$20.00 / $0.00). */
export function fmtSigned(n: number): string {
  if (n > 0) return `+${fmtMoney(n)}`;
  if (n < 0) return `−${fmtMoney(Math.abs(n))}`;
  return fmtMoney(0);
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
}

/**
 * "3:00 p. m." — la MISMA forma que la agenda (minuteToLabel): sin cero a
 * la izquierda y con «a. m.»/«p. m.» espaciado. Antes Inicio y Caja decían
 * «03:00 p.m.» y la Agenda «3:00 p. m.» (rediseño 15-nov, punto 12).
 * La hora y el minuto se sacan en la zona de la barbería.
 */
export function fmtTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let h24 = d.getHours();
  let mm = d.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      timeZone: tz,
    }).formatToParts(d);
    h24 = Number(parts.find((p) => p.type === "hour")?.value ?? h24) % 24;
    mm = Number(parts.find((p) => p.type === "minute")?.value ?? mm);
  } catch {
    // zona inválida: hora local del servidor, como antes
  }
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "a. m." : "p. m."}`;
}

export function fmtDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });
  } catch {
    return d.toLocaleString("es-MX");
  }
}

export function fmtDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: tz });
  } catch {
    return d.toLocaleDateString("es-MX");
  }
}

/** "2026-08" → "agosto 2026". */
export function fmtPeriod(periodKey: string, locale = "es"): string {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return periodKey;
  const d = new Date(Date.UTC(y, m - 1, 1, 12));
  try {
    return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return periodKey;
  }
}

export function currentPeriodKeyClient(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftPeriodClient(periodKey: string, delta: number): string {
  const [ys, ms] = periodKey.split("-");
  const idx = Number(ys) * 12 + (Number(ms) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// ── Centavos ────────────────────────────────────────────────────────────

export function toCents(n: number | string | null | undefined): number {
  const v = typeof n === "string" ? Number(n) : n;
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

export function fromCents(c: number): number {
  return Math.round(c) / 100;
}

/** Valida un texto de monto capturado (≤ 2 decimales, ≥ 0). */
export function parseAmountText(text: string): number | null {
  const s = text.trim().replace(/,/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type TicketDiscountMode = "amount" | "pct";

/**
 * Descuento del ticket en centavos, en pesos o en % de lo que se cobra
 * (QA B, 15-nov: el ticket solo aceptaba pesos y «10%» deshabilitaba
 * «Cobrar» sin decir por qué). Al servidor sigue llegando un MONTO: el % se
 * resuelve aquí, sobre la misma base que el monto (después del bono).
 *  · invalid → texto que no es número (o % fuera de 0–100): no se cobra y la
 *    pantalla dice por qué (`reason`).
 *  · capped → el monto escrito pasaba del total: se cobra $0 y se avisa.
 */
export function ticketDiscountCents(
  baseCents: number,
  text: string,
  mode: TicketDiscountMode,
): { cents: number; invalid: boolean; capped: boolean; reason: "format" | "percent" | null } {
  const base = Math.max(0, baseCents);
  const raw = text.trim();
  // «10%» escrito a mano en modo pesos: se entiende como porcentaje.
  const pctTyped = mode === "amount" && /^\d+(\.\d{0,2})?\s*%$/.test(raw);
  const effMode: TicketDiscountMode = pctTyped ? "pct" : mode;
  const value = parseAmountText(pctTyped ? raw.replace("%", "").trim() : raw);
  if (value === null) return { cents: 0, invalid: true, capped: false, reason: "format" };
  if (effMode === "pct") {
    if (value > 100) return { cents: 0, invalid: true, capped: false, reason: "percent" };
    return { cents: Math.round((base * value) / 100), invalid: false, capped: false, reason: null };
  }
  const asked = toCents(value);
  return { cents: Math.min(asked, base), invalid: false, capped: asked > base && base >= 0 && asked > 0, reason: null };
}

/**
 * Como parseAmountText, pero VACÍO no es $0: es «todavía no escribe nada»
 * (null). Para las cifras que se cuentan a mano y no se pueden deshacer: el
 * fondo al abrir turno y el efectivo contado al cerrarlo. Con vacío = $0, un
 * toque de más en «Cerrar turno» dejaba un faltante de todo el efectivo en un
 * turno que ya no se puede reabrir (QA B, 15-nov). Quien empieza sin fondo
 * escribe 0.
 */
export function parseRequiredAmountText(text: string): number | null {
  return text.trim() === "" ? null : parseAmountText(text);
}

export const PAYMENT_METHOD_KEYS: Record<BarberPaymentMethod, string> = {
  CASH: "common.cash",
  CARD: "common.card",
  SPEI: "common.spei",
  STRIPE: "common.stripe",
};
