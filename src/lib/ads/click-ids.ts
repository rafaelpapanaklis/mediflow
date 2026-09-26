// Identificadores de clic de Google Ads (gclid, y gbraid/wbraid de iOS) — WS1-T6.
//
// POR QUÉ EXISTE: el SPEI directo no pasa por /dashboard/suspended/success, así
// que no hay pixel que lo mida. La única forma de atribuirlo a la campaña es
// tener guardado el clic con el que llegó la persona, y solo existe al llegar:
// si no se guarda en el alta, ese pago no se podrá atribuir nunca.
//
// FLUJO: landing con ?gclid= → <AdsClickCapture/> avisa a POST /api/ads/click →
// el SERVIDOR siembra la cookie `dc_ads` (90 días) → al registrarse,
// /api/auth/register y /register-oauth leen la cookie y la guardan ligada a la
// clínica (tabla clinic_ads_clicks, sql/ws1-t6-ads-clics.sql).
//
// Cookie SIEMPRE server-side (Set-Cookie), nunca document.cookie: Safari (ITP)
// borra a los 7 días las escritas por JavaScript. Mismo criterio que dc_aff
// (@/lib/affiliates/attribution-cookie). Como respaldo, el alta también lee
// `_gcl_aw`, la cookie que gtag.js escribe solo con el gclid.
//
// REGLA: ÚLTIMO clic gana (es como atribuye Google Ads). Repetir el MISMO gclid
// no renueva ni mueve la fecha del clic.
//
// Módulo PURO (sin red, sin base, sin window): se prueba con `tsx --test`.

export const ADS_CLICK_COOKIE = "dc_ads";
export const ADS_CLICK_COOKIE_DAYS = 90;
export const ADS_CLICK_COOKIE_MAX_AGE = ADS_CLICK_COOKIE_DAYS * 24 * 60 * 60;
const MAX_AGE_MS = ADS_CLICK_COOKIE_MAX_AGE * 1000;
/** Reloj del navegador adelantado: se tolera un día; más allá la fecha es basura (rompería la importación sin conexión). */
const FUTURO_TOLERADO_MS = 24 * 60 * 60 * 1000;

/** Cookie de Google (gtag.js) con el gclid: "GCL.<epoch s>.<gclid>". */
export const GOOGLE_GCLID_COOKIE = "_gcl_aw";

/** Los ids de Google son base64url: letras, dígitos, "_" y "-". Sin puntos (el formato de la cookie depende de eso). */
const ID_RE = /^[A-Za-z0-9_-]{10,255}$/;

export interface AdsClickIds {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
}

export interface AdsClick {
  ids: AdsClickIds;
  /** Epoch ms del clic (la primera vez que lo vimos). */
  at: number;
}

export type FuenteClick = "dc_ads" | "_gcl_aw";

const CLAVES = ["gclid", "gbraid", "wbraid"] as const;

function valido(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/** Toma de un objeto o de un URLSearchParams SOLO los ids con forma válida. */
export function extraerClickIds(origen: URLSearchParams | Record<string, unknown> | null | undefined): AdsClickIds {
  const out: AdsClickIds = {};
  if (!origen) return out;
  for (const k of CLAVES) {
    const v = origen instanceof URLSearchParams ? origen.get(k) : (origen as Record<string, unknown>)[k];
    if (valido(v)) out[k] = v;
  }
  return out;
}

export function tieneClickId(ids: AdsClickIds | null | undefined): boolean {
  return !!ids && CLAVES.some((k) => !!ids[k]);
}

// Formato plano "v1.<gclid>.<gbraid>.<wbraid>.<epochMs>" (segmentos vacíos si no hay).
const VERSION = "v1";

/** Serializa para Set-Cookie; null si no hay ningún id válido. */
export function empaquetarClick(click: AdsClick): string | null {
  const ids = extraerClickIds(click.ids as Record<string, unknown>);
  if (!tieneClickId(ids)) return null;
  const at = Number.isFinite(click.at) ? Math.floor(click.at) : 0;
  if (at <= 0) return null;
  return [VERSION, ids.gclid ?? "", ids.gbraid ?? "", ids.wbraid ?? "", at].join(".");
}

/** Parsea la cookie `dc_ads`. null si está corrupta, es de otra versión o ya pasaron 90 días. */
export function parsearClick(raw: string | null | undefined, ahora: number = Date.now()): AdsClick | null {
  try {
    const partes = (raw ?? "").trim().split(".");
    if (partes.length !== 5 || partes[0] !== VERSION) return null;
    const [, g, b, w, t] = partes;
    for (const v of [g, b, w]) if (v !== "" && !valido(v)) return null;
    const ids = extraerClickIds({ gclid: g, gbraid: b, wbraid: w });
    if (!tieneClickId(ids)) return null;
    const at = Number.parseInt(t, 10);
    if (!Number.isFinite(at) || at <= 0) return null;
    const edad = ahora - at;
    if (edad > MAX_AGE_MS || edad < -FUTURO_TOLERADO_MS) return null;
    return { ids, at };
  } catch {
    return null;
  }
}

/** Parsea `_gcl_aw` de Google: "GCL.<epoch s>.<gclid>". Solo trae gclid. */
export function parsearGclAw(raw: string | null | undefined, ahora: number = Date.now()): AdsClick | null {
  try {
    const partes = (raw ?? "").trim().split(".");
    if (partes.length !== 3 || partes[0] !== "GCL") return null;
    const segundos = Number.parseInt(partes[1], 10);
    if (!Number.isFinite(segundos) || segundos <= 0) return null;
    if (!valido(partes[2])) return null;
    const at = segundos * 1000;
    const edad = ahora - at;
    if (edad > MAX_AGE_MS || edad < -FUTURO_TOLERADO_MS) return null;
    return { ids: { gclid: partes[2] }, at };
  } catch {
    return null;
  }
}

/** El clic vigente de una petición: primero `dc_ads`, y `_gcl_aw` como respaldo. Nunca lanza. */
export function clickDeCookies(
  leer: (nombre: string) => string | null | undefined,
  ahora: number = Date.now(),
): (AdsClick & { fuente: FuenteClick }) | null {
  try {
    const propia = parsearClick(leer(ADS_CLICK_COOKIE), ahora);
    if (propia) return { ...propia, fuente: "dc_ads" };
    const google = parsearGclAw(leer(GOOGLE_GCLID_COOKIE), ahora);
    if (google) return { ...google, fuente: "_gcl_aw" };
  } catch {
    // una cookie rara jamás rompe un alta
  }
  return null;
}

/**
 * Qué hacer con un clic que acaba de llegar, dada la cookie que ya tenía el
 * navegador: null si no hay nada que escribir (ids inválidos, o es el MISMO
 * gclid ya guardado: no se renueva la fecha), o el valor nuevo de la cookie.
 */
export function cookieParaClic(
  nuevos: AdsClickIds,
  cookieActual: string | null | undefined,
  ahora: number = Date.now(),
): string | null {
  if (!tieneClickId(nuevos)) return null;
  const actual = parsearClick(cookieActual, ahora);
  if (actual) {
    const mismo = CLAVES.every((k) => (actual.ids[k] ?? "") === (nuevos[k] ?? ""));
    if (mismo) return null;
  }
  return empaquetarClick({ ids: nuevos, at: ahora });
}
