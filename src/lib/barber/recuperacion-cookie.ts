// ═══════════════════════════════════════════════════════════════════════
// «Vienes de un enlace de recuperación» — la cookie que separa el
// restablecer de Barber de una sesión cualquiera (revisión ws6-t2 ronda 7, M1).
//
// Sin ella, /barber/restablecer cambiaba la contraseña con CUALQUIER sesión
// abierta y sin pedir la actual: en la tableta del mostrador con la sesión
// del dueño, cualquiera se quedaba con la cuenta.
//
// La deja SOLO /api/barber/auth/confirmar, después de canjear el enlace del
// correo, y va ligada a ESE usuario:
//   valor  = <supabaseId>.<expira (s)>.<HMAC-SHA256>
//   httpOnly · Secure · SameSite=Lax · Path=/barber/restablecer · 10 min
// La exige el servidor (la página y POST /barber/restablecer/guardar) y se
// borra al usarse.
//
// Solo servidor (node:crypto). Sin "server-only" para poder probarla con tsx.
// ═══════════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from "node:crypto";

export const BARBER_RECOVERY_COOKIE = "dcb_recuperacion" as const;
/** Cuánto dura: lo justo para escribir la contraseña nueva. */
export const BARBER_RECOVERY_TTL_S = 10 * 60;
/** Solo viaja a la pantalla y a su ruta de guardar, nada más del sitio. */
export const BARBER_RECOVERY_COOKIE_PATH = "/barber/restablecer" as const;

export const BARBER_RECOVERY_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: BARBER_RECOVERY_COOKIE_PATH,
  maxAge: BARBER_RECOVERY_TTL_S,
};

/** Para borrarla: mismo nombre y misma ruta, caducada. */
export const BARBER_RECOVERY_COOKIE_BORRAR = { ...BARBER_RECOVERY_COOKIE_OPTS, maxAge: 0 };

type Env = Record<string, string | undefined>;

/**
 * El secreto del servidor. SIN respaldo fijo a propósito: con uno escrito en
 * el código cualquiera podría firmar la cookie. Si no hay secreto, no se
 * firma nada y el restablecer no se abre (falla cerrado).
 */
function secreto(env: Env): string | null {
  return env.COOKIE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function firma(contenido: string, clave: string): Buffer {
  // Prefijo propio: esta firma no sirve para ninguna otra cookie de la casa.
  return createHmac("sha256", clave).update(`barber-recuperacion:${contenido}`).digest();
}

/** El valor de la cookie para ese usuario, o null si no hay secreto. */
export function firmarRecuperacion(
  supabaseId: string,
  ahoraMs: number = Date.now(),
  env: Env = process.env,
): string | null {
  const clave = secreto(env);
  if (!clave || !supabaseId || supabaseId.includes(".")) return null;
  const expira = Math.floor(ahoraMs / 1000) + BARBER_RECOVERY_TTL_S;
  const contenido = `${supabaseId}.${expira}`;
  return `${contenido}.${firma(contenido, clave).toString("base64url")}`;
}

/** ¿La cookie es nuestra, sigue viva y es de ESTE usuario? */
export function recuperacionValidaPara(
  valor: string | null | undefined,
  supabaseId: string | null | undefined,
  ahoraMs: number = Date.now(),
  env: Env = process.env,
): boolean {
  const clave = secreto(env);
  if (!clave || !valor || !supabaseId) return false;
  const partes = valor.split(".");
  if (partes.length !== 3) return false;
  const [id, expiraTxt, firmaTxt] = partes;
  if (id !== supabaseId) return false;
  if (!/^\d+$/.test(expiraTxt)) return false;
  const expira = Number(expiraTxt);
  const ahora = Math.floor(ahoraMs / 1000);
  if (expira <= ahora || expira > ahora + BARBER_RECOVERY_TTL_S) return false;
  const esperada = firma(`${id}.${expiraTxt}`, clave);
  const recibida = Buffer.from(firmaTxt, "base64url");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}
