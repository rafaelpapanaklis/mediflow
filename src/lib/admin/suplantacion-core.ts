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

// ─────────────── ws1-t11 (revisión del 2-oct): volver a la sesión de antes ───────────────
//
// El fallo: Rafael es admin de plataforma Y dueño de su propia clínica en el mismo
// navegador. «Ver como clínica» hacía signOut de la sesión que hubiera (la suya
// de dueño, revocándola en Supabase) y abría la de suplantación; al salir, otro
// signOut → el navegador se quedaba SIN sesión del panel y /dashboard mandaba a
// /login. Ahora, al entrar, la sesión previa NO se revoca: su refresh token se
// guarda en COOKIE_SESION_PREVIA (httpOnly, solo viaja a /api) y al salir se
// canjea para dejar el navegador como estaba, con su clínica activa.

/** Copia de la sesión del panel que había antes de entrar. httpOnly, Path=/api. */
export const COOKIE_SESION_PREVIA = "df_sesion_previa";
export const RUTA_COOKIE_SESION_PREVIA = "/api";
/** Vive más que la suplantación (2 h) para poder volver aunque ésta haya vencido sola. */
export const VIDA_SESION_PREVIA_S = 12 * 60 * 60;

/**
 * Marca VISIBLE para el navegador (no httpOnly) con el id de la suplantación
 * activa. No da acceso a nada: solo deja que cada pestaña del panel note que la
 * sesión del navegador cambió desde que se pintó (ver pestanaDesfasada). La
 * verdad sigue en admin_impersonation_sessions.
 */
export const COOKIE_PESTANA_VER_COMO = "df_ver_como";

export interface SesionPrevia {
  /** refresh token de Supabase de la sesión previa. */
  rt: string;
  /** Su usuario de Supabase (`sub`): al canjear, si no coincide no se usa. */
  sub: string;
  /** Su clínica activa (ya verificada por HMAC), o null. */
  clinica: string | null;
}

export function empacarSesionPrevia(s: SesionPrevia): string {
  return Buffer.from(JSON.stringify({ rt: s.rt, sub: s.sub, clinica: s.clinica }), "utf8").toString("base64url");
}

export function desempacarSesionPrevia(raw: string | null | undefined): SesionPrevia | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof o.rt !== "string" || !o.rt || typeof o.sub !== "string" || !o.sub) return null;
    return { rt: o.rt, sub: o.sub, clinica: typeof o.clinica === "string" && o.clinica ? o.clinica : null };
  } catch {
    return null;
  }
}

/** `sub` (usuario de Supabase) del access token. Solo decodifica, como sessionIdDelToken. */
export function subDelToken(accessToken: string | null | undefined): string | null {
  if (!accessToken || typeof accessToken !== "string") return null;
  const partes = accessToken.split(".");
  if (partes.length !== 3) return null;
  try {
    const json = Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Al entrar, ¿qué pasa con la sesión que ya había en el navegador?
 *   · "guardar": era una sesión normal (la del propio admin en su clínica, p. ej.):
 *     NO se cierra ni se revoca; se guarda para volver a ella al salir.
 *   · "conservar": era otra suplantación (se cierra): la copia guardada sigue
 *     siendo la de antes de la PRIMERA entrada.
 *   · "borrar": no había sesión: al salir no hay a dónde volver.
 */
export function queHacerConLaPrevia(
  tipoPrevia: EstadoSuplantacion["tipo"],
  haySesion: boolean,
): "guardar" | "conservar" | "borrar" {
  if (tipoPrevia !== "normal") return "conservar";
  return haySesion ? "guardar" : "borrar";
}

/**
 * ws1-t11, punto 2. La sesión de Supabase vive en una cookie del navegador: la
 * comparten TODAS sus pestañas. Una pestaña del panel pintada antes de entrar a
 * «Ver como» (o antes de salir) sigue mostrando la clínica de entonces, pero lo
 * que guarde ya va a la sesión nueva. `claveDeLaPestana` es el id de la
 * suplantación con que se pintó ("" si ninguna); `marcaActual`, la de
 * COOKIE_PESTANA_VER_COMO ahora. Si difieren, la pestaña está desfasada.
 */
export function pestanaDesfasada(claveDeLaPestana: string, marcaActual: string | null | undefined): boolean {
  return (claveDeLaPestana || "") !== (marcaActual || "");
}

/**
 * Gracia antes de revocar en Supabase una suplantación cerrada con «Salir»
 * cuando el navegador volvió a su sesión previa (medido en QA, 3-oct): las
 * peticiones que otras pestañas tenían EN VUELO con la cookie de suplantación
 * reciben `session_not_found` de Supabase si ya está revocada, y supabase-js
 * borra entonces la cookie de sesión —que para cuando llega la respuesta ya es
 * la devuelta—: el navegador se quedaba sin sesión otra vez. La revocación es
 * limpieza: la fila cerrada ya corta la sesión en getSession/getAuthContext en
 * cada petición; solo se aplaza. 30 s: de sobra para una petición en vuelo y
 * dentro de lo que Vercel deja viva la función tras contestar (waitUntil).
 */
export const GRACIA_REVOCACION_MS = 30 * 1000;

/** ¿Ya toca revocar en Supabase esta sesión terminada? (vencida por tiempo: sí; cerrada a mano: tras la gracia). */
export function revocarYa(fila: FilaSuplantacion, ahora: number = Date.now()): boolean {
  if (!fila.endedAt) return true;
  return ahora - new Date(fila.endedAt).getTime() >= GRACIA_REVOCACION_MS;
}
