/**
 * Lo PURO de las rutas del bucket (sin cliente de Supabase): qué bucket es cuál, sacar el path de una
 * URL legacy y decidir si un path se puede firmar. Vive aparte de `storage.ts` para que una prueba
 * que dobla la firma (`@/lib/storage`) siga corriendo ESTOS filtros de verdad. `storage.ts` lo
 * reexporta todo, así que `import { … } from "@/lib/storage"` sigue valiendo.
 */

/**
 * Buckets de Supabase Storage usados por DaleControl.
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
 * ¿Se puede FIRMAR este path, venga de quien venga? (auditoría cloudflare nº1, veto global). Es la
 * mitad de `esPathDeLaClinica` que no depende de la clínica, y la aplican las tres puertas de firma
 * (`createSignedFileUrl`, `signMaybeUrl`, `signMaybeUrls`), así que también cubre filas ya plantadas
 * y entradas que todavía no comprueban el prefijo:
 *   · `%`: el path se pega TAL CUAL en la URL que firma Supabase y `fetch` normaliza `%2e%2e` como `..`
 *     (`cA/%2e%2e/db-backups/…` saltaba fuera de la carpeta). Ningún nombre que genera la app lleva `%`
 *     (se sanean a `[a-zA-Z0-9._-]`; las URLs legacy llegan ya decodificadas por `extractStoragePath`);
 *   · `\`, caracteres de control (un %00 o un salto de línea decodificados), segmentos vacíos (`//`) y
 *     `.`/`..`;
 *   · `db-backups/…`: los respaldos del cron viven en este bucket y NO se firman desde la app (el cron
 *     los maneja con su propio cliente).
 */
export function esPathFirmable(path: string | null | undefined): boolean {
  if (!path) return false;
  if (path.includes("%") || path.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.startsWith("db-backups/")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** `path` firmable y bajo `prefijo` (p. ej. `clinical-photos/<clinicId>/`). */
export function esPathBajo(path: string | null | undefined, prefijo: string): boolean {
  return !!path && !!prefijo && path.startsWith(prefijo) && esPathFirmable(path);
}

/**
 * ¿`path` es un objeto de ESTA clínica dentro del bucket? (auditoría cloudflare nº1). Todo lo que la
 * app sube de un paciente vive bajo `<clinicId>/…` (xrays, estudios, importación, fotos); lo demás
 * —otra clínica, `db-backups/…` del cron, `../`— no se firma desde una ruta que mandó el cliente.
 */
export function esPathDeLaClinica(path: string | null | undefined, clinicId: string | null | undefined): boolean {
  if (!clinicId) return false;
  return esPathBajo(path, `${clinicId}/`);
}

/**
 * Para firmar en lote filas que traen su propia clínica (`PatientFile.url` + `clinicId` de la fila;
 * con sedes vinculadas no es siempre la de la sesión). Devuelve la URL tal cual si es externa (no del
 * bucket) o si su path vive bajo `<clinicId>/`; si no, `null`, que `signMaybeUrls` deja en "" sin
 * firmar. Auditoría cloudflare (H1 / v2-m1): una fila plantada antes del arreglo con `cB/…` o
 * `signatures/cB/…` —que el veto global no frena— ya no sale firmada.
 */
export function soloDeSuClinica(url: string | null | undefined, clinicId: string | null | undefined): string | null {
  if (!url) return null;
  const path = extractStoragePath(url);
  return !path || esPathDeLaClinica(path, clinicId) ? url : null;
}
