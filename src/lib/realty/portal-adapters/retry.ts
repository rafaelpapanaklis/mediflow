// ═══════════════════════════════════════════════════════════════════════
// POLÍTICA DE ENTREGA: reintentos con espera creciente y cupo contratado.
//
// Vive con los adaptadores y no en portals.ts por dos razones:
//   · Es parte de CÓMO se entrega a un destino, igual que el formato.
//   · portals.ts importa prisma y "server-only", así que no se puede probar
//     sin base de datos. Esto es puro y se prueba en medio segundo, que es
//     justo lo que necesita la parte más fácil de romper: el parseo de la
//     marca de reintento.
//
// ── DÓNDE VIVE EL ESTADO DEL REINTENTO ────────────────────────────────
// `realty_portal_listings` no tiene columnas `attempts` ni `nextAttemptAt`,
// y el schema es de la Ola 0: no se toca. El contador y la próxima hora se
// guardan como una MARCA al final de `lastError`, que es texto:
//
//   "El portal respondió 503.\n[dc:reintento n=3 desde=2026-08-25T18:00:00Z]"
//
// Es el mismo recurso que ya usa barber para la cancelación suave en
// `notes`. La marca se quita SIEMPRE antes de enseñar el error: el asesor ve
// "El portal respondió 503", nunca el corchete.
//
// Si algún día se agregan columnas de verdad, lo único que cambia son las
// dos funciones de abajo. Nadie más lee la marca.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Estados de RealtyPortalListing que RECLAMAN un lugar del cupo contratado.
 *
 * Vive aquí (módulo PURO) y no en portals.ts porque lo necesitan los dos
 * lados: el servidor para contar el cupo y la tabla del panel para saber si
 * pulsar una celda publica o retira. Duplicar la lista en el componente era
 * garantía de que un día se desincronizaran.
 *
 *   (sin fila)  no publicada  → no ocupa
 *   BORRADOR    pendiente     → ocupa
 *   PUBLICADO   publicada     → ocupa
 *   ERROR       con error     → ocupa A PROPÓSITO (el asesor la quiere ahí;
 *                               liberar el lugar en silencio le escondería
 *                               el problema)
 *   PAUSADO     retirada      → no ocupa
 */
export const REALTY_SLOT_STATUSES = ["BORRADOR", "PUBLICADO", "ERROR"] as const;

/** ¿Este estado de celda ocupa un lugar del cupo? */
export function claimsSlot(status: string | null | undefined): boolean {
  return !!status && (REALTY_SLOT_STATUSES as readonly string[]).includes(status);
}

/** Espera creciente entre intentos, en minutos. El último se repite. */
export const BACKOFF_MINUTES = [5, 15, 45, 135, 405, 720];

/** Intentos antes de rendirse y dejarlo en error permanente. */
export const MAX_PORTAL_ATTEMPTS = 6;

const RETRY_MARK = /\n?\[dc:reintento n=(\d+)(?: desde=([^\]]+))?\]\s*$/;

export interface PortalErrorInfo {
  /** El mensaje que ve el asesor, ya sin la marca. */
  message: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
}

/** Separa el mensaje humano de la marca de reintento. */
export function splitPortalError(raw: string | null | undefined): PortalErrorInfo {
  const value = raw ?? "";
  const m = value.match(RETRY_MARK);
  if (!m) return { message: value.trim() || null, attempts: 0, nextAttemptAt: null };
  const message = value.slice(0, m.index).trim() || null;
  const attempts = Number(m[1]);
  const at = m[2] ? new Date(m[2]) : null;
  return {
    message,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    nextAttemptAt: at && !Number.isNaN(at.getTime()) ? at : null,
  };
}

/** Vuelve a pegar la marca. `null` cuando no hay error ninguno. */
export function composePortalError(
  message: string | null,
  attempts: number,
  nextAttemptAt: Date | null,
): string | null {
  if (!message) return null;
  // La marca se pega sobre el mensaje LIMPIO: si viniera uno que ya la
  // trae (porque se recicló un lastError anterior), quedarían dos marcas y
  // el regex leería la última — el contador se congelaría en silencio.
  const clean = splitPortalError(message).message;
  if (!clean) return null;
  if (attempts <= 0) return clean;
  const when = nextAttemptAt ? ` desde=${nextAttemptAt.toISOString()}` : "";
  return `${clean}\n[dc:reintento n=${attempts}${when}]`;
}

/** Cuándo toca el siguiente intento. `null` = ya no se reintenta solo. */
export function nextAttemptFor(attempts: number, from: Date): Date | null {
  if (attempts >= MAX_PORTAL_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(0, attempts), BACKOFF_MINUTES.length - 1)];
  return new Date(from.getTime() + minutes * 60_000);
}

// ── Cupo contratado ────────────────────────────────────────────────────

export interface RealtyPortalSlotInfo {
  /** Lugares contratados. 0 o menos = sin límite declarado. */
  max: number;
  used: number;
  unlimited: boolean;
  full: boolean;
  /** Cuántos quedan. `null` cuando no hay límite. */
  remaining: number | null;
}

/**
 * `maxListings` nace en 0 (default de la columna) y eso NO quiere decir
 * "no puedes publicar nada": quiere decir "todavía no me dijiste cuántos
 * anuncios contrataste". Un agregador que lee el feed no tiene límite de
 * anuncios; un portal de paga sí, y el número lo escribe el cliente.
 */
export function slotInfo(max: number, used: number): RealtyPortalSlotInfo {
  const unlimited = !(max > 0);
  return {
    max,
    used,
    unlimited,
    full: !unlimited && used >= max,
    remaining: unlimited ? null : Math.max(0, max - used),
  };
}
