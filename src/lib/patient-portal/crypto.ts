// Utilidades criptográficas del portal del paciente. Implementa A1.
// bcryptjs ya es dependencia del repo (@types incluidos).
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt } from "crypto";

/** Hashea la contraseña con bcrypt (cost 10). */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** Compara contraseña plana contra hash bcrypt. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** sha256 hex de un string (para tokens de sesión/reset y códigos). */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Token de sesión: 48 bytes aleatorios en hex (96 chars). */
export function generateSessionToken(): string {
  return randomBytes(48).toString("hex");
}

/** Código de verificación de email: 6 dígitos (randomInt criptográfico). */
export function generateVerifyCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Token de reset de contraseña: 32 bytes aleatorios en hex. */
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}
