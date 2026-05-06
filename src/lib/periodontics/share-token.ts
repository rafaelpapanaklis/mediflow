// Periodontics — generador de tokens para PatientShareLink. SPEC §11, COMMIT 8.

import { randomBytes } from "node:crypto";

/**
 * Token URL-safe de 32 caracteres aprox (24 bytes en base64url). 192 bits
 * de entropía: muy por encima del umbral de adivinabilidad para enlaces
 * públicos no auth con expiración.
 */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Validación liviana: chars `A-Za-z0-9_-`, 32 caracteres exactos.
 */
export function isValidShareTokenShape(t: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(t);
}

/**
 * Default: 30 días. La UI puede sobrescribir con un Date explícito.
 */
export function defaultShareExpiry(now: Date = new Date()): Date {
  const out = new Date(now);
  out.setDate(out.getDate() + 30);
  return out;
}
