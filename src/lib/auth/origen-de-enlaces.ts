/**
 * Seguridad admin-auth (auditoría «cloudflare», nº6) — a qué origen apunta un enlace de auth que viaja
 * por correo (recuperar contraseña).
 *
 * Antes salía del header `Origin`, que cualquiera pone a mano con curl: el correo de verdad que recibe la
 * víctima llevaba `redirect_to` al host del atacante, y si la allowlist de Supabase tenía un comodín
 * (*.vercel.app, *.sslip.io…) el código de recuperación le llegaba a él, que además guarda el verificador
 * PKCE. Ahora el origen sale SIEMPRE de una lista fija del servidor: `NEXT_PUBLIC_APP_URL`,
 * `NEXT_PUBLIC_SITE_URL`, los dominios de producción y, si hace falta (un panel autoalojado, una Preview),
 * los de `AUTH_ORIGENES_EXTRA` (separados por comas). El `Origin` de la petición solo ELIGE dentro de la
 * lista —el verificador PKCE es una cookie de host, así que el enlace tiene que volver al host desde el que
 * se pidió—; si no está en ella, se usa `NEXT_PUBLIC_APP_URL`.
 */
const DOMINIOS_DE_PRODUCCION = ["https://www.dalecontrol.com", "https://dalecontrol.com", "https://mediflow-pi.vercel.app"];

function origenDe(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Los orígenes a los que puede apuntar un enlace de auth. El primero es el canónico. */
export function origenesPermitidos(env: Record<string, string | undefined> = process.env): string[] {
  const lista = [
    origenDe(env.NEXT_PUBLIC_APP_URL),
    origenDe(env.NEXT_PUBLIC_SITE_URL),
    ...DOMINIOS_DE_PRODUCCION,
    ...(env.AUTH_ORIGENES_EXTRA ?? "").split(",").map(origenDe),
  ].filter((o): o is string => !!o);
  return Array.from(new Set(lista));
}

/** El origen del enlace: el pedido si está EXACTO en la lista; si no, el canónico. Nunca otro. */
export function origenParaEnlaceDeAuth(pedido: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  const permitidos = origenesPermitidos(env);
  const o = origenDe(pedido);
  return o && permitidos.includes(o) ? o : permitidos[0];
}
