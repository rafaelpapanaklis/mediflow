import { createHmac, timingSafeEqual } from "crypto";
import { activeClinicSecret } from "@/lib/active-clinic-core";
import { TWO_FA_OK_MAX_AGE_SECONDS } from "./two-factor-constants";

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

/**
 * ¿Este valor crudo de df_2fa prueba que ESTA persona pasó el 2FA de ESTA clínica
 * dentro de la ventana de vigencia? Función pura: es la decisión que toma
 * `hasValidTwoFactorCookie` una vez que ya tiene el valor de la cookie en la mano,
 * separada de la lectura de `cookies()` para poder probarla sin un request.
 *
 * Las tres condiciones son independientes y todas obligatorias:
 *   1. firma HMAC válida (si no, es una cookie fabricada),
 *   2. el par (persona, clínica) del token coincide con el que se pregunta — la
 *      cookie de otra persona, o la de la misma persona en OTRA clínica, no
 *      sirve; por eso cambiar de sede vuelve a pedir el segundo factor,
 *   3. la emisión no es futura ni más vieja que la vigencia (12 h).
 */
export function isTwoFactorTokenValidFor(
  raw: string | undefined,
  supabaseId: string,
  clinicId: string,
  nowMs: number = Date.now(),
  maxAgeSeconds: number = TWO_FA_OK_MAX_AGE_SECONDS,
): boolean {
  const data = unpackTwoFactorToken(raw);
  if (!data) return false;
  if (data.supabaseId !== supabaseId || data.clinicId !== clinicId) return false;
  const ageMs = nowMs - data.iatMs;
  if (ageMs < 0 || ageMs > maxAgeSeconds * 1000) return false;
  return true;
}
