// Constantes compartidas de analítica (cliente + servidor).

export const TRACK_ENDPOINT = "/api/track";

/** localStorage/sessionStorage keys (cliente). */
export const VISITOR_KEY = "dc_vid";
export const SESSION_KEY = "dc_sid";
export const SESSION_TS_KEY = "dc_sid_ts";

/** Sesión nueva tras 30 min de inactividad. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
/** Flush del buffer de eventos. */
export const FLUSH_INTERVAL_MS = 5000;
/** Máximo de eventos por batch (cliente y validación server). */
export const MAX_BATCH = 40;

/** Latido (heartbeat): mientras la pestaña esté visible, se envía un ping cada
 *  este intervalo para refrescar lastSeenAt. Al ocultarse/salir, se detiene. */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/** Flush corto tras un click: garantiza que los clicks de visitas brevísimas
 *  (rebote) lleguen aunque el beacon de salida se pierda. Los clicks en ráfaga
 *  se agrupan en un solo envío. */
export const CLICK_FLUSH_MS = 1000;

/** Ventana "en línea ahora" para el mapa en vivo. Con heartbeat cada 20s, 75s
 *  mantiene a un visitante presente-pero-quieto y descarta al que se fue en ~75s. */
export const LIVE_WINDOW_MS = 75 * 1000;

/** Prefijos que NUNCA se trackean (uso propio del owner + pantalla en clínica). */
export const IGNORED_PREFIXES = ["/admin", "/live"];

/** Deriva la superficie a partir del pathname. */
export function surfaceFromPath(path: string): string {
  if (path.startsWith("/dashboard")) return "dashboard";
  if (path.startsWith("/paciente")) return "portal";
  if (path.startsWith("/afiliados")) return "affiliate";
  if (path.startsWith("/proveedores")) return "supplier";
  if (path.startsWith("/laboratorios")) return "lab";
  if (path.startsWith("/admin")) return "admin";
  return "public";
}
