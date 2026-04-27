import "server-only";

import bcrypt from "bcryptjs";

const COOKIE_PREFIX = "mf_live_unlock_";

export const LIVE_UNLOCK_TTL_HOURS = 12;

export function liveCookieName(slug: string): string {
  // Sanitiza slug: solo a-z, 0-9, hyphen, underscore.
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${COOKIE_PREFIX}${safe}`;
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
