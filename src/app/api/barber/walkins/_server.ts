// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — piezas de servidor propias de la FILA VIRTUAL.
//
// Aquí vive lo que el panel y la página pública del QR comparten: cómo se
// reparte el número de fila sin que dos personas se lleven el mismo, cómo
// se resuelve una barbería a partir de su slug (sin sesión) y el punto de
// extensión del aviso por WhatsApp que conecta T7.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { persistentRateLimitKey } from "@/lib/failban";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { barberiaAlCorriente } from "@/lib/barber/cobros";
import { getBarberPlan } from "@/lib/barber/plans";
import type { BarberWalkInStatus } from "@/lib/barber/types";
import { walkInDayStart } from "@/lib/barber/fila-del-dia";

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
      parentId: true,
    },
  });
  if (!shop) return { shop: null, error: "NOT_FOUND" };
  // Mismo criterio que el panel: matriz al corriente (cobros.ts).
  if (!shop.isActive || !(await barberiaAlCorriente(shop))) {
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

/**
 * Condición de «está en la fila HOY»: esperando o llamado Y anotado desde
 * la medianoche local (ver fila-del-dia.ts). Úsala en todo lo que cuente
 * la fila: la foto, el «ya estás formado» y el tope de la página pública.
 */
export function activeWalkInWhere(shopId: string, timezone: string, now: Date = new Date()) {
  return {
    barbershopId: shopId,
    status: { in: ACTIVE_WALKIN_STATUSES },
    joinedAt: { gte: walkInDayStart(timezone, now) },
  };
}

/** Foto de la fila activa (la de HOY) + los datos con los que se estima la espera. */
export async function loadQueueSnapshot(shopId: string, timezone: string): Promise<QueueSnapshot> {
  const [rows, barbers, services] = await Promise.all([
    prisma.barberWalkIn.findMany({
      where: activeWalkInWhere(shopId, timezone),
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

// ── Frenos de los endpoints públicos ───────────────────────────────────

/**
 * Rate-limit de la página pública de la fila: el freno PERSISTENTE del
 * dental (persistentRateLimitKey de @/lib/failban — ventana deslizante en
 * Upstash, compartida entre instancias). Antes era un Map en memoria por
 * instancia: en Vercel cada instancia contaba por su lado y el tope real
 * era varias veces el escrito. Sin las variables de Upstash, failban cae a
 * memoria igual que antes (no empeora nada).
 *
 * true = se pasó del tope.
 */
export async function publicRateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const ok = await persistentRateLimitKey(`barber-walkin:${key}`, max, windowSec);
  return !ok;
}

/**
 * Cuántas personas EN ESPERA puede tener la fila para que alguien se anote
 * desde la calle (el QR). Pasado eso, la página pide acercarse al
 * mostrador; el personal sigue pudiendo anotar desde el panel.
 *
 * Cuenta TODAS las entradas WAITING, no solo las que llegaron por el QR: la
 * fila no guarda de dónde vino cada quien (y el schema no se toca aquí).
 * El número es propuesta pendiente de Rafael (30 mientras tanto).
 */
export const PUBLIC_WALKIN_WAITING_CAP = 30;

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
