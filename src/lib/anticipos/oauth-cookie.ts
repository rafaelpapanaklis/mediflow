// La cookie que ata el ida y vuelta del OAuth de Mercado Pago (WS1-T5).
//
// Al salir hacia Mercado Pago se guarda aquí el `state` (anti-CSRF) y el
// `code_verifier` de PKCE, más la clínica y la persona que inició la conexión.
// Al volver, el callback exige que el `state` de la URL sea el de la cookie y
// que la sesión sea la MISMA clínica y la MISMA persona: un enlace de callback
// armado por un tercero no conecta su cuenta de MP a nuestra clínica.
//
// httpOnly, 10 minutos, solo para /api/mercadopago/oauth. PURO salvo `crypto`.

import { timingSafeEqual } from "crypto";

export const COOKIE_OAUTH_MP = "dc_mp_oauth";
export const COOKIE_OAUTH_MP_PATH = "/api/mercadopago/oauth";
export const COOKIE_OAUTH_MP_MAX_AGE_S = 600;

export interface IdaOAuth {
  state: string;
  verifier: string;
  clinicId: string;
  userId: string;
}

export function empacarIda(ida: IdaOAuth): string {
  return Buffer.from(JSON.stringify(ida), "utf8").toString("base64url");
}

export function desempacarIda(valor: string | null | undefined): IdaOAuth | null {
  if (!valor) return null;
  try {
    const o = JSON.parse(Buffer.from(valor, "base64url").toString("utf8")) as Partial<IdaOAuth>;
    if (
      typeof o.state === "string" && o.state &&
      typeof o.verifier === "string" && o.verifier &&
      typeof o.clinicId === "string" && o.clinicId &&
      typeof o.userId === "string" && o.userId
    ) {
      return { state: o.state, verifier: o.verifier, clinicId: o.clinicId, userId: o.userId };
    }
  } catch {
    /* cookie rota = sin ida */
  }
  return null;
}

/** Comparación en tiempo constante del `state`. */
export function mismoState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
