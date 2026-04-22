import { fileTypeFromBuffer } from "file-type";

/**
 * Valida magic number del archivo contra la whitelist MIME.
 * El browser MIME (file.type) es falseable — este chequea los primeros bytes.
 * Devuelve null si todo OK, o un mensaje de error.
 */
export async function validateMagicNumber(bytes: ArrayBuffer, allowed: string[]): Promise<string | null> {
  const buf = Buffer.from(bytes);
  const detected = await fileTypeFromBuffer(buf);
  if (!detected) {
    return "No se pudo detectar el tipo de archivo";
  }
  if (!allowed.includes(detected.mime)) {
    return `Tipo real del archivo (${detected.mime}) no permitido`;
  }
  return null;
}
