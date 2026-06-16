// ═══════════════════════════════════════════════════════════════════
// Cliente de bajo nivel de la Graph API de Meta (WS-MKT-T4).
// Fetch con timeout, parseo de errores SIN filtrar el access token, y un
// validador SSRF para image_url (solo nuestro Supabase Storage público).
// ═══════════════════════════════════════════════════════════════════
import "server-only";

export const GRAPH_VERSION = "v19.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const TIMEOUT_MS = 20_000;

/** Error de Graph con el mensaje legible de Meta; nunca incluye el token. */
export class GraphError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GraphError";
    this.status = status;
  }
}

async function parseGraph(res: Response): Promise<any> {
  // Meta puede responder HTML en 5xx de gateway: no asumir JSON.
  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok) {
    const msg = data?.error?.message ?? `Error de Graph API (HTTP ${res.status})`;
    throw new GraphError(msg, res.status);
  }
  return data;
}

/** GET a la Graph API. `params` se serializa a query string (incluye access_token). */
export async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs}`, {
    method: "GET",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseGraph(res);
}

/** POST a la Graph API con cuerpo x-www-form-urlencoded (lo que espera Meta). */
export async function graphPost(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return parseGraph(res);
}

/**
 * Anti-SSRF: solo aceptamos image_url que viva en NUESTRO Supabase Storage
 * público. Meta descarga la imagen server-side; sin esta lista blanca, un
 * caption con image_url interna (169.254.169.254, localhost, etc.) sería un
 * vector de SSRF a través de los servidores de Meta o los nuestros.
 */
export function isOwnStorageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supa) return false;
    const supaHost = new URL(supa).host;
    if (u.host !== supaHost) return false;
    if (!u.pathname.includes("/storage/v1/object/public/")) return false;
    // Defensa en profundidad: rechaza contenido activo (SVG/HTML/JS) que, aun
    // alojado en nuestro Storage, sería un vector de XSS/abuso al renderizarse.
    if (/\.(svgz?|x?html?|xml|js)$/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}
