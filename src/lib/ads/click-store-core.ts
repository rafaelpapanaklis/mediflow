// Guardar el clic de Google Ads ligado a la clínica recién creada (WS1-T6), y —
// WS1-T10 — el de Meta (fbclid / fbc / fbp) y los UTM del primer y del último
// toque, en la MISMA fila de clinic_ads_clicks.
//
// Núcleo SIN Prisma: recibe el `exec` que ejecuta el INSERT, así se prueba sin
// base. click-store.ts lo cablea a prisma.$executeRaw.
//
// TOLERA QUE LA TABLA NO EXISTA: sql/ws1-t6-ads-clics.sql la crea Rafael a mano
// y el código puede desplegarse antes. Por eso es SQL crudo y no un modelo de
// Prisma (un modelo sin tabla, o una columna nueva en clinics, tumbaría
// consultas). Cualquier error se traga: un alta NUNCA falla por medir.
//
// TOLERA QUE FALTEN LAS COLUMNAS DE WS1-T10 (sql/ws1-t10-meta-origen.sql): si la
// tabla existe pero sin ellas (42703), se reintenta con el INSERT de siempre
// (solo Google), así el clic de Google no se pierde por desplegar antes del SQL.

import { clickDeCookies, tieneClickId, type FuenteClick } from "./click-ids";
import { armarFbc, fbpDeCookies, metaClickDeCookies, type FuenteMeta } from "./meta-click";
import { tieneUtm, utmDeCookies, type Utm } from "./utm";

export type ResultadoGuardarClick = "guardado" | "sin-clic" | "sin-tabla" | "sin-columnas" | "error";

export type PlataformaClick = "google" | "meta";

export interface FilaClick {
  clinicId: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  /** Cuándo dio el clic de GOOGLE (para la importación sin conexión); null si no vino de Google. */
  clickedAt: Date | null;
  source: FuenteClick | FuenteMeta | "dc_utm";
  // ── WS1-T10 (solo en el INSERT completo) ──
  /** Plataforma del ÚLTIMO clic (si hubo de las dos, la más reciente); null si solo hubo UTM. */
  platform?: PlataformaClick | null;
  fbclid?: string | null;
  /** «fb.1.<ms>.<fbclid>», listo para la API de Conversiones. */
  fbc?: string | null;
  /** La cookie _fbp del navegador al registrarse. */
  fbp?: string | null;
  metaClickedAt?: Date | null;
  utmSourceFirst?: string | null;
  utmMediumFirst?: string | null;
  utmCampaignFirst?: string | null;
  utmContentFirst?: string | null;
  utmFirstAt?: Date | null;
  utmSourceLast?: string | null;
  utmMediumLast?: string | null;
  utmCampaignLast?: string | null;
  utmContentLast?: string | null;
  utmLastAt?: Date | null;
}

/** Cuál INSERT se está pidiendo: el completo (con las columnas de ws1-t10) o el de siempre (solo Google). */
export type ModoInsert = "completo" | "basico";

/**
 * Arma las filas a guardar desde las cookies de la petición, sin tocar la base.
 * `completa` lleva todo; `basica` es el INSERT de WS1-T6 (solo si hubo clic de
 * Google). Ambas null si no hay nada que guardar: sin clic ni UTM no se escribe.
 */
export function armarFilasClick(
  clinicId: string,
  leerCookie: (nombre: string) => string | null | undefined,
  ahora: number = Date.now(),
): { completa: FilaClick; basica: FilaClick | null } | null {
  const google = clickDeCookies(leerCookie, ahora);
  const g = google && tieneClickId(google.ids) ? google : null;
  const meta = metaClickDeCookies(leerCookie, ahora);
  const { primero, ultimo } = utmDeCookies(leerCookie, ahora);
  const conUtm = (t: typeof primero) => (t && tieneUtm(t.utm) ? t : null);
  const u1 = conUtm(primero);
  const u2 = conUtm(ultimo);
  if (!g && !meta && !u1 && !u2) return null;

  const base: FilaClick = {
    clinicId,
    gclid: g?.ids.gclid ?? null,
    gbraid: g?.ids.gbraid ?? null,
    wbraid: g?.ids.wbraid ?? null,
    clickedAt: g ? new Date(g.at) : null,
    source: g ? g.fuente : meta ? meta.fuente : "dc_utm",
  };
  const utm = (t: typeof u1, k: keyof Utm) => t?.utm[k] ?? null;
  const completa: FilaClick = {
    ...base,
    platform: g && meta ? (meta.at > g.at ? "meta" : "google") : meta ? "meta" : g ? "google" : null,
    fbclid: meta?.fbclid ?? null,
    fbc: meta ? armarFbc(meta) : null,
    fbp: fbpDeCookies(leerCookie),
    metaClickedAt: meta ? new Date(meta.at) : null,
    utmSourceFirst: utm(u1, "source"),
    utmMediumFirst: utm(u1, "medium"),
    utmCampaignFirst: utm(u1, "campaign"),
    utmContentFirst: utm(u1, "content"),
    utmFirstAt: u1 ? new Date(u1.at) : null,
    utmSourceLast: utm(u2, "source"),
    utmMediumLast: utm(u2, "medium"),
    utmCampaignLast: utm(u2, "campaign"),
    utmContentLast: utm(u2, "content"),
    utmLastAt: u2 ? new Date(u2.at) : null,
  };
  return { completa, basica: g ? base : null };
}

/**
 * ¿El error es «falta la tabla clinic_ads_clicks»? Postgres 42P01 (Prisma lo
 * envuelve en P2010) o el mensaje de esa relación. Una columna o un tipo que no
 * existen NO cuentan: ese diagnóstico sería falso.
 */
export function esTablaInexistente(err: unknown): boolean {
  const e = err as { meta?: { code?: string; message?: string }; message?: string } | null;
  const texto = `${e?.meta?.message ?? ""} ${e?.message ?? ""}`;
  if (e?.meta?.code === "42P01") return true;
  // «column "x" of relation "clinic_ads_clicks" does not exist» NO es la tabla que falta.
  return !/\bcolumn\b/i.test(texto) && /relation "?(public\.)?"?clinic_ads_clicks"? does not exist/i.test(texto);
}

/** ¿El error es «falta una COLUMNA» (42703)? Es lo que pasa si el código de WS1-T10 corre antes de su SQL. */
export function esColumnaInexistente(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string; message?: string }; message?: string } | null;
  if (e?.meta?.code === "42703" || e?.code === "42703") return true;
  const texto = `${e?.meta?.message ?? ""} ${e?.message ?? ""}`;
  return /\bcolumn\b[^]*\bdoes not exist\b/i.test(texto);
}

let avisoSinTabla = false;
let avisoSinColumnas = false;

export async function guardarClickAdsDeAlta(
  exec: (fila: FilaClick, modo: ModoInsert) => Promise<unknown>,
  input: {
    /** clinicId de la clínica que ACABA de crear el servidor, nunca de la petición. */
    clinicId: string;
    leerCookie: (nombre: string) => string | null | undefined;
  },
): Promise<ResultadoGuardarClick> {
  try {
    const { clinicId, leerCookie } = input;
    if (!clinicId) return "error";
    const filas = armarFilasClick(clinicId, leerCookie);
    if (!filas) return "sin-clic";
    try {
      await exec(filas.completa, "completo");
      return "guardado";
    } catch (err) {
      if (!esColumnaInexistente(err) || esTablaInexistente(err)) throw err;
      // La tabla existe pero sin las columnas de ws1-t10: lo de Google se guarda como siempre.
      if (!avisoSinColumnas) {
        avisoSinColumnas = true;
        console.warn("[ads-click] faltan las columnas de Meta/UTM en clinic_ads_clicks: aplica sql/ws1-t10-meta-origen.sql (el alta sigue igual)");
      }
      if (!filas.basica) return "sin-columnas";
      await exec(filas.basica, "basico");
      return "guardado";
    }
  } catch (err) {
    if (esTablaInexistente(err)) {
      if (!avisoSinTabla) {
        avisoSinTabla = true;
        console.warn("[ads-click] falta la tabla clinic_ads_clicks: aplica sql/ws1-t6-ads-clics.sql y sql/ws1-t10-meta-origen.sql (el alta sigue igual)");
      }
      return "sin-tabla";
    }
    console.warn("[ads-click] no se pudo guardar el clic de Ads:", (err as Error)?.message ?? err);
    return "error";
  }
}
