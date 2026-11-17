/* El logo de la barbería, listo para pintarse dentro del ícono de la tarjeta
   (ws6-t2, punto 5). Sin prisma ni next/*: recibe la URL y se prueba con un
   `fetch` de mentira (…/__tests__/tarjeta-instalar.test.ts). */

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_WAIT_MS = 3000;

type FetchLike = (url: string, init: { signal: AbortSignal; redirect: "error" }) => Promise<{
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Data URL del logo, o null (y entonces el ícono sale con la inicial).
 *
 * 🔒 Solo se baja si vive en NUESTRO almacenamiento público (la URL empieza
 * por el Storage de Supabase del proyecto): el servidor no sale a buscar una
 * URL arbitraria que alguien haya guardado como logo, ni sigue redirecciones.
 * Y solo PNG o JPEG de hasta 2 MB, que es lo que el generador sabe pintar.
 */
export async function logoParaIcono(
  logoUrl: string | null | undefined,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike } = {},
): Promise<string | null> {
  const env = opts.env ?? process.env;
  const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!logoUrl || !/^https:\/\/[^/]+$/.test(base)) return null;
  if (!logoUrl.startsWith(`${base}/storage/v1/object/public/`)) return null;
  // Nada de «..» ni de credenciales en la URL: tiene que ser una ruta limpia del bucket.
  if (logoUrl.includes("..") || logoUrl.includes("@") || /[\s\\]/.test(logoUrl)) return null;
  try {
    const f = opts.fetchImpl ?? (fetch as unknown as FetchLike);
    const res = await f(logoUrl, { signal: AbortSignal.timeout(LOGO_WAIT_MS), redirect: "error" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "image/png" && type !== "image/jpeg") return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > LOGO_MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
