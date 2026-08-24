// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — piezas de servidor propias de la FILA VIRTUAL.
//
// Aquí vive lo que el panel y la página pública del QR comparten: cómo se
// reparte el número de fila sin que dos personas se lleven el mismo, cómo
// se resuelve una barbería a partir de su slug (sin sesión) y el punto de
// extensión del aviso por WhatsApp que conecta T7.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import {
  barberPlanHasFeature,
  isBarbershopSubscriptionActive,
} from "@/lib/barber/plan-shared";
import { getBarberPlan } from "@/lib/barber/plans";
import type { BarberWalkInStatus } from "@/lib/barber/types";

/** Feature de plan que abre la fila virtual (Avanzado y Profesional). */
export const WALKIN_FEATURE = "walkinQueue" as const;

// ── Número de fila a prueba de escaneos simultáneos ────────────────────

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2002";
}

export interface NewWalkIn {
  clientName: string;
  phone: string | null;
  barberId: string | null;
}

/**
 * Crea la entrada de fila calculando su `position` como MAX+1.
 *
 * `position` es un CONTADOR MONOTÓNICO por barbería: nunca se recicla y
 * nunca se renumera (renumerar con gente formada es como alguien pierde su
 * lugar). Lo que ve el cliente es su RANGO dentro de la fila activa, que se
 * calcula al vuelo con walkInRank().
 *
 * Dos QR escaneados a la vez leen el mismo MAX; el índice único
 * `barber_walkin_position_uniq` (sql/barber_agenda.sql) hace que el segundo
 * choque y aquí se reintenta con el siguiente número.
 */
export async function createWalkIn(shopId: string, data: NewWalkIn, attempts = 6) {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const agg = await prisma.barberWalkIn.aggregate({
      where: { barbershopId: shopId },
      _max: { position: true },
    });
    const position = (agg._max.position ?? 0) + 1 + i;
    try {
      return await prisma.barberWalkIn.create({
        data: {
          barbershopId: shopId,
          clientName: data.clientName,
          phone: data.phone,
          barberId: data.barberId,
          status: "WAITING",
          position,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error("No se pudo asignar el número de fila.");
}

// ── Barbería por slug, para la página pública del QR ───────────────────

export interface PublicShop {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  logoUrl: string | null;
}

export type PublicShopResult =
  | { shop: PublicShop; error: null }
  | { shop: null; error: "NOT_FOUND" | "CLOSED" | "NO_FEATURE" };

/**
 * Resuelve la barbería de /barber/fila/[slug] SIN sesión. Se cierra sola si
 * la barbería está desactivada, si dejó de pagar o si su plan no incluye la
 * fila virtual: una página pública no puede seguir viva por inercia.
 *
 * Devuelve SOLO campos públicos. Nunca la fila completa de Barbershop (que
 * trae tokens de WhatsApp y datos de Stripe).
 */
export async function resolvePublicShop(slug: string): Promise<PublicShopResult> {
  const shop = await prisma.barbershop.findFirst({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      logoUrl: true,
      isActive: true,
      plan: true,
      subscriptionStatus: true,
    },
  });
  if (!shop) return { shop: null, error: "NOT_FOUND" };
  if (!shop.isActive || !isBarbershopSubscriptionActive(shop)) {
    return { shop: null, error: "CLOSED" };
  }
  const plan = await getBarberPlan(shop.plan);
  if (!barberPlanHasFeature(plan, WALKIN_FEATURE)) {
    return { shop: null, error: "NO_FEATURE" };
  }
  return {
    shop: {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      timezone: shop.timezone,
      logoUrl: shop.logoUrl,
    },
    error: null,
  };
}

// ── Estado de la fila (lo comparten panel y página pública) ────────────

export const ACTIVE_WALKIN_STATUSES: BarberWalkInStatus[] = ["WAITING", "CALLED"];

export interface QueueSnapshot {
  rows: {
    id: string;
    clientName: string;
    phone: string | null;
    barberId: string | null;
    status: BarberWalkInStatus;
    position: number;
    joinedAt: Date;
    calledAt: Date | null;
    servedAt: Date | null;
  }[];
  /** Barberos activos = sillas que despachan la fila. */
  chairs: number;
  /** Duración promedio de los servicios activos de la barbería. */
  avgServiceMin: number;
}

/** Foto de la fila activa + los datos con los que se estima la espera. */
export async function loadQueueSnapshot(shopId: string): Promise<QueueSnapshot> {
  const [rows, barbers, services] = await Promise.all([
    prisma.barberWalkIn.findMany({
      where: { barbershopId: shopId, status: { in: ACTIVE_WALKIN_STATUSES } },
      orderBy: { position: "asc" },
    }),
    prisma.barber.count({ where: { barbershopId: shopId, isActive: true } }),
    prisma.barberService.findMany({
      where: { barbershopId: shopId, isActive: true },
      select: { durationMin: true },
    }),
  ]);

  const avg =
    services.length > 0
      ? Math.max(5, Math.round(services.reduce((a, s) => a + s.durationMin, 0) / services.length))
      : 30;

  return { rows, chairs: Math.max(1, barbers), avgServiceMin: avg };
}

// ── Rate-limit en memoria para los endpoints públicos ──────────────────
// Se reinicia con cada arranque del runtime. Es un freno anti-abuso, no una
// garantía dura (mismo criterio que /api/barber/auth/register).

const buckets = new Map<string, { count: number; resetAt: number }>();

export function publicRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
