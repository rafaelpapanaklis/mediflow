/**
 * Cifrado envelope para llaves privadas FIEL.
 *
 * Usa AES-256-GCM con la clave maestra `SIGNATURE_MASTER_KEY` (32 bytes
 * hex, debe estar en env de Vercel). El IV de 12 bytes y el authTag de
 * 16 bytes se persisten junto al ciphertext en doctor_signature_certs.
 *
 * NUNCA persistas la clave maestra en DB ni en código. Para rotar la
 * clave hay que descifrar todos los .key, generar nueva clave maestra y
 * re-cifrar (no implementado, futuro).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getMasterKey(): Buffer {
  const hex = process.env.SIGNATURE_MASTER_KEY;
  if (!hex) {
    throw new Error("SIGNATURE_MASTER_KEY env var is required for signature operations");
  }
  if (hex.length !== 64) {
    throw new Error("SIGNATURE_MASTER_KEY must be 32 bytes hex (64 hex chars)");
  }
  return Buffer.from(hex, "hex");
}

export interface EncryptedKey {
  ciphertext: Buffer;
  iv: string;       // base64
  authTag: string;  // base64
}

export function encryptPrivateKey(plaintext: Buffer): EncryptedKey {
  const masterKey = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptPrivateKey(opts: {
  ciphertext: Buffer;
  iv: string;       // base64
  authTag: string;  // base64
}): Buffer {
  const masterKey = getMasterKey();
  const iv = Buffer.from(opts.iv, "base64");
  const authTag = Buffer.from(opts.authTag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(opts.ciphertext), decipher.final()]);
}
