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

/** Latido (heartbeat): mientras la pestaña esté VISIBLE y el visitante siga
 *  interactuando, se envía un ping para refrescar lastSeenAt. Al ocultarse, al
 *  salir o al quedarse quieto, se detiene.
 *
 *  Estaba en 20 s: una pestaña abierta en el panel de una clínica mandaba 3
 *  peticiones por minuto durante toda la jornada, y como el propio ping refresca
 *  la marca de sesión (`touch`), esa sesión no caducaba nunca. A 60 s el mapa en
 *  vivo sigue sirviendo (ver LIVE_WINDOW_MS) con un tercio del tráfico. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/** Cuánto sigue latiendo una pestaña VISIBLE después de la última interacción
 *  real (click, scroll, tecla, cambio de ruta, volver a primer plano). Pasado
 *  esto el visitante está presente pero ausente: el latido calla hasta que
 *  vuelva a tocar algo. Una pestaña olvidada en primer plano deja de hablar a
 *  los ~5 min en vez de seguir toda la jornada. */
export const HEARTBEAT_IDLE_MS = 5 * 60 * 1000;
/** Flush corto tras un click: garantiza que los clicks de visitas brevísimas
 *  (rebote) lleguen aunque el beacon de salida se pierda. Los clicks en ráfaga
 *  se agrupan en un solo envío. */
export const CLICK_FLUSH_MS = 1000;

/** Ventana "en línea ahora" para el mapa en vivo. Va atada a HEARTBEAT_INTERVAL_MS:
 *  con el latido a 60 s, 150 s (2.5 latidos) aguantan un ping perdido sin que el
 *  visitante parpadee en el mapa. Con los 75 s de antes y el latido a 60 s, un
 *  solo ping perdido lo haría desaparecer.
 *  Efecto del corte por inactividad (HEARTBEAT_IDLE_MS): quien lleva 5 min sin
 *  tocar nada cae de "en vivo" ~2.5 min después. Es lo que se quiere — "en línea
 *  ahora" pasa a significar "ahí y haciendo algo", no "con la pestaña abierta". */
export const LIVE_WINDOW_MS = 150 * 1000;

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
