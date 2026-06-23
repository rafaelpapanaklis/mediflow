import { createHmac, timingSafeEqual } from "crypto";
import { activeClinicSecret } from "@/lib/active-clinic-core";

// Firma/verificación de la cookie df_2fa. Mismo patrón HMAC-sha256 (hex, 32
// chars) que active-clinic-core, y REUSA el MISMO secreto (COOKIE_SECRET ||
// SUPABASE_SERVICE_ROLE_KEY || fallback dev) — así no hay env nueva que pedir.
// Si algún día se rota COOKIE_SECRET, ambas cookies se invalidan juntas y los
// usuarios solo re-hacen 2FA: degradación aceptable, nunca un bypass.
//
// Este módulo usa node:crypto ⇒ SOLO Node (route handlers + layout RSC). NO lo
// importes desde el middleware (Edge); usa two-factor-constants para nombres.

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

export interface TwoFactorTokenData {
  supabaseId: string;
  clinicId: string;
  iatMs: number;
}

// Atado a la membresía (persona + clínica) y al instante de emisión, para poder
// caducar y para que cambiar de clínica re-exija el 2FA de esa clínica.
export function packTwoFactorToken(
  supabaseId: string,
  clinicId: string,
  iatMs: number,
  secret = activeClinicSecret(),
): string {
  const value = `${supabaseId}.${clinicId}.${iatMs}`;
  return `${value}.${sign(value, secret)}`;
}

export function unpackTwoFactorToken(
  raw: string | undefined,
  secret = activeClinicSecret(),
): TwoFactorTokenData | null {
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
  // supabaseId (UUID) y clinicId (cuid) no contienen puntos ⇒ split en 3 partes
  // es seguro.
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [supabaseId, clinicId, iatStr] = parts;
  const iatMs = Number(iatStr);
  if (!supabaseId || !clinicId || !Number.isFinite(iatMs)) return null;
  return { supabaseId, clinicId, iatMs };
}
