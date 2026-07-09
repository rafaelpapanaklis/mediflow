// Helpers compartidos por los endpoints /api/admin/analytics/* (servidor).
// Congela filtros, where-builders y bucketing para que la autoría de los
// endpoints sea consistente.
//
// Zona horaria: todo el bucketing y los límites de día se anclan a México
// (America/Mexico_City = UTC-6 todo el año desde 2023). Así "Hoy"/"7 días"
// coinciden con el día natural del owner, no con UTC.

import { Prisma } from "@prisma/client";
import type { AnalyticsFilters, BucketUnit } from "./types";

export { LIVE_WINDOW_MS } from "./constants";

/** Offset fijo de México (sin horario de verano). */
export const MX_OFFSET_MS = 6 * 60 * 60 * 1000;

function parseDate(raw: string | null, fallback: Date, endOfDay = false): Date {
  if (!raw) return fallback;
  // Fecha sin hora → interpretarla como día natural de México (-06:00).
  const iso = raw.includes("T")
    ? raw
    : `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-06:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? fallback : d;
}

export function parseAnalyticsFilters(sp: URLSearchParams): AnalyticsFilters {
  const now = new Date();
  const defFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDate(sp.get("from"), defFrom, false);
  const to = parseDate(sp.get("to"), now, true);
  const surfaceRaw = sp.get("surface");
  const surface = surfaceRaw && surfaceRaw !== "all" ? surfaceRaw : null;
  const clinicId = sp.get("clinicId") || null;
  return { from, to, surface, clinicId };
}

/** WHERE base para AnalyticsSession. Excluye owner (admin) y bots. */
export function sessionWhere(f: AnalyticsFilters): Prisma.AnalyticsSessionWhereInput {
  return {
    startedAt: { gte: f.from, lte: f.to },
    identityType: { not: "admin" },
    device: { not: "bot" },
    ...(f.surface ? { surface: f.surface } : {}),
    ...(f.clinicId ? { clinicId: f.clinicId } : {}),
  };
}

/** WHERE base para AnalyticsEvent. */
export function eventWhere(
  f: AnalyticsFilters,
  extra?: Prisma.AnalyticsEventWhereInput,
): Prisma.AnalyticsEventWhereInput {
  return {
    createdAt: { gte: f.from, lte: f.to },
    ...(f.surface ? { surface: f.surface } : {}),
    ...(f.clinicId ? { clinicId: f.clinicId } : {}),
    ...extra,
  };
}

export function pickBucket(from: Date, to: Date): BucketUnit {
  const days = (to.getTime() - from.getTime()) / 86400000;
  if (days <= 2) return "hour";
  if (days <= 92) return "day";
  return "month";
}

/** Formatea una fecha YA en espacio México (componentes UTC = hora local MX). */
function keyFromMx(mx: Date, unit: BucketUnit): string {
  const y = mx.getUTCFullYear();
  const m = String(mx.getUTCMonth() + 1).padStart(2, "0");
  const day = String(mx.getUTCDate()).padStart(2, "0");
  const h = String(mx.getUTCHours()).padStart(2, "0");
  if (unit === "hour") return `${y}-${m}-${day}T${h}`;
  if (unit === "day") return `${y}-${m}-${day}`;
  return `${y}-${m}`;
}

/** Clave de bucket para un instante UTC real (lo pasa a hora de México). */
export function bucketKeyOf(d: Date, unit: BucketUnit): string {
  return keyFromMx(new Date(d.getTime() - MX_OFFSET_MS), unit);
}

/** Todas las claves de bucket entre from..to (hora de México), para rellenar huecos con 0. */
export function eachBucket(from: Date, to: Date, unit: BucketUnit): string[] {
  const out: string[] = [];
  const fromMx = new Date(from.getTime() - MX_OFFSET_MS);
  const toMx = new Date(to.getTime() - MX_OFFSET_MS);
  let cur: Date;
  if (unit === "hour") {
    cur = new Date(Date.UTC(fromMx.getUTCFullYear(), fromMx.getUTCMonth(), fromMx.getUTCDate(), fromMx.getUTCHours()));
  } else if (unit === "day") {
    cur = new Date(Date.UTC(fromMx.getUTCFullYear(), fromMx.getUTCMonth(), fromMx.getUTCDate()));
  } else {
    cur = new Date(Date.UTC(fromMx.getUTCFullYear(), fromMx.getUTCMonth(), 1));
  }
  let guard = 0;
  while (cur <= toMx && guard++ < 6000) {
    out.push(keyFromMx(cur, unit));
    if (unit === "hour") cur.setUTCHours(cur.getUTCHours() + 1);
    else if (unit === "day") cur.setUTCDate(cur.getUTCDate() + 1);
    else cur.setUTCMonth(cur.getUTCMonth() + 1, 1); // día=1 evita overflow (31-ene → mar)
  }
  return out;
}

export function round(n: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return round((part / total) * 100, 1);
}
