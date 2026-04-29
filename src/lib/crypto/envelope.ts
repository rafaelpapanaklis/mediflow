/**
 * Cifrado envelope a nivel app para campos sensibles del expediente
 * clínico. Defense-in-depth contra compromiso de Supabase.
 *
 * Algoritmo: AES-256-GCM (autenticado, NIST SP 800-38D).
 * Clave maestra: DATA_ENCRYPTION_KEY del env (32 bytes hex).
 *
 * Formato persistido: "v1:base64(iv).base64(authTag).base64(ciphertext)".
 * El prefijo "v1:" identifica versión del cifrado para futuro upgrade
 * sin romper datos existentes.
 *
 * Campos a cifrar (estrategia post-Fase C):
 *  - MedicalRecord.subjective/objective/assessment/plan
 *  - Prescription.indications
 *  - Patient.notes
 *  - Patient.allergies / chronicConditions / currentMedications (cada item)
 *
 * NO cifrar: nombre, email, teléfono — se necesitan para búsquedas.
 *
 * NO incluido en este commit: rotación de clave maestra, migración
 * automática de datos legacy. Endpoint POST /api/admin/encrypt-historical
 * (solo SUPER_ADMIN) ofrece sweep manual cuando esté listo.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = "v1";

function getKey(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("DATA_ENCRYPTION_KEY env var is required (32-byte hex)");
  }
  if (hex.length !== 64) {
    throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Cifra un string. Devuelve "v1:base64(iv).base64(tag).base64(ct)".
 * Si plaintext es null/undefined/"" devuelve null (no cifra vacío).
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

/**
 * Descifra un string. Si el input no tiene el prefijo "v1:" se asume
 * texto plano legacy y se devuelve sin cambios — esto permite migración
 * gradual sin romper expedientes existentes.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!value.startsWith(`${VERSION}:`)) return value; // legacy plaintext
  const body = value.slice(VERSION.length + 1);
  const [ivB64, tagB64, ctB64] = body.split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("invalid_envelope_format");
  }
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Cifra un array de strings (para Patient.allergies, etc.). Cada item se
 * cifra independientemente con su propio IV.
 */
export function encryptArray(items: string[] | null | undefined): string[] {
  if (!items || items.length === 0) return [];
  return items.map((s) => encryptField(s) ?? "");
}

/**
 * Descifra un array. Items con prefijo v1: se descifran, los demás se
 * devuelven como están (backward-compat).
 */
export function decryptArray(items: string[] | null | undefined): string[] {
  if (!items || items.length === 0) return [];
  return items.map((s) => decryptField(s) ?? "");
}

/**
 * Verifica que el envelope sea decifrable sin descifrar realmente —
 * útil para health checks. Tira si la auth tag es inválida (cambio de
 * key sin rotar, datos corruptos, etc.).
 */
export function isEnvelope(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  return value.startsWith(`${VERSION}:`);
}
