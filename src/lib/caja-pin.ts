import bcrypt from "bcryptjs";

/**
 * Seguridad de Caja por usuario (CONTRATO CAJA v2).
 *
 * - PIN de 6 dígitos EXACTOS por usuario, guardado como hash bcrypt en
 *   User.cajaPinHash. Nunca se guarda en claro ni se devuelve al cliente.
 * - canUseCaja(user): gate de acceso. SUPER_ADMIN siempre; el resto solo si
 *   tiene User.canAccessCaja = true.
 *
 * Usado por /api/caja/pin, /api/caja/open y /api/caja/close.
 */

const BCRYPT_ROUNDS = 10;
const PIN_REGEX = /^\d{6}$/;

/** true si `pin` es EXACTAMENTE 6 dígitos (0-9). */
export function isValidCajaPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_REGEX.test(pin);
}

/** Hashea un PIN de Caja con bcrypt. Lanza si el formato no es 6 dígitos. */
export async function hashCajaPin(pin: string): Promise<string> {
  if (!isValidCajaPin(pin)) throw new Error("El PIN debe ser exactamente 6 dígitos.");
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

/**
 * Verifica un PIN contra su hash bcrypt. Devuelve false (nunca lanza) si el
 * hash es null/vacío, el PIN está mal formado o bcrypt falla.
 */
export async function verifyCajaPin(pin: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  if (!isValidCajaPin(pin)) return false;
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}

/**
 * ¿Este usuario puede operar la Caja? SUPER_ADMIN siempre; el resto solo si
 * tiene canAccessCaja = true. Acepta la forma laxa de ctx.user (User de Prisma).
 */
export function canUseCaja(
  user: { role?: string | null; canAccessCaja?: boolean | null } | null | undefined,
): boolean {
  if (!user) return false;
  return user.role === "SUPER_ADMIN" || user.canAccessCaja === true;
}
