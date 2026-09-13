/**
 * WS1-T6 — el logo de la clínica (`Clinic.logoUrl`) ya no solo pinta la
 * mini-web: desde que la cabecera de los PDF lo consume, sale también en la
 * factura, la nota clínica, la orden de laboratorio y la carta de referencia.
 *
 * `@react-pdf` no sabe pintar webp, gif ni svg — no falla, deja el hueco en
 * blanco sin avisar — así que el logo se acota a los dos formatos que sí
 * renderiza en los dos sitios a la vez. Es la fuente única para:
 *   · `POST /api/landing-upload` (destino "logo"), que valida el MIME real.
 *   · `PATCH /api/settings`, que valida la URL que se guarda en `logoUrl`
 *     (esa ruta antes copiaba el campo tal cual, sin mirar la extensión).
 */
export const LOGO_ALLOWED_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export function esMimeDeLogoValido(mime: string): boolean {
  return (LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

const EXTENSIONES_DE_LOGO_VALIDAS = ["png", "jpg", "jpeg"];

/**
 * `logoUrl` es una URL http(s) cuya ruta termina en una extensión que
 * `@react-pdf` sabe pintar. No mira el contenido real del archivo (para eso
 * está `esMimeDeLogoValido` en la subida) — esto es la última puerta antes de
 * guardar la columna, para que nadie escriba un `.webp` a mano saltándose el
 * uploader.
 */
export function esUrlDeLogoValida(url: unknown): boolean {
  if (typeof url !== "string" || !url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const ext = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONES_DE_LOGO_VALIDAS.includes(ext);
}
