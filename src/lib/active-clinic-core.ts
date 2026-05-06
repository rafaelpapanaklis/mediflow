import { createHmac, timingSafeEqual } from "crypto";

export const ACTIVE_CLINIC_COOKIE = "activeClinicId";

export function activeClinicSecret() {
  return process.env.COOKIE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "mediflow-cookie-fallback-dev-only";
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

export function packClinicCookie(clinicId: string, secret = activeClinicSecret()) {
  return `${clinicId}.${sign(clinicId, secret)}`;
}

export function unpackClinicCookie(raw: string | undefined, secret = activeClinicSecret()): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 1) return null;
  const value = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(value, secret);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return value;
}

// Decide qué clinicId activar tras login/OAuth-callback para usuarios
// con >= 1 clínica. `current` debe ser el clinicId ya verificado por
// HMAC (resultado de unpackClinicCookie), no el raw de la cookie.
//
// - kept:  la cookie actual apunta a una clínica que el usuario sí
//          posee → la conservamos para preservar la elección entre
//          sesiones del mismo browser.
// - reset: cookie ausente, HMAC inválido, o cookie de impersonate /
//          cuenta cruzada → sembramos a ownedClinicIds[0]. El caller
//          debe pasar la lista ordenada por createdAt asc para que
//          coincida con el "default" histórico de getCurrentUser.
//
// Sin esto, post-login borraba la cookie incondicionalmente para
// usuarios multi-clínica y getCurrentUser caía al fallback "primer
// createdAt" en cada request (ver bug Vercel 2026-05-05T18:12, 18
// clínicas afectadas).
export function pickActiveClinicId(
  current: string | null,
  ownedClinicIds: string[],
): { clinicId: string; reason: "kept" | "reset" } {
  if (current && ownedClinicIds.includes(current)) {
    return { clinicId: current, reason: "kept" };
  }
  return { clinicId: ownedClinicIds[0], reason: "reset" };
}
