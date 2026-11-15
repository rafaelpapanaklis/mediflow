// ═══════════════════════════════════════════════════════════════════════
// CONTRASEÑA EN BARBER — lo puro del flujo (ws6-t8, auditoría 14-nov M1/M4/M5).
//
// Sin prisma, sin supabase, sin "server-only": lo importan igual las rutas del
// servidor, las pantallas del cliente y las pruebas (`tsx --test`).
//
// Qué NO vive aquí: la regla de fuerza. Es la del dental (scorePassword, la
// misma del registro, la recuperación y el cambio de /dashboard) y se importa,
// no se copia, para que las superficies no se desincronicen.
// ═══════════════════════════════════════════════════════════════════════
import { scorePassword } from "@/components/public/auth/password-strength";

// ── Rutas ───────────────────────────────────────────────────────────────

/** Pedir el enlace por correo (la cara de /barber/entrar). */
export const BARBER_RECOVER_PATH = "/barber/recuperar" as const;
/** Poner la contraseña nueva tras abrir el enlace del correo. */
export const BARBER_RESET_PATH = "/barber/restablecer" as const;
/**
 * Aterrizaje del enlace del correo. Es una copia propia de /auth/confirm (que
 * no se toca): la de allá, si el enlace caducó, manda al inicio de sesión de
 * las clínicas; ésta siempre regresa a BARBER_RESET_PATH.
 */
export const BARBER_RECOVERY_CONFIRM_PATH = "/api/barber/auth/confirmar" as const;
/** Cambio OBLIGATORIO de la contraseña temporal. Fuera de (panel): sin menú. */
export const BARBER_CHANGE_PASSWORD_PATH = "/barber/cambiar-contrasena" as const;
/** El cambio de la contraseña (obligatorio y voluntario) en el servidor. */
export const BARBER_PASSWORD_API = "/api/barber/auth/contrasena" as const;
/**
 * Lo que /barber/restablecer le cuelga a /barber/entrar al terminar. La página
 * de entrada solo compara contra este valor y pinta un texto FIJO: nada de lo
 * que viene en la URL se enseña.
 */
export const BARBER_PASSWORD_READY_PARAM = { name: "contrasena", value: "lista" } as const;

// ── Marca de «cambia tu contraseña temporal» ───────────────────────────
//
// barber_users no tiene columna mustChangePassword (y esta tarea no lleva
// SQL), así que la marca vive en Supabase Auth. En `app_metadata` y NO en
// `user_metadata`: user_metadata lo puede reescribir la propia persona desde
// el navegador con supabase.auth.updateUser({ data }), y se quitaría la marca
// sin cambiar nada. app_metadata solo lo escribe la service role.

export const BARBER_MUST_CHANGE_KEY = "barber_must_change_password" as const;

/** ¿La cuenta tiene pendiente cambiar la contraseña temporal? Solo un `true` literal cuenta. */
export function barberDebeCambiarContrasena(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== "object") return false;
  return (appMetadata as Record<string, unknown>)[BARBER_MUST_CHANGE_KEY] === true;
}

// ── Contraseña temporal del equipo ─────────────────────────────────────

/**
 * 32 símbolos (2^5): `byte % 32` reparte parejo, sin sesgo de módulo. Sin
 * I, O, 0 ni 1, que se confunden al dictarla.
 */
const ALFABETO_TEMPORAL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 8 símbolos (2^3): mismo motivo. */
const DIGITOS_TEMPORAL = "23456789";

/** Cuántos bytes aleatorios pide barberTempPasswordFromBytes. */
export const BARBER_TEMP_PASSWORD_BYTES = 9;

/**
 * La contraseña temporal, a partir de bytes que pone quien llama
 * (`crypto.randomBytes` en el servidor). PURA a propósito, como la del
 * instituto: lo que se genera solo dentro de la función no se puede probar.
 *
 * Forma `Barber-XXXXXX999!` (17 caracteres, ~39 bits): mayúsculas,
 * minúsculas, dígitos y un símbolo, así que pasa la regla de fuerza del
 * dental y cualquier política de complejidad que tenga Supabase encendida.
 */
export function barberTempPasswordFromBytes(bytes: ArrayLike<number>): string {
  if (!bytes || bytes.length < BARBER_TEMP_PASSWORD_BYTES) {
    throw new Error(`barberTempPasswordFromBytes necesita ${BARBER_TEMP_PASSWORD_BYTES} bytes aleatorios`);
  }
  let letras = "";
  for (let i = 0; i < 6; i++) letras += ALFABETO_TEMPORAL[bytes[i] % ALFABETO_TEMPORAL.length];
  let digitos = "";
  for (let i = 6; i < 9; i++) digitos += DIGITOS_TEMPORAL[bytes[i] % DIGITOS_TEMPORAL.length];
  return `Barber-${letras}${digitos}!`;
}

// ── Regla de la contraseña nueva ───────────────────────────────────────

export type ProblemaContrasena = "debil" | "larga";

/** Supabase Auth (bcrypt) no admite más de 72. */
export const BARBER_PASSWORD_MAX = 72;

/**
 * La misma regla que el dental en registro, recuperación y cambio: mínimo 8
 * y fuerza «Regular» o más (scorePassword >= 2). null = vale.
 */
export function problemaContrasenaNueva(pwd: unknown): ProblemaContrasena | null {
  const p = typeof pwd === "string" ? pwd : "";
  if (p.length > BARBER_PASSWORD_MAX) return "larga";
  if (p.length < 8 || scorePassword(p) < 2) return "debil";
  return null;
}

// ── Último acceso ──────────────────────────────────────────────────────

/**
 * Qué escribir en BarberUser.lastLogin, o null si no hay nada que escribir.
 *
 * El inicio de sesión lo hace el endpoint compartido (/api/auth/login, que no
 * se toca), así que el «entró» se lee de Supabase: `last_sign_in_at` cambia
 * en cada inicio de sesión (contraseña, enlace de recuperación) y no en cada
 * página. Se escribe solo cuando es MÁS NUEVO que lo guardado: una escritura
 * por inicio de sesión, no una por clic.
 */
export function ultimoAccesoPorEscribir(
  guardado: Date | null | undefined,
  lastSignInAt: string | null | undefined,
): Date | null {
  if (!lastSignInAt) return null;
  const entro = new Date(lastSignInAt);
  if (Number.isNaN(entro.getTime())) return null;
  if (guardado && guardado.getTime() >= entro.getTime()) return null;
  return entro;
}
