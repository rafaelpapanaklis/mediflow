/**
 * «Ver como clínica» — sesión de suplantación propia (auditoría 30-sep-2026, M5).
 * Parte PURA (sin base ni Next): duración, nota, lectura del `session_id` del
 * token de Supabase y la decisión de si una sesión sigue viva.
 *
 * El fallo: el admin de plataforma abría una sesión NORMAL del dueño (magic
 * link, 30 días renovables, escritura total), por un GET con efectos y con la
 * nota de auditoría «si se puede». Nada distinguía esa sesión de una del dueño.
 *
 * Ahora (src/lib/admin/suplantacion.ts + POST /api/admin/impersonate):
 *   · la sesión se registra en `admin_impersonation_sessions` por el
 *     `session_id` de Supabase (no cambia al refrescar el token), con el admin,
 *     la clínica, la nota y su vencimiento;
 *   · dura DURACION_SUPLANTACION_MS (2 h): al vencer, getSession/getAuthContext
 *     la tratan como sin sesión en cada petición, aunque el navegador conserve
 *     las cookies de Supabase, y se revoca en Supabase;
 *   · sin el registro guardado no se entra. El motivo ya NO se pide (ws1-t11,
 *     2-oct, pedido de Rafael: un clic): si no llega, se guarda NOTA_AUTOMATICA.
 *
 * Lo que NO cambia (pausa de Rafael del 1-oct): cómo aparecen en audit_logs /
 * Movimientos las acciones hechas durante la suplantación.
 */

export const DURACION_SUPLANTACION_MS = 2 * 60 * 60 * 1000;
export const NOTA_MAX = 500;
/** El motivo que se registra cuando el admin no escribe ninguno (el caso normal). */
export const NOTA_AUTOMATICA = "Entrada de soporte";

export const SQL_SUPLANTACION = "sql/ws1-t4-suplantacion-admin.sql";

/** La nota del admin, opcional: espacios colapsados y acotada; sin texto, NOTA_AUTOMATICA. */
export function limpiarNota(raw: unknown): string {
  if (typeof raw !== "string") return NOTA_AUTOMATICA;
  const t = raw.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, NOTA_MAX) : NOTA_AUTOMATICA;
}

/**
 * `session_id` del access token de Supabase (claim estándar de GoTrue). Solo se
 * DECODIFICA: quien llama ya validó la sesión con `auth.getUser()` en la misma
 * petición. `null` si el token no tiene la forma esperada.
 */
export function sessionIdDelToken(accessToken: string | null | undefined): string | null {
  if (!accessToken || typeof accessToken !== "string") return null;
  const partes = accessToken.split(".");
  if (partes.length !== 3) return null;
  try {
    const json = Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}

export interface FilaSuplantacion {
  id: string;
  adminUserId: string;
  adminEmail: string;
  clinicId: string;
  targetUserId: string;
  expiresAt: Date;
  endedAt: Date | null;
}

export type EstadoSuplantacion =
  | { tipo: "normal" }                                   // no es una sesión de suplantación
  | { tipo: "activa"; fila: FilaSuplantacion }
  | { tipo: "terminada"; fila: FilaSuplantacion };       // vencida o cerrada: no vale

/** La regla: vence por tiempo o por cierre explícito; lo que no está en la tabla es una sesión normal. */
export function estadoDe(fila: FilaSuplantacion | null, ahora: number = Date.now()): EstadoSuplantacion {
  if (!fila) return { tipo: "normal" };
  if (fila.endedAt) return { tipo: "terminada", fila };
  if (new Date(fila.expiresAt).getTime() <= ahora) return { tipo: "terminada", fila };
  return { tipo: "activa", fila };
}
