/**
 * Contrato ÚNICO de la subida DIRECTA en BLOQUE de archivos del expediente
 * (radiografías, fotos, PDFs) durante "Importar mi clínica".
 *
 * POR QUÉ EXISTE
 * Mismo problema que patient-study-upload.ts (el body de una función de Vercel
 * topa muy por debajo de lo que pesa un lote de radiografías), pero para el
 * caso BULK: muchos archivos de MUCHOS pacientes distintos en una sola pasada,
 * emparejados por ID externo o por nombre de carpeta/archivo (no por un
 * patientId de la URL, como el flujo de un solo archivo).
 *
 * Este módulo es PURO a propósito (sin prisma, sin supabase, sin next/server):
 * lo importan tanto los route handlers como el componente cliente.
 *
 * Flujo en 3 pasos (ver src/app/api/import/patient-files/*):
 *   1. POST .../match    → emparejamiento por paciente (sin tocar Storage)
 *   2. POST .../sign      → valida y devuelve signed upload URL + path por archivo
 *   3. PUT  <signedUrl>   → el navegador sube directo al bucket
 *   4. POST .../confirm   → mide el tamaño REAL y crea el PatientFile
 *
 * A propósito NO comparte extensiones/tope con patient-study-upload.ts: esto
 * son radiografías/fotos/PDFs (2D), no estudios 3D/DICOM — misma whitelist y
 * tope que ya usa el POST multipart de siempre (`/api/xrays`, 50 MB).
 */

export const MAX_BULK_FILE_BYTES = 50 * 1024 * 1024; // 50 MB, igual que /api/xrays

export const MAX_BULK_FILE_LABEL = "50 MB";

/** Mismo criterio que ALLOWED_TYPES de /api/xrays/route.ts (radiografías, fotos, PDFs). */
export const BULK_FILE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "pdf"] as const;
export type BulkFileExt = (typeof BULK_FILE_EXT)[number];

/** `accept` del `<input type="file">` — derivado de la lista de arriba. */
export const BULK_FILE_ACCEPT = BULK_FILE_EXT.map((e) => `.${e}`).join(",");

/** Extensión en minúsculas de un nombre de archivo ("A.JPG" → "jpg"). */
export function extOfName(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function isBulkFileExt(ext: string): ext is BulkFileExt {
  return (BULK_FILE_EXT as readonly string[]).includes(ext.toLowerCase());
}

/** Content-Type que se guarda en el objeto y en PatientFile.mimeType. */
export function mimeForBulkFileExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "tiff":
      return "image/tiff";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/** Whitelist MIME para validate-upload.ts (magic number). Espejo de mimeForBulkFileExt. */
export const BULK_FILE_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
];

/**
 * `FileCategory` (prisma/schema.prisma) que puede llegar del cliente. Se
 * declara aquí en vez de importar el enum de Prisma (este módulo es puro y lo
 * importa el navegador): la whitelist protege /confirm de un valor inventado.
 */
export const FILE_CATEGORIES = [
  "XRAY_PERIAPICAL", "XRAY_PANORAMIC", "XRAY_BITEWING", "XRAY_OCCLUSAL", "XRAY_CBCT",
  "XRAY_CEPHALOMETRIC",
  "PHOTO_FRONTAL", "PHOTO_LATERAL", "PHOTO_OCCLUSAL_UPPER", "PHOTO_OCCLUSAL_LOWER",
  "PHOTO_INTRAORAL", "PHOTO_PATIENT", "CONSENT_FORM",
  "ORTHO_PHOTO_T0", "ORTHO_PHOTO_T1", "ORTHO_PHOTO_T2", "ORTHO_PHOTO_CONTROL",
  "CEPH_ANALYSIS_PDF", "SCAN_STL", "OTHER",
] as const;
export type FileCategoryValue = (typeof FILE_CATEGORIES)[number];

export function isFileCategory(v: unknown): v is FileCategoryValue {
  return typeof v === "string" && (FILE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Adivina la categoría por el NOMBRE del archivo — nunca con confianza si el
 * nombre no lo dice claro: el default es OTHER, editable en la vista previa
 * antes de subir. Orden de prioridad: lo más específico primero.
 */
export function guessFileCategory(fileName: string): FileCategoryValue {
  const n = fileName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (/panoram/.test(n)) return "XRAY_PANORAMIC";
  if (/bitewing|aleta/.test(n)) return "XRAY_BITEWING";
  if (/cbct|tomograf/.test(n)) return "XRAY_CBCT";
  // La lateral de cráneo se revisa ANTES que «rx»/«radiograf»: «Rx lateral.jpg»
  // es una cefalométrica, no una periapical. El PDF de trazado sigue siendo el
  // análisis (otra categoría); la foto «lateral» a secas sigue siendo foto.
  const esCefalo = /cefalo|ceph|teleradiograf|telerradiograf|\btele\b/.test(n)
    || (/lateral/.test(n) && /(rx|radiograf|craneo)/.test(n));
  if (esCefalo) return /pdf$/.test(n) ? "CEPH_ANALYSIS_PDF" : "XRAY_CEPHALOMETRIC";
  if (/oclusal/.test(n) && /(rx|radiograf)/.test(n)) return "XRAY_OCCLUSAL";
  if (/periapical|rx|radiograf/.test(n)) return "XRAY_PERIAPICAL";
  if (/consent/.test(n)) return "CONSENT_FORM";
  if (/frontal/.test(n)) return "PHOTO_FRONTAL";
  if (/lateral/.test(n)) return "PHOTO_LATERAL";
  if (/intraoral/.test(n)) return "PHOTO_INTRAORAL";
  if (/foto|photo/.test(n)) return "PHOTO_PATIENT";
  return "OTHER";
}

/** Nombre saneado para el path del bucket; el original se guarda en PatientFile.name. */
export function safeBulkFileName(originalName: string): string {
  const safe = originalName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80);
  return safe || "archivo";
}

/**
 * Carpeta destino: la MISMA que usa /api/xrays (`<clinic>/<patient>/`), para
 * que un archivo importado en bloque viva exactamente donde ya buscan los
 * demás lectores del expediente (no una carpeta aparte).
 */
export function bulkFilePathPrefix(clinicId: string, patientId: string): string {
  return `${clinicId}/${patientId}/`;
}

/** Path completo del objeto. `uuid` lo genera el servidor (crypto.randomUUID). */
export function bulkFileStoragePath(
  clinicId: string,
  patientId: string,
  uuid: string,
  safeName: string,
): string {
  return `${bulkFilePathPrefix(clinicId, patientId)}${uuid}-${safeName}`;
}

/**
 * Candidatos de texto con los que EMPAREJAR un archivo a un paciente, en orden
 * de preferencia: el nombre de carpeta completo (si viene de un
 * `webkitdirectory`), y del nombre de archivo sin extensión — completo y su
 * primer segmento antes de un separador ("12345_rx.jpg" → "12345",
 * "Juan Pérez - rx.jpg" → "Juan Pérez"). NUNCA se inventa un emparejamiento:
 * esto solo genera candidatos a intentar contra el índice de pacientes; quien
 * llama decide y la vista previa siempre muestra el resultado antes de subir.
 */
export function candidatosDeEmparejamiento(fileName: string, folderName?: string | null): string[] {
  const candidatos: string[] = [];
  const carpeta = (folderName ?? "").trim();
  if (carpeta) candidatos.push(carpeta);
  const sinExt = fileName.replace(/\.[^./\\]+$/, "").trim();
  if (sinExt) candidatos.push(sinExt);
  const corte = sinExt.match(/^(.+?)\s*[-_]\s*(.+)$/);
  if (corte && corte[1].trim()) candidatos.push(corte[1].trim());
  return Array.from(new Set(candidatos.filter(Boolean)));
}

/**
 * Empareja por el FOLIO visible del paciente (`patientNumber`, «P0166»): es lo
 * que la clínica ve en su ficha, único por clínica. Compara sin importar
 * mayúsculas ni espacios; `folios` es folio normalizado → id de paciente (solo
 * los que quien importa puede ver). Devuelve el primer candidato que case.
 */
export function emparejarPorFolio(
  candidatos: string[],
  folios: Map<string, string>,
): { patientId: string; candidate: string } | null {
  for (const c of candidatos) {
    const id = folios.get(c.trim().toUpperCase());
    if (id) return { patientId: id, candidate: c };
  }
  return null;
}

/** Bytes → "1.4 MB" / "930 KB". Reexportado del módulo de estudios (mismo formato). */
export { formatBytes } from "./patient-study-upload";
