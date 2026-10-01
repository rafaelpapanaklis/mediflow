// ─────────────────────────────────────────────────────────────────────────────
// Validadores de URL para lo que viene de la barra de direcciones o de un
// formulario (B10, auditoría 30-sep-2026).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `next` de un callback de login: SOLO una ruta interna del propio sitio.
 *
 * El callback arma `${origin}${next}`, así que un `next` que no empiece por `/`
 * convertía la redirección en abierta: `next=@evil.com` → `https://app@evil.com`
 * (el host real pasa a ser evil.com) y `next=.evil.com` → `https://app.evil.com`.
 * Se rechaza también `//host`, `/\host` (los navegadores tratan `\` como `/`),
 * cualquier carácter de control y todo lo que, resuelto contra el sitio, salga
 * de su origen.
 */
export function rutaInternaSegura(raw: string | null | undefined, respaldo = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return respaldo;
  if (!raw.startsWith("/")) return respaldo;
  if (raw.startsWith("//") || raw.includes("\\")) return respaldo;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return respaldo;
  try {
    const u = new URL(raw, "http://sitio.invalid");
    if (u.origin !== "http://sitio.invalid") return respaldo;
  } catch {
    return respaldo;
  }
  return raw;
}

/**
 * URL web (http/https) para guardar y pintar en un `href`/`src`. Devuelve la URL
 * normalizada o null. Si no trae esquema (`maps.app.goo.gl/x`, como la teclea
 * casi todo el mundo) se le antepone `https://`; cualquier otro esquema
 * (`javascript:`, `data:`, `vbscript:`, `file:`…) se rechaza.
 */
export function normalizarUrlWeb(raw: unknown, max = 2048): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > max || /\s/.test(v)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  const conEsquema = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) && !/^[^/?#]*:\d+(?:[/?#]|$)/.test(v);
  const candidata = conEsquema ? v : `https://${v}`;
  try {
    const u = new URL(candidata);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return candidata;
  } catch {
    return null;
  }
}
