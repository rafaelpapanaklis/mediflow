import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS, type BucketName, esPathDeLaClinica, esPathFirmable, extractStoragePath } from "./storage-paths";

export {
  BUCKETS,
  type BucketName,
  esPathBajo,
  esPathDeLaClinica,
  esPathFirmable,
  extractStoragePath,
  soloDeSuClinica,
} from "./storage-paths";

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
 * Genera una signed URL para `path` dentro de `bucket`.
 * Lanza si Supabase devuelve error, o si el path no pasa el veto (`esPathFirmable`).
 */
export async function createSignedFileUrl(
  path: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<string> {
  if (!esPathFirmable(path)) {
    throw new Error(`No se firma ${bucket}/${JSON.stringify(path)}: path no permitido`);
  }
  const { data, error } = await admin().storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`No se pudo generar signed URL para ${bucket}/${path}: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

/**
 * Acepta un path interno o una URL legacy y devuelve una signed URL fresca.
 * Si el input es una URL externa (no Supabase) o no pertenece al bucket
 * indicado, la devuelve sin tocar. Un path que no pasa el veto (`esPathFirmable`) devuelve "".
 */
export async function signMaybeUrl(
  urlOrPath: string | null | undefined,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<string> {
  if (!urlOrPath) return "";
  const path = extractStoragePath(urlOrPath, bucket);
  if (!path) return urlOrPath;
  if (!esPathFirmable(path)) return "";
  return createSignedFileUrl(path, ttlSeconds, bucket);
}

/**
 * Como `signMaybeUrl`, pero SOLO firma objetos de la clínica de la sesión (`clinicId` obligatorio):
 * un path de otra clínica o de la plataforma devuelve "" sin firmar. Para rutas que vinieron del
 * cliente y se guardaron (fotos de antes/después). Una URL externa (no del bucket) pasa tal cual.
 */
export async function signMaybeUrlDeLaClinica(
  urlOrPath: string | null | undefined,
  clinicId: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  if (!urlOrPath) return "";
  const path = extractStoragePath(urlOrPath, BUCKETS.PATIENT_FILES);
  if (!path) return urlOrPath;
  if (!esPathDeLaClinica(path, clinicId)) return "";
  return createSignedFileUrl(path, ttlSeconds, BUCKETS.PATIENT_FILES);
}

/** Versión batch de `signMaybeUrlDeLaClinica`: lo que no es de la clínica queda "" y no se firma. */
export async function signMaybeUrlsDeLaClinica(
  urls: Array<string | null | undefined>,
  clinicId: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string[]> {
  const propias = urls.map((u) => {
    if (!u) return u;
    const path = extractStoragePath(u, BUCKETS.PATIENT_FILES);
    return !path || esPathDeLaClinica(path, clinicId) ? u : null;
  });
  return signMaybeUrls(propias, ttlSeconds, BUCKETS.PATIENT_FILES);
}

/**
 * Versión batch — útil para listas de archivos. Firma TODAS las URLs internas
 * en UN solo round-trip con `createSignedUrls` (plural) en vez de N× llamadas
 * a `createSignedUrl`. Las URLs externas / fuera del bucket se devuelven tal
 * cual (passthrough). Falla suave: si una URL no se puede firmar, queda vacía
 * (sin romper toda la respuesta). El resultado conserva el orden del input.
 */
export async function signMaybeUrls(
  urls: Array<string | null | undefined>,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<string[]> {
  const result: string[] = new Array(urls.length).fill("");
  // Separa los inputs: passthrough (vacío / URL externa) vs paths firmables.
  const toSign: Array<{ idx: number; path: string }> = [];
  urls.forEach((u, idx) => {
    if (!u) return; // queda ""
    const path = extractStoragePath(u, bucket);
    if (!path) {
      result[idx] = u; // URL externa o de otro bucket: passthrough
      return;
    }
    if (!esPathFirmable(path)) return; // veto global: queda "" sin firmar
    toSign.push({ idx, path });
  });

  if (toSign.length === 0) return result;

  try {
    const { data, error } = await admin()
      .storage.from(bucket)
      .createSignedUrls(
        toSign.map((t) => t.path),
        ttlSeconds,
      );
    if (error || !data) {
      console.warn(
        "[storage.signMaybeUrls] createSignedUrls falló:",
        error?.message ?? "sin data",
      );
      return result; // falla suave: las firmables quedan ""
    }
    // `data` viene en el MISMO orden que los paths enviados.
    data.forEach((row, i) => {
      const target = toSign[i];
      if (!target) return;
      if (row.error || !row.signedUrl) {
        console.warn(
          `[storage.signMaybeUrls] fallo al firmar ${bucket}/${target.path}:`,
          row.error ?? "sin signedUrl",
        );
        return; // queda ""
      }
      result[target.idx] = row.signedUrl;
    });
  } catch (e) {
    console.warn("[storage.signMaybeUrls] excepción:", (e as Error).message);
    // result ya tiene "" en las firmables y passthrough en las externas.
  }

  return result;
}

/**
 * Tamaño REAL en bytes de un objeto ya subido, preguntándoselo al storage.
 *
 * Existe para las cuotas: cuando el archivo sube DIRECTO del navegador al
 * bucket (signed upload URL), el único tamaño que llega al servidor es el que
 * dice el cliente — y un cliente puede mentir o no mandarlo. Nunca valides
 * cuota contra ese número; usa este.
 *
 * Devuelve `null` si no se pudo determinar (objeto aún no visible, error de
 * red, bucket sin metadata). El caller decide qué hacer con ese null.
 */
export async function getStorageObjectSize(
  path: string,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<number | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  if (!file) return null;
  try {
    // `search` es substring, no igualdad: pedimos varios y buscamos el exacto.
    const { data, error } = await admin()
      .storage.from(bucket)
      .list(dir, { limit: 100, search: file });
    if (error || !data) {
      console.warn(
        `[storage.getStorageObjectSize] list falló para ${bucket}/${path}:`,
        error?.message ?? "sin data",
      );
      return null;
    }
    const hit = data.filter((o) => o.name === file)[0];
    const size = hit && hit.metadata ? (hit.metadata as { size?: unknown }).size : undefined;
    return typeof size === "number" && isFinite(size) && size >= 0 ? size : null;
  } catch (e) {
    console.warn("[storage.getStorageObjectSize] excepción:", (e as Error).message);
    return null;
  }
}

/**
 * Sube un binario al bucket privado. `path` es el storageKey interno (nunca se
 * expone al cliente: se firma on-demand con signMaybeUrl). `upsert: false` → no
 * pisa un objeto existente. Lanza si Supabase devuelve error.
 */
export async function uploadFileToStorage(
  path: string,
  body: ArrayBuffer | Buffer | Uint8Array,
  contentType: string,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<void> {
  const { error } = await admin()
    .storage.from(bucket)
    .upload(path, body, { contentType, upsert: false });
  if (error) {
    throw new Error(`No se pudo subir ${bucket}/${path}: ${error.message}`);
  }
}

/**
 * Borra un objeto del bucket por su path interno. Lanza si Supabase devuelve
 * error (el caller decide si es best-effort).
 */
export async function removeFileFromStorage(
  path: string,
  bucket: BucketName = BUCKETS.PATIENT_FILES,
): Promise<void> {
  const { error } = await admin().storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(`No se pudo borrar ${bucket}/${path}: ${error.message}`);
  }
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
