// Interruptor de la ingesta de analítica (/api/track) cuando la base falla por
// CONEXIÓN (ws1-t12, incidente del 1-oct-2026: el pooler de Supabase se llenó).
// La analítica es lo primero que se suelta: tras un fallo así, esta instancia
// deja de intentarlo PAUSA_TRAS_FALLO_MS, sin reintentos que sumen conexiones
// al problema. Vive en memoria del proceso: cada instancia de función la suya.

/** Cuánto deja de intentarlo esta instancia tras un fallo de conexión. */
export const PAUSA_TRAS_FALLO_MS = 60_000;

let pausadaHasta = 0;

/**
 * ¿Es un fallo de CONEXIÓN (no de datos)? P1001/P1002/P1008/P1017 = no llega o
 * se cortó; P2024 = sin conexión libre en el pool; EMAXCONN = el pooler de
 * Supabase lleno; un error de inicialización = no pudo ni conectarse.
 */
export function esFalloDeConexion(e: unknown): boolean {
  const err = e as { code?: unknown; name?: unknown; message?: unknown } | null;
  if (!err) return false;
  if (typeof err.code === "string" && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(err.code)) return true;
  if (err.name === "PrismaClientInitializationError") return true;
  const msg = typeof err.message === "string" ? err.message : "";
  return /EMAXCONN|max client connections|Timed out fetching a new connection|Can't reach database server|Connection terminated/i.test(msg);
}

/** ¿Hay que saltarse la base ahora? */
export function analiticaEnPausa(ahora = Date.now()): boolean {
  return ahora < pausadaHasta;
}

/** Anota un fallo: si es de conexión, pausa la ingesta y devuelve true. */
export function pausarSiFalloDeConexion(e: unknown, ahora = Date.now()): boolean {
  if (!esFalloDeConexion(e)) return false;
  pausadaHasta = ahora + PAUSA_TRAS_FALLO_MS;
  return true;
}

/** Solo para pruebas: vuelve a abrir la puerta. */
export function _reiniciarPausa(): void {
  pausadaHasta = 0;
}
