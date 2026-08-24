import { createHmac, timingSafeEqual } from "crypto";
import { canTransition } from "@/lib/barber/types";
import type { BarberAppointmentStatus } from "@/lib/barber/types";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — núcleo PURO del portal del cliente.

   Sin prisma, sin next/headers: la firma de la sesión, la política de
   cancelación y los parámetros del código de acceso. Se puede probar sin
   base de datos (src/lib/barber/__tests__/portal-core.test.ts). La capa con
   prisma y cookies es src/lib/barber/client-portal.ts, que re-exporta todo
   esto.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Parámetros ──────────────────────────────────────────────────────────

export const BARBER_PORTAL_COOKIE = "dcb_portal";
/** Vida del código de acceso. Corta a propósito. */
export const PORTAL_CODE_TTL_MIN = 10;
/** Intentos fallidos contra UN código antes de quemarlo. */
export const PORTAL_CODE_MAX_ATTEMPTS = 5;
/** Códigos que un mismo cliente puede pedir dentro de la ventana. */
export const PORTAL_CODE_MAX_PER_WINDOW = 3;
export const PORTAL_CODE_WINDOW_MIN = 15;
/** Duración de la sesión del portal. */
export const PORTAL_SESSION_DAYS = 14;
/**
 * Sellos para un corte gratis. La tarjeta de lealtad (feature `loyalty`)
 * todavía no tiene dónde configurarse por barbería: cuando exista, esta
 * constante se reemplaza por ese valor y este es el único punto a tocar.
 */
export const BARBER_LOYALTY_GOAL = 10;
/**
 * Hasta cuántas horas antes puede el cliente cancelar solo. Misma nota que
 * arriba: es la política por defecto hasta que la barbería pueda fijar la
 * suya.
 */
export const BARBER_CANCEL_WINDOW_HOURS = 2;

/** Copy ÚNICO de "pedí un código". Idéntico exista o no el cliente. */
export const PORTAL_CODE_SENT_MESSAGE =
  "Si tu número está registrado en esta barbería, te llega un código por WhatsApp.";

// ── Lista BLANCA de salida del portal ───────────────────────────────────

/**
 * Los ÚNICOS campos de la barbería que puede ver el cliente en su portal.
 * Misma idea que PUBLIC_SHOP_FIELDS en ./booking-core: lista blanca, no
 * lista negra, y probada en __tests__/salida-publica.test.ts.
 */
export const PORTAL_SHOP_FIELDS = [
  "id",
  "name",
  "slug",
  "phone",
  "address",
  "city",
  "state",
  "timezone",
  "locale",
  "logoUrl",
  "branchName",
] as const;

export interface PortalShopDTO {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  branchName: string | null;
}

/** Recorta CUALQUIER fila a la lista blanca. Lo que no está, no sale. */
export function pickPortalShop(row: Record<string, unknown>): PortalShopDTO {
  const out: Record<string, unknown> = {};
  for (const key of PORTAL_SHOP_FIELDS) out[key] = row[key] ?? null;
  return out as unknown as PortalShopDTO;
}

// ── Sesión del portal (cookie firmada, sin tabla) ───────────────────────

/**
 * El vertical no tiene tabla de sesiones de cliente (y esta ola no puede
 * crearla), así que la sesión va FIRMADA en la propia cookie: HMAC-SHA256
 * sobre "v1.clientId.barbershopId.expira". Sin la llave del servidor no se
 * puede fabricar una válida, y el contenido es solo un par de ids — nada
 * secreto viaja al navegador.
 */
export function portalSecret(): string {
  return (
    process.env.COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dalecontrol-barber-portal-dev-only"
  );
}

function sign(payload: string): string {
  return createHmac("sha256", portalSecret()).update(payload).digest("hex");
}

export interface PortalSession {
  clientId: string;
  barbershopId: string;
  expiresAt: Date;
}

/** Arma el valor de la cookie. */
export function packPortalSession(
  clientId: string,
  barbershopId: string,
  now: Date = new Date(),
): { value: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + PORTAL_SESSION_DAYS * 86_400_000);
  const payload = `v1.${clientId}.${barbershopId}.${expiresAt.getTime()}`;
  return { value: `${payload}.${sign(payload)}`, expiresAt };
}

/**
 * Lee y valida el valor de la cookie. Null ante cualquier duda: firma que no
 * cuadra, versión desconocida, caducada o formato raro.
 */
export function readPortalSession(raw: string | undefined | null): PortalSession | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 1) return null;
  const payload = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(payload);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const [version, clientId, barbershopId, expMs] = payload.split(".");
  if (version !== "v1" || !clientId || !barbershopId) return null;
  const expiresAt = new Date(Number(expMs));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
  return { clientId, barbershopId, expiresAt };
}

export function portalCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

// ── Política de cancelación ─────────────────────────────────────────────

/**
 * ¿La cita todavía se puede cancelar desde el portal? Dos condiciones: que
 * la máquina de estados del vertical permita la transición y que falte más
 * que la ventana de cortesía. Un cambio de última hora se habla con la
 * barbería, no se hace solo.
 */
export function canClientCancel(
  status: BarberAppointmentStatus,
  startAt: Date,
  now: Date = new Date(),
): boolean {
  if (!canTransition(status, "CANCELLED")) return false;
  return startAt.getTime() - now.getTime() > BARBER_CANCEL_WINDOW_HOURS * 3_600_000;
}
