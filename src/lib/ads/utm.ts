// UTM del primer y del último clic — WS1-T10.
//
// Cuando la URL de llegada trae utm_source / utm_medium / utm_campaign /
// utm_content, el SERVIDOR siembra dos cookies de 90 días (httpOnly, mismo
// criterio que dc_ads / dc_meta):
//   · `dc_utm1` — el PRIMER toque con UTM. Una vez escrita no se pisa.
//   · `dc_utm2` — el ÚLTIMO toque con UTM. Se reemplaza cuando llega uno distinto;
//                 repetir exactamente los mismos UTM no renueva la fecha.
// Al registrarse, guardarClickAdsDeLaAlta las lee y las guarda ligadas a la
// clínica (clinic_ads_clicks, sql/ws1-t10-meta-origen.sql).
//
// Los UTM no son identificadores de persona, pero son texto que escribe quien
// arma el enlace: se recortan, se limpian de caracteres de control y se acotan.
//
// Módulo PURO (sin red, sin base, sin window): se prueba con `tsx --test`.

import { ADS_CLICK_COOKIE_MAX_AGE } from "./click-ids";

export const UTM_PRIMERO_COOKIE = "dc_utm1";
export const UTM_ULTIMO_COOKIE = "dc_utm2";
export const UTM_COOKIE_MAX_AGE = ADS_CLICK_COOKIE_MAX_AGE;
const MAX_AGE_MS = UTM_COOKIE_MAX_AGE * 1000;
const FUTURO_TOLERADO_MS = 24 * 60 * 60 * 1000;
export const UTM_MAX_LARGO = 120;

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export interface UtmToque {
  utm: Utm;
  /** Epoch ms del toque (la primera vez que vimos esa combinación). */
  at: number;
}

const CLAVES = ["source", "medium", "campaign", "content"] as const;
const PARAMETRO: Record<(typeof CLAVES)[number], string> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  content: "utm_content",
};
// Clave corta dentro de la cookie.
const CORTA: Record<(typeof CLAVES)[number], string> = { source: "s", medium: "m", campaign: "c", content: "k" };

/** Sin caracteres de control ni espacios de los bordes, acotado; vacío → undefined. */
export function limpiarUtm(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const limpio = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, UTM_MAX_LARGO);
  return limpio === "" ? undefined : limpio;
}

/** Los UTM de un URLSearchParams o de un objeto (el cuerpo del POST). */
export function extraerUtm(origen: URLSearchParams | Record<string, unknown> | null | undefined): Utm {
  const out: Utm = {};
  if (!origen) return out;
  for (const k of CLAVES) {
    const crudo = origen instanceof URLSearchParams ? origen.get(PARAMETRO[k]) : (origen as Record<string, unknown>)[PARAMETRO[k]];
    const v = limpiarUtm(crudo);
    if (v) out[k] = v;
  }
  return out;
}

export function tieneUtm(utm: Utm | null | undefined): boolean {
  return !!utm && CLAVES.some((k) => !!utm[k]);
}

const igualesUtm = (a: Utm, b: Utm) => CLAVES.every((k) => (a[k] ?? "") === (b[k] ?? ""));

const VERSION = "1";

/** Serializa un toque para Set-Cookie (URLSearchParams: solo caracteres seguros); null si no hay UTM. */
export function empaquetarUtm(toque: UtmToque): string | null {
  const utm: Utm = {};
  for (const k of CLAVES) {
    const v = limpiarUtm(toque.utm[k]);
    if (v) utm[k] = v;
  }
  if (!tieneUtm(utm)) return null;
  const at = Number.isFinite(toque.at) ? Math.floor(toque.at) : 0;
  if (at <= 0) return null;
  const p = new URLSearchParams();
  p.set("v", VERSION);
  p.set("t", String(at));
  for (const k of CLAVES) if (utm[k]) p.set(CORTA[k], utm[k] as string);
  return p.toString();
}

/** Parsea una cookie de UTM. null si está corrupta, es de otra versión o ya pasaron 90 días. */
export function parsearUtm(raw: string | null | undefined, ahora: number = Date.now()): UtmToque | null {
  try {
    const p = new URLSearchParams((raw ?? "").trim());
    if (p.get("v") !== VERSION) return null;
    const at = Number.parseInt(p.get("t") ?? "", 10);
    if (!Number.isFinite(at) || at <= 0) return null;
    const edad = ahora - at;
    if (edad > MAX_AGE_MS || edad < -FUTURO_TOLERADO_MS) return null;
    const utm: Utm = {};
    for (const k of CLAVES) {
      const v = limpiarUtm(p.get(CORTA[k]));
      if (v) utm[k] = v;
    }
    return tieneUtm(utm) ? { utm, at } : null;
  } catch {
    return null;
  }
}

/** Primer y último toque de una petición. Nunca lanza. */
export function utmDeCookies(
  leer: (nombre: string) => string | null | undefined,
  ahora: number = Date.now(),
): { primero: UtmToque | null; ultimo: UtmToque | null } {
  try {
    const primero = parsearUtm(leer(UTM_PRIMERO_COOKIE), ahora);
    const ultimo = parsearUtm(leer(UTM_ULTIMO_COOKIE), ahora);
    // Si solo sobrevive una, es a la vez el primero y el último que conocemos.
    return { primero: primero ?? ultimo, ultimo: ultimo ?? primero };
  } catch {
    return { primero: null, ultimo: null };
  }
}

/**
 * Qué cookies escribir para un toque con UTM recién llegado. `primero` y
 * `ultimo` son el valor nuevo de cada cookie, o null si no hay nada que escribir
 * (sin UTM; el primero ya existía; o el último es idéntico al vigente).
 */
export function cookiesParaUtm(
  nuevos: Utm,
  actuales: { primero?: string | null; ultimo?: string | null },
  ahora: number = Date.now(),
): { primero: string | null; ultimo: string | null } {
  if (!tieneUtm(nuevos)) return { primero: null, ultimo: null };
  const valor = empaquetarUtm({ utm: nuevos, at: ahora });
  const primeroVigente = parsearUtm(actuales.primero, ahora);
  const ultimoVigente = parsearUtm(actuales.ultimo, ahora);
  return {
    primero: primeroVigente ? null : valor,
    ultimo: ultimoVigente && igualesUtm(ultimoVigente.utm, nuevos) ? null : valor,
  };
}
