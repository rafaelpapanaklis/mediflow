/**
 * Login de clínica en el SERVIDOR (auditoría 30-sep-2026, M4) — la parte pura.
 *
 * Antes el formulario validaba la contraseña desde el navegador directo contra
 * Supabase y avisaba después a /api/auth/login-attempt con `fail`/`success`. El
 * bloqueo era orientativo: el navegador decidía si llamar, cualquiera podía
 * mandar cinco `fail` con el correo del dueño y dejarlo fuera 30 minutos, y un
 * `success` sin sesión borraba el bloqueo de cualquier cuenta.
 *
 * Ahora la contraseña la comprueba POST /api/auth/login: mira el bloqueo
 * persistente (failban, Upstash) por IP y por cuenta ANTES de llamar a
 * Supabase, cuenta el fallo él mismo y solo él lo limpia tras un acierto real.
 *
 * Mensajes: el mismo texto para «no existe», «contraseña mala», «correo sin
 * confirmar» o cualquier otro error de Supabase, y el bloqueo aplica igual a un
 * correo que no existe: la respuesta no dice si la cuenta existe.
 */

export const SCOPE_LOGIN_CLINICA = "clinic-login";

export const MENSAJE_CREDENCIALES = "Correo o contraseña incorrectos.";
export const MENSAJE_BLOQUEO = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
export const MENSAJE_INVALIDO = "Escribe tu correo y tu contraseña.";

/** Tope de largo: un payload enorme no llega a Supabase (ni al hash). */
const MAX_EMAIL = 254;
const MAX_PASSWORD = 1024;

export type EntradaLogin =
  | { ok: true; email: string; password: string }
  | { ok: false };

/** Normaliza y valida el cuerpo. El correo va en minúsculas y sin espacios: es la llave del bloqueo. */
export function leerEntradaLogin(body: unknown): EntradaLogin {
  if (!body || typeof body !== "object") return { ok: false };
  const b = body as { email?: unknown; password?: unknown };
  if (typeof b.email !== "string" || typeof b.password !== "string") return { ok: false };
  const email = b.email.trim().toLowerCase();
  const password = b.password;
  if (!email || !password) return { ok: false };
  if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) return { ok: false };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false };
  return { ok: true, email, password };
}

/**
 * ¿La petición viene de esta misma web? (CSRF de login: que otra página no
 * pueda iniciar sesión en el navegador de alguien con una cuenta ajena.)
 * Mismo criterio que el middleware aplica a /api/admin: Origin o, si falta,
 * Referer, contra Host.
 */
export function mismoOrigen(headers: { get(n: string): string | null }): boolean {
  const host = headers.get("host");
  if (!host) return false;
  const origin = headers.get("origin");
  const referer = headers.get("referer");
  try {
    const fuente = origin ? new URL(origin).host : referer ? new URL(referer).host : null;
    return fuente === host;
  } catch {
    return false;
  }
}
