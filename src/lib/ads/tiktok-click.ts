// Clic de TikTok (ttclid) y cookie _ttp — ws1-t5 (punto 1 de la tanda ws7).
//
// Mismo patrón que meta-click.ts: landing con ?ttclid= → <AdsClickCapture/> se lo
// avisa a POST /api/ads/click → el SERVIDOR siembra `dc_tt` (90 días, httpOnly).
// Al iniciar el pago, el checkout copia ttclid y _ttp a la metadata de la sesión
// de Stripe para que el webhook (sin navegador) mande el CompletePayment por la
// Events API con ellos. `_ttp` la escribe el píxel de TikTok en el navegador.
//
// REGLA: ÚLTIMO clic gana. Módulo PURO (sin red, sin base, sin window).

import { ADS_CLICK_COOKIE_MAX_AGE } from "./click-ids";

export const TIKTOK_CLICK_COOKIE = "dc_tt";
export const TIKTOK_CLICK_COOKIE_MAX_AGE = ADS_CLICK_COOKIE_MAX_AGE;
/** Cookie que escribe el píxel de TikTok (identificador del navegador). */
export const TIKTOK_TTP_COOKIE = "_ttp";

/** ttclid y _ttp son cadenas opacas alfanuméricas con guiones/puntos/guion bajo. */
const ID_RE = /^[A-Za-z0-9_.-]{8,512}$/;

function valido(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/** El ttclid de la URL (URLSearchParams u objeto), solo si tiene forma válida. */
export function extraerTtclid(origen: URLSearchParams | Record<string, unknown> | null | undefined): string | undefined {
  if (!origen) return undefined;
  const v = origen instanceof URLSearchParams ? origen.get("ttclid") : (origen as Record<string, unknown>).ttclid;
  return valido(v) ? v : undefined;
}

type LeerCookie = (nombre: string) => string | null | undefined;

/** El ttclid vigente de una petición (cookie `dc_tt`) o null. Nunca lanza. */
export function ttclidDeCookies(leer: LeerCookie): string | null {
  try {
    const v = (leer(TIKTOK_CLICK_COOKIE) ?? "").trim();
    return valido(v) ? v : null;
  } catch {
    return null;
  }
}

/** La `_ttp` del píxel de TikTok, validada, o null. Nunca lanza. */
export function ttpDeCookies(leer: LeerCookie): string | null {
  try {
    const v = (leer(TIKTOK_TTP_COOKIE) ?? "").trim();
    return valido(v) ? v : null;
  } catch {
    return null;
  }
}

/** Qué escribir en `dc_tt`: null si el ttclid no sirve o es el MISMO que ya está. */
export function cookieParaTiktok(ttclid: string | undefined, cookieActual: string | null | undefined): string | null {
  if (!valido(ttclid)) return null;
  if ((cookieActual ?? "").trim() === ttclid) return null;
  return ttclid;
}
