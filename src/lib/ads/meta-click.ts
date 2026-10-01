// Clic de Meta (fbclid) y cookies _fbc / _fbp — WS1-T10.
//
// Mismo patrón que click-ids.ts (Google), en un módulo aparte para no tocar el
// comportamiento de Google Ads.
//
// FLUJO: landing con ?fbclid= → <AdsClickCapture/> avisa a POST /api/ads/click →
// el SERVIDOR siembra la cookie `dc_meta` (90 días, httpOnly) → al registrarse,
// guardarClickAdsDeLaAlta la lee y guarda fbclid + fbc + fbp ligados a la
// clínica en clinic_ads_clicks (sql/ws1-t10-meta-origen.sql).
//
// POR QUÉ `dc_meta` Y NO `_fbc`: fbevents.js (el píxel) escribe `_fbc` desde
// JavaScript en el navegador. Una `_fbc` httpOnly del servidor con otros
// atributos competiría con esa y el píxel acabaría pisándola o duplicándola.
// La nuestra es server-side por lo mismo que `dc_ads`: Safari (ITP) borra a los
// 7 días las cookies escritas por JS. `_fbc` del píxel solo se usa de respaldo.
//
// FORMATO fbc de Meta: «fb.<índice de subdominio>.<epoch en MILISEGUNDOS>.<fbclid>»
// con el fbclid TAL CUAL llegó (distingue mayúsculas): si se altera, Meta no lo
// reconoce. El índice es 1 para dalecontrol.com (dominio de segundo nivel).
//
// REGLA: ÚLTIMO clic gana. Repetir el MISMO fbclid no renueva la fecha.
//
// Módulo PURO (sin red, sin base, sin window): se prueba con `tsx --test`.

import { ADS_CLICK_COOKIE_MAX_AGE } from "./click-ids";

export const META_CLICK_COOKIE = "dc_meta";
export const META_CLICK_COOKIE_MAX_AGE = ADS_CLICK_COOKIE_MAX_AGE;
const MAX_AGE_MS = META_CLICK_COOKIE_MAX_AGE * 1000;
/** Reloj adelantado: se tolera un día; más allá la fecha es basura. */
const FUTURO_TOLERADO_MS = 24 * 60 * 60 * 1000;

/** Cookies que escribe el píxel de Meta (fbevents.js). */
export const META_FBC_COOKIE = "_fbc";
export const META_FBP_COOKIE = "_fbp";

/** fbclid: base64url con algún punto o guion bajo ocasional. Largo holgado (los reales pasan de 60). */
const FBCLID_RE = /^[A-Za-z0-9_.-]{10,512}$/;
/** _fbp: «fb.<n>.<epoch ms>.<aleatorio de 8-12 dígitos>». */
const FBP_RE = /^fb\.\d{1,2}\.\d{10,13}\.\d{5,20}$/;

export interface MetaClick {
  fbclid: string;
  /** Epoch ms del clic (la primera vez que lo vimos). */
  at: number;
}

export type FuenteMeta = "dc_meta" | "_fbc";

function valido(v: unknown): v is string {
  return typeof v === "string" && FBCLID_RE.test(v);
}

/** El fbclid de la URL (URLSearchParams u objeto), solo si tiene forma válida. */
export function extraerFbclid(origen: URLSearchParams | Record<string, unknown> | null | undefined): string | undefined {
  if (!origen) return undefined;
  const v = origen instanceof URLSearchParams ? origen.get("fbclid") : (origen as Record<string, unknown>).fbclid;
  return valido(v) ? v : undefined;
}

function enVentana(at: number, ahora: number): boolean {
  if (!Number.isFinite(at) || at <= 0) return false;
  const edad = ahora - at;
  return edad <= MAX_AGE_MS && edad >= -FUTURO_TOLERADO_MS;
}

/** El valor fbc de Meta: «fb.1.<ms>.<fbclid>». */
export function armarFbc(click: MetaClick): string {
  return `fb.1.${Math.floor(click.at)}.${click.fbclid}`;
}

// Cookie propia: "v1.<epochMs>.<fbclid>" (el fbclid va al final porque puede traer puntos).
const VERSION = "v1";

/** Serializa para Set-Cookie; null si el fbclid o la fecha no sirven. */
export function empaquetarMeta(click: MetaClick): string | null {
  if (!valido(click.fbclid)) return null;
  const at = Number.isFinite(click.at) ? Math.floor(click.at) : 0;
  if (at <= 0) return null;
  return `${VERSION}.${at}.${click.fbclid}`;
}

/** Parsea `dc_meta`. null si está corrupta, es de otra versión o ya pasaron 90 días. */
export function parsearMeta(raw: string | null | undefined, ahora: number = Date.now()): MetaClick | null {
  try {
    const texto = (raw ?? "").trim();
    const i1 = texto.indexOf(".");
    const i2 = texto.indexOf(".", i1 + 1);
    if (i1 < 0 || i2 < 0 || texto.slice(0, i1) !== VERSION) return null;
    const at = Number.parseInt(texto.slice(i1 + 1, i2), 10);
    const fbclid = texto.slice(i2 + 1);
    if (!valido(fbclid) || !enVentana(at, ahora)) return null;
    return { fbclid, at };
  } catch {
    return null;
  }
}

/** Parsea `_fbc` del píxel: «fb.<n>.<ms>.<fbclid>». */
export function parsearFbc(raw: string | null | undefined, ahora: number = Date.now()): MetaClick | null {
  try {
    const m = /^fb\.\d{1,2}\.(\d{10,13})\.(.+)$/.exec((raw ?? "").trim());
    if (!m) return null;
    const at = Number.parseInt(m[1], 10);
    if (!valido(m[2]) || !enVentana(at, ahora)) return null;
    return { fbclid: m[2], at };
  } catch {
    return null;
  }
}

/** El clic de Meta vigente de una petición: primero `dc_meta`, y `_fbc` del píxel como respaldo. Nunca lanza. */
export function metaClickDeCookies(
  leer: (nombre: string) => string | null | undefined,
  ahora: number = Date.now(),
): (MetaClick & { fuente: FuenteMeta }) | null {
  try {
    const propia = parsearMeta(leer(META_CLICK_COOKIE), ahora);
    if (propia) return { ...propia, fuente: "dc_meta" };
    const pixel = parsearFbc(leer(META_FBC_COOKIE), ahora);
    if (pixel) return { ...pixel, fuente: "_fbc" };
  } catch {
    // una cookie rara jamás rompe un alta
  }
  return null;
}

/**
 * El fbc para la API de Conversiones: «fb.1.<ms>.<fbclid>» o null.
 * Primero `dc_meta`, respaldo `_fbc` del píxel. Si la `_fbc` del píxel ya trae
 * el formato de Meta se devuelve tal cual (conserva su índice y su fecha).
 */
export function fbcDeCookies(
  leer: (nombre: string) => string | null | undefined,
  ahora: number = Date.now(),
): string | null {
  const click = metaClickDeCookies(leer, ahora);
  if (!click) return null;
  if (click.fuente === "_fbc") return (leer(META_FBC_COOKIE) ?? "").trim();
  return armarFbc(click);
}

/** La `_fbp` del navegador, validada («fb.1.<ms>.<aleatorio>»), o null. */
export function fbpDeCookies(leer: (nombre: string) => string | null | undefined): string | null {
  try {
    const v = (leer(META_FBP_COOKIE) ?? "").trim();
    return FBP_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Qué hacer con un fbclid recién llegado, dada la cookie actual: null si no hay
 * nada que escribir (inválido, o es el MISMO fbclid: no se renueva la fecha), o
 * el valor nuevo de la cookie.
 */
export function cookieParaMeta(
  fbclid: string | undefined,
  cookieActual: string | null | undefined,
  ahora: number = Date.now(),
): string | null {
  if (!valido(fbclid)) return null;
  const actual = parsearMeta(cookieActual, ahora);
  if (actual && actual.fbclid === fbclid) return null;
  return empaquetarMeta({ fbclid, at: ahora });
}
