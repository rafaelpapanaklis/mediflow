/**
 * Afiliados — contratos y helpers compartidos de estadísticas/reportes.
 *
 * Este archivo es el CONTRATO entre /api/afiliados/stats, la página de
 * estadísticas, los reportes (Excel/PDF) y las métricas de admin. Cualquier
 * cambio de shape se hace AQUÍ primero.
 *
 * Privacidad: el afiliado solo ve datos agregados propios; de las clínicas
 * referidas solo nombre y estado de la referencia. La IP de los clicks se
 * guarda como sha256(salt+ip) truncado — nunca cruda.
 */

import { createHash } from "crypto";

// ── Rango de la serie temporal ───────────────────────────────────────────

export type StatsRange = 7 | 30 | 90;

export function parseStatsRange(value: string | null | undefined): StatsRange {
  if (value === "7") return 7;
  if (value === "90") return 90;
  return 30;
}

/** Inicio (00:00 UTC) del rango: hoy incluido, `range` días en total. */
export function rangeStartUtc(range: StatsRange): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - (range - 1) * 86400000);
}

/** Últimos n días (UTC) como 'YYYY-MM-DD', ascendente, hoy incluido. */
export function lastNDaysUtc(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** 'YYYY-MM' → límites [start, end) en UTC + etiqueta es-MX ("junio de 2026"). */
export function monthBoundsUtc(month: string | null | undefined): { start: Date; end: Date; label: string } | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const label = start.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

// ── Shapes de la respuesta de /api/afiliados/stats ──────────────────────

export interface AffiliateFunnel {
  /** Clicks registrados (histórico desde que existe la tabla). */
  clicks: number;
  /** Clínicas registradas con el ref del afiliado (histórico). */
  signups: number;
  /** Clínicas referidas activas hoy (suscritas o en prueba vigente). */
  active: number;
  /** Clínicas referidas pagando hoy (subscriptionStatus = 'active'). */
  paying: number;
}

export interface AffiliateSeriesPoint {
  /** 'YYYY-MM-DD' (UTC). */
  date: string;
  clicks: number;
  signups: number;
}

export interface AffiliateRefRow {
  ref: string;
  campaign: string | null;
  clicks: number;
}

export interface AffiliateCommissionsSummary {
  pendingMxn: number;
  pendingCount: number;
  paidMxn: number;
  paidCount: number;
  totalMxn: number;
  totalCount: number;
  /** MRR estimado de sus clínicas referidas pagando (precio mensual). */
  mrrMxn: number;
  /** Proyección simple: mrrMxn * commissionPct / 100. */
  projectedMonthlyMxn: number;
  commissionPct: number;
}

export interface AffiliateStatsResponse {
  range: StatsRange;
  funnel: AffiliateFunnel;
  series: AffiliateSeriesPoint[];
  byRef: AffiliateRefRow[];
  commissions: AffiliateCommissionsSummary;
  /** ISO del primer click registrado (la tabla es nueva) o null si aún no hay. */
  clicksTrackedSince: string | null;
}

// ── Estado de suscripción de clínicas referidas ──────────────────────────
// Clinic.subscriptionStatus: "active" | "trialing" | "past_due" | "cancelled" | null
// (null = trial inicial sin pasar por billing; vigente si trialEndsAt > now).

export function payingClinicWhere() {
  return { subscriptionStatus: "active" } as const;
}

export function activeClinicWhere(now: Date = new Date()) {
  return {
    OR: [
      { subscriptionStatus: { in: ["active", "trialing"] } },
      { subscriptionStatus: null, trialEndsAt: { gt: now } },
    ],
  };
}

// ── MRR ──────────────────────────────────────────────────────────────────
// Fallback de precios por plan (mismos montos que el dashboard de admin).

export const PLAN_PRICES_MXN: Record<string, number> = { BASIC: 419, PRO: 689, CLINIC: 1719 };

export function clinicMonthlyMxn(
  plan: string | null | undefined,
  monthlyPrice: number | null | undefined,
): number {
  if (typeof monthlyPrice === "number" && monthlyPrice > 0) return monthlyPrice;
  return PLAN_PRICES_MXN[plan ?? ""] ?? 0;
}

export function roundMxn(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Privacidad de clicks ─────────────────────────────────────────────────

const IP_SALT =
  process.env.AFFILIATE_IP_SALT ?? process.env.ADMIN_SECRET_TOKEN ?? "dalecontrol-affiliate-clicks";

/** sha256(salt:ip) truncado a 32 hex. Nunca guardes la IP cruda. */
export function hashIp(ip: string | null | undefined): string | null {
  const v = (ip ?? "").trim();
  if (!v) return null;
  return createHash("sha256").update(`${IP_SALT}:${v}`).digest("hex").slice(0, 32);
}

/** Primer IP del x-forwarded-for o x-real-ip. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}

/** User-agent compactado a 160 chars (sin saltos ni espacios repetidos). */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  const v = (ua ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.slice(0, 160);
}
