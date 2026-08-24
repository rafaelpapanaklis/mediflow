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

export function fmtTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  } catch {
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
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

export const PAYMENT_METHOD_KEYS: Record<BarberPaymentMethod, string> = {
  CASH: "common.cash",
  CARD: "common.card",
  SPEI: "common.spei",
  STRIPE: "common.stripe",
};
