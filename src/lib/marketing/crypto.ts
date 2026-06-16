// ═══════════════════════════════════════════════════════════════════
// Cifrado de tokens de redes sociales en reposo (WS-MKT-T1 foundation).
// AES-256-GCM con node:crypto (sin dependencias nuevas).
// Clave: process.env.MARKETING_TOKEN_KEY = 32 bytes en base64.
// Formato de salida: `iv.tag.ciphertext`, cada parte en base64.
// Regla del módulo: NUNCA persistir un access token en claro.
// ═══════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // nonce estándar de GCM (96 bits)

function getKey(): Buffer {
  const raw = process.env.MARKETING_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "MARKETING_TOKEN_KEY no está configurada. Genera 32 bytes en base64 " +
        "(p. ej. `openssl rand -base64 32`) y agrégala a las envs del proyecto.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `MARKETING_TOKEN_KEY debe ser exactamente 32 bytes en base64 (AES-256); ` +
        `se decodificaron ${key.length} bytes.`,
    );
  }
  return key;
}

/** Cifra un token (o cualquier secreto). Devuelve `iv.tag.ciphertext` en base64. */
export function encryptToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** Descifra un valor producido por encryptToken. Lanza si el formato o el tag no validan. */
export function decryptToken(enc: string): string {
  const key = getKey();
  const parts = enc.split(".");
  if (parts.length !== 3) {
    throw new Error(
      "Formato de token cifrado inválido (se esperaba iv.tag.ciphertext en base64).",
    );
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
