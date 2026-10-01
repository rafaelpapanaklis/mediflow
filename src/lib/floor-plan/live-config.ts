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

/** Mínimo de la contraseña del Modo En Vivo para las NUEVAS y los cambios (M12). */
export const LIVE_PASSWORD_MIN = 8;
export const LIVE_PASSWORD_MAX = 200;
/**
 * Costo bcrypt de las contraseñas nuevas. Las de antes se hashearon con 10 y
 * podían ser de 4 caracteres: el costo del hash en la base es la marca (sin
 * columna nueva) que dice «esta contraseña es anterior a la regla de 8».
 */
export const LIVE_PASSWORD_ROUNDS = 12;

export async function hashLivePassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, LIVE_PASSWORD_ROUNDS);
}

/** Texto de la contraseña nueva válido: 8–200 caracteres. */
export function esContrasenaLiveValida(plain: unknown): plain is string {
  return typeof plain === "string" && plain.length >= LIVE_PASSWORD_MIN && plain.length <= LIVE_PASSWORD_MAX;
}

/**
 * true si el hash guardado es de ANTES de la regla de 8 caracteres (costo bcrypt
 * menor al actual): sigue funcionando, pero hay que pedirle a la clínica que la
 * actualice. Sin hash (sin contraseña) no aplica.
 */
export function contrasenaLiveEsAntigua(hash: string | null | undefined): boolean {
  if (!hash) return false;
  const m = /^\$2[abxy]\$(\d{2})\$/.exec(hash);
  if (!m) return true; // formato desconocido: mejor pedir que la cambien
  return Number(m[1]) < LIVE_PASSWORD_ROUNDS;
}

/**
 * ¿Puede quedar así la clínica? Con el Modo En Vivo ENCENDIDO tiene que haber
 * contraseña (la nueva, o la que ya había y no se está quitando). Apagado, no
 * hace falta. Devuelve el código de error o null.
 */
export function problemaDeContrasenaLive(o: {
  enabledFinal: boolean;
  hayContrasenaGuardada: boolean;
  nueva: string | null | undefined; // undefined = no se toca; null/"" = quitar
}): "password_required" | "password_too_short" | null {
  const quitando = o.nueva === null || o.nueva === "";
  if (typeof o.nueva === "string" && o.nueva !== "" && !esContrasenaLiveValida(o.nueva)) {
    return "password_too_short";
  }
  const quedara = quitando ? false : (typeof o.nueva === "string" ? true : o.hayContrasenaGuardada);
  if (o.enabledFinal && !quedara) return "password_required";
  return null;
}

/**
 * La fecha que pide `?date=` a la vista pública: solo hoy, ayer o mañana EN LA
 * ZONA DE LA CLÍNICA (lo que un tablero necesita al cruzar la medianoche). Más
 * allá, nadie recorre la agenda histórica ni la futura de una clínica por URL.
 */
export function fechaLiveEnRango(dateISO: string, hoyISO: string): boolean {
  const aMs = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const dias = Math.abs(aMs(dateISO) - aMs(hoyISO)) / 86_400_000;
  return Number.isFinite(dias) && dias <= 1;
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
