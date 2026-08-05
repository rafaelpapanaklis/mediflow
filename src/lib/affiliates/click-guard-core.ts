/**
 * Afiliados — DECISIÓN pura de "¿esta visita suma un clic?".
 *
 * Sin Prisma: la consulta a la BD entra inyectada (`RecentClickLookup`), así
 * que las 7 reglas de abajo se pueden probar sin base de datos
 * (`npm run test:click-guard`). El cableado real vive en click-guard.ts.
 *
 * ── EL CRITERIO, EN ORDEN ────────────────────────────────────────────────
 *
 *  0. BOTS fuera. Los generadores de vista previa (WhatsApp, Facebook…)
 *     golpean cada URL compartida y los crawlers la revisitan solos.
 *
 *  a. CON COOKIE dc_vid → dedupe por NAVEGADOR (ref + vid, 30 min). Dos
 *     navegadores distintos en la misma red son DOS clics. Ni se mira la IP.
 *
 *  b. SIN COOKIE dc_vid → visitante NUEVO por definición: la cookie se siembra
 *     en la primera visita, así que si no la trae es que nunca había estado
 *     aquí. CUENTA.
 *
 *  c. Único respaldo por IP y MUY corto (2 min), para quien tiene las cookies
 *     bloqueadas y recarga varias veces seguidas. Empata además el user-agent
 *     completo, que es lo más cerca que se puede estar de "el mismo navegador"
 *     sin cookie: tres personas distintas del mismo WiFi traen navegadores
 *     distintos y siguen contando por separado.
 *
 * ⚠️ LO QUE NO SE HACE, Y ES EL PUNTO DE TODO ESTO: dedupe por IP a 30 minutos
 * de quien no trae cookie. Con CGNAT (Telcel, AT&T) miles de teléfonos
 * comparten IP pública: dos dentistas entrando por primera vez con minutos de
 * diferencia contaban como UNO. La primera visita de cada persona es justo la
 * que importa.
 *
 * Regla de oro: esto NUNCA bloquea ni rompe nada. El bot recibe su redirección
 * y su cookie de atribución igual que siempre (si /r le fallara, WhatsApp
 * dejaría de generar la vista previa del enlace y el afiliado perdería el
 * empujón visual del link); simplemente no se le cuenta. Y si una consulta
 * truena, se cuenta y se sigue: mejor un falso positivo que perder un clic real.
 */

// Detector ÚNICO del repo, compartido con la analítica general. Aquí NO se
// escribe lógica de user-agent: si falta un bot, se amplía en ese archivo.
import { parseUserAgent } from "@/lib/analytics/ua";
// Misma normalización con la que se GUARDA el user-agent en la fila del clic:
// el respaldo corto compara contra lo almacenado, no contra el header crudo.
import { summarizeUserAgent } from "./stats";

/** Ventana de dedupe por navegador: mismo ref + mismo dc_vid = 1 solo clic. */
export const CLICK_DEDUPE_MS = 30 * 60_000;

/**
 * Respaldo por IP para visitas SIN cookie. Dos minutos frenan la recarga de
 * quien tiene las cookies bloqueadas sin castigar a dos personas distintas de
 * la misma red móvil.
 */
export const CLICK_IP_FALLBACK_MS = 2 * 60_000;

/** ¿Es un bot? Delega en `parseUserAgent` (src/lib/analytics/ua.ts). */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  return parseUserAgent(ua).device === "bot";
}

export interface ClickGuardInput {
  /** User-agent crudo de la petición (`user-agent`). */
  userAgent: string | null | undefined;
  /** referralCode/slug con el que se registraría el clic. */
  ref: string | null | undefined;
  /** sha256 truncado de la IP (`hashIp`). null cuando no hay IP disponible. */
  ipHash: string | null | undefined;
  /**
   * dc_vid que TRAÍA la petición (visitor-cookie.ts). null = el visitante no
   * tenía cookie. OJO: aquí va el valor recibido, NUNCA el recién sembrado —
   * un id nuevo no tiene historial y haría que el respaldo corto se saltara.
   */
  vid?: string | null | undefined;
  /** Inyectable para pruebas; por defecto, ahora. */
  now?: Date;
}

/** Criterios de búsqueda de un clic previo. Los ausentes no filtran. */
export interface RecentClickQuery {
  ref: string;
  since: Date;
  vid?: string;
  ipHash?: string;
  userAgent?: string | null;
}

/**
 * "¿Hay un clic previo que empate?" — `null` significa QUE LA CONSULTA FALLÓ
 * (BD caída, o la columna `vid` todavía sin aplicar), que no es lo mismo que
 * "no hay ninguno".
 */
export type RecentClickLookup = (query: RecentClickQuery) => Promise<boolean | null>;

/**
 * ¿Esta visita suma un clic?
 *
 * `false` significa "no incrementes el contador y no insertes la fila" — nada
 * más. La redirección, la cookie y el render de la página siguen su curso.
 */
export async function decideClickCount(
  input: ClickGuardInput,
  lookup: RecentClickLookup,
): Promise<boolean> {
  if (isBotUserAgent(input.userAgent)) return false;

  const ref = (input.ref ?? "").trim();
  // Sin ref no hay nada que deduplicar (ni fila que valga): se cuenta.
  if (!ref) return true;

  const now = input.now ?? new Date();
  const vid = (input.vid ?? "").trim();

  // (a) Navegador identificado: se deduplica por él y se sale. La IP NO entra
  //     en esta rama — es justo lo que rompía el conteo en redes compartidas.
  if (vid) {
    const seen = await lookup({
      ref,
      vid,
      since: new Date(now.getTime() - CLICK_DEDUPE_MS),
    });
    if (seen !== null) return !seen;
    // seen === null → la consulta no se pudo hacer (lo normal: la columna
    // `vid` aún no existe porque falta correr sql/affiliate-click-vid.sql).
    // Cae al respaldo corto de abajo, que solo usa columnas viejas.
  }

  // (b) Sin cookie = visitante nuevo → cuenta. (c) Salvo que sea el mismo
  //     navegador, desde la misma IP, recargando en los últimos 2 minutos.
  const ipHash = (input.ipHash ?? "").trim();
  if (!ipHash) return true;

  const repeat = await lookup({
    ref,
    ipHash,
    userAgent: summarizeUserAgent(input.userAgent),
    since: new Date(now.getTime() - CLICK_IP_FALLBACK_MS),
  });
  // `null` (consulta fallida) cuenta: jamás se pierde un clic por un error.
  return repeat !== true;
}
