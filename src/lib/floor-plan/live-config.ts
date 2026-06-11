import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

const COOKIE_PREFIX = "mf_live_unlock_";

export const LIVE_UNLOCK_TTL_HOURS = 12;

export function liveCookieName(slug: string): string {
  // Sanitiza slug: solo a-z, 0-9, hyphen, underscore.
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${COOKIE_PREFIX}${safe}`;
}

/**
 * Secreto para firmar la cookie de unlock del modo En Vivo. Mismo patrón
 * que la cookie de clínica activa (active-clinic-core.ts): usa COOKIE_SECRET
 * si existe; si no, la service-role key (siempre presente en prod); y como
 * último recurso un fallback SOLO para desarrollo local. Nunca se hardcodea
 * un secreto real.
 */
function liveUnlockSecret(): string {
  return (
    process.env.COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "mediflow-cookie-fallback-dev-only"
  );
}

/** HMAC-SHA256 truncado a 32 hex (128 bits), igual que active-clinic-core. */
function signLiveUnlock(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

/**
 * Emite el valor firmado de la cookie de unlock: `"<expMs>.<firma>"`, donde
 * la firma cubre `"<slug>:<expMs>"`. Así queda atada al slug (no es
 * transferible a otra clínica) y a su expiración (no se puede extender sin
 * invalidarla). Vence a las LIVE_UNLOCK_TTL_HOURS.
 */
export function packLiveUnlockCookie(
  slug: string,
  now: number = Date.now(),
  secret: string = liveUnlockSecret(),
): string {
  const exp = now + LIVE_UNLOCK_TTL_HOURS * 60 * 60 * 1000;
  const mac = signLiveUnlock(`${slug}:${exp}`, secret);
  return `${exp}.${mac}`;
}

/**
 * Verifica el valor de la cookie de unlock contra el slug. Devuelve true
 * SOLO si la firma es válida (timing-safe) y no ha expirado. Cualquier valor
 * ausente, malformado, con firma incorrecta o vencido → false, sin lanzar.
 * Las cookies legacy con valor "1" caen aquí como inválidas: el usuario
 * vuelve a teclear el password una vez.
 */
export function verifyLiveUnlockCookie(
  raw: string | undefined | null,
  slug: string,
  now: number = Date.now(),
  secret: string = liveUnlockSecret(),
): boolean {
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx < 1) return false;
  const exp = Number(raw.slice(0, idx));
  const mac = raw.slice(idx + 1);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  const expected = signLiveUnlock(`${slug}:${exp}`, secret);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  // Firma válida; exigir además que no haya expirado.
  return exp > now;
}

export async function hashLivePassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyLivePassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Genera un slug seguro para URL pública desde el nombre de la clínica.
 * Lowercase, deduce diacríticos, espacios → guión, solo a-z 0-9 y -.
 */
export function suggestSlug(clinicName: string): string {
  return clinicName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/** Validador de slug: 3-50 chars, lowercase a-z 0-9 y guiones. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug);
}
