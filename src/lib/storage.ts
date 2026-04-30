import { createClient as createAdmin } from "@supabase/supabase-js";

/**
 * Buckets de Supabase Storage usados por MediFlow.
 *
 * - PATIENT_FILES: PRIVADO. Contiene archivos clínicos (radiografías, fotos
 *   intraorales, firmas de consent, before/after). Acceso SIEMPRE vía signed
 *   URL con TTL corto (default 300s). Nunca debe ser público.
 *
 * - CLINIC_PUBLIC: PÚBLICO. Contiene assets de la landing pública de cada
 *   clínica (cover, galería). Estos son accesibles vía URL pública porque
 *   se renderizan en páginas indexables sin autenticación.
 */
export const BUCKETS = {
  PATIENT_FILES: "patient-files",
  CLINIC_PUBLIC: "clinic-public",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/** TTL por defecto para signed URLs de archivos clínicos (5 minutos). */
export const SIGNED_URL_TTL_SECONDS = 300;

let cachedAdmin: ReturnType<typeof createAdmin> | null = null;
function admin() {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  return cachedAdmin;
}

/**
 * Extrae el path interno del bucket a partir de una URL pública o firmada
 * legacy de Supabase Storage. Devuelve `null` si la URL no pertenece al
 * bucket dado.
 *
 * Ejemplos válidos:
 *   /storage/v1/object/public/patient-files/<clinic>/<patient>/img.jpg
 *   /storage/v1/object/sign/patient-files/<clinic>/<patient>/img.jpg?token=...
 *
 * Si el input ya es un path relativo (no http), lo devuelve tal cual.
 */
export function extractStoragePath(
  urlOrPath: string | null | undefined,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): string | null {
  if (!urlOrPath) return null;
  // Si no parece URL, asumimos que ya es un path
  if (!urlOrPath.startsWith("http")) return urlOrPath;
  try {
    const u = new URL(urlOrPath);
    const marker = `/storage/v1/object/`;
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return null;
    // Quita /storage/v1/object/{public|sign}/{bucket}/
    const rest = u.pathname.slice(idx + marker.length); // public/<bucket>/...
    const parts = rest.split("/");
    // parts[0] = "public" | "sign", parts[1] = bucket, parts[2..] = path
    if (parts.length < 3) return null;
    if (parts[1] !== bucket) return null;
    return decodeURIComponent(parts.slice(2).join("/").split("?")[0]);
  } catch {
    return null;
  }
}

/**
 * Genera una signed URL para `path` dentro de `bucket`.
 * Lanza si Supabase devuelve error.
 */
export async function createSignedFileUrl(
  path: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<string> {
  const { data, error } = await admin().storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`No se pudo generar signed URL para ${bucket}/${path}: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

/**
 * Acepta un path interno o una URL legacy y devuelve una signed URL fresca.
 * Si el input es una URL externa (no Supabase) o no pertenece al bucket
 * indicado, la devuelve sin tocar.
 */
export async function signMaybeUrl(
  urlOrPath: string | null | undefined,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<string> {
  if (!urlOrPath) return "";
  const path = extractStoragePath(urlOrPath, bucket);
  if (!path) return urlOrPath;
  return createSignedFileUrl(path, ttlSeconds, bucket);
}

/**
 * Versión batch — útil para listas de archivos. Falla suave: si una URL no
 * se puede firmar, la devuelve vacía y loguea warning (sin romper toda la
 * respuesta).
 */
export async function signMaybeUrls(
  urls: Array<string | null | undefined>,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<string[]> {
  return Promise.all(
    urls.map(async (u) => {
      try {
        return await signMaybeUrl(u, ttlSeconds, bucket);
      } catch (e) {
        console.warn("[storage.signMaybeUrls] fallo al firmar:", (e as Error).message);
        return "";
      }
    }),
  );
}

/**
 * Compat — algunas tablas guardaban signed URLs legacy con expiración
 * `/storage/v1/object/sign/...?token=...`. Esta función las mapeaba al
 * formato `public/...` cuando el bucket aún era público.
 *
 * AHORA el bucket es privado, así que esta función está deprecada: úsala
 * sólo en code paths que aún no migraron a signed URLs on-demand.
 *
 * @deprecated Usa signMaybeUrl() para generar signed URL fresca.
 */
export function toPublicFileUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (!url.includes("/storage/v1/object/sign/")) return url;
  return url
    .replace("/storage/v1/object/sign/", "/storage/v1/object/public/")
    .split("?")[0];
}
