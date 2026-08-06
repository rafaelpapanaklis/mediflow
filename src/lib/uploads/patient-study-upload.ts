/**
 * Contrato ÚNICO de la subida DIRECTA de estudios pesados al expediente:
 * tomografías CBCT/DICOM empaquetadas en .zip, DICOM sueltos y mallas 3D.
 *
 * POR QUÉ EXISTE
 * El camino clásico (multipart al route handler) tiene un techo DURO que no es
 * nuestro: Vercel corta el cuerpo de la petición muy por debajo de lo que pesa
 * un CBCT (cientos de MB). Subir la constante MAX_SIZE del handler no mueve ese
 * techo. La única forma de aceptar 2 GB es que el binario NUNCA toque el
 * servidor: el navegador sube directo a Supabase Storage con una signed upload
 * URL, y el servidor solo firma (antes) y registra (después).
 *
 * Este módulo es PURO a propósito (sin prisma, sin supabase, sin next/server):
 * lo importan tanto los route handlers como el componente cliente, para que el
 * límite que valida el servidor y el que muestra la UI sean el MISMO número.
 *
 * Flujo en 3 pasos (ver src/app/api/patients/[id]/uploads/*):
 *   1. POST .../uploads/sign     → valida y devuelve signed upload URL + path
 *   2. PUT  <signedUrl>          → el navegador sube directo al bucket
 *   3. POST .../uploads/confirm  → mide el tamaño REAL y crea el PatientFile
 */

/**
 * Tope de la subida directa: 2 GB por archivo.
 *
 * No es un límite de plan — el límite real de cada clínica es el almacenamiento
 * contratado (5/15/75 GB), que se cobra aparte con storageQuotaError(). Este
 * número solo acota UN archivo, y aplica igual en todos los planes.
 *
 * OJO: para que 2 GB pasen de verdad, el límite de tamaño del proyecto/bucket en
 * el panel de Supabase debe ser >= 2 GB (por defecto viene mucho más bajo). Si no
 * lo está, el PUT del navegador falla con 413 y /sign no puede detectarlo.
 */
export const MAX_STUDY_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/** Etiqueta legible del tope, para mensajes de error y de UI. */
export const MAX_STUDY_UPLOAD_LABEL = "2 GB";

/**
 * Extensiones que acepta la subida directa.
 *  - stl/ply/obj  → mallas intraorales
 *  - dcm/dicom    → corte DICOM suelto
 *  - zip          → set CBCT completo (carpeta de cortes comprimida)
 */
export const STUDY_UPLOAD_EXT = ["stl", "ply", "obj", "dcm", "dicom", "zip"] as const;
export type StudyUploadExt = (typeof STUDY_UPLOAD_EXT)[number];

/** `accept` del <input type="file"> — derivado de la lista de arriba, no duplicado. */
export const STUDY_UPLOAD_ACCEPT = STUDY_UPLOAD_EXT.map((e) => `.${e}`).join(",");

/**
 * Tope para INSPECCIONAR el archivo en el servidor durante /confirm.
 *
 * Hasta este tamaño, /confirm se descarga el objeto desde Storage (una descarga
 * servidor→servidor, que NO tiene el techo de 4.5 MB del cuerpo de la petición)
 * para (a) validar la firma real del contenido y (b) convertir mallas a GLB web.
 * Por encima, el archivo se guarda tal cual y se documenta como no procesado:
 * meter 2 GB en la memoria de una función serverless la mata.
 */
export const MAX_SERVER_INSPECT_BYTES = 60 * 1024 * 1024; // 60 MB

/**
 * Tope para generar el CBCT "lite" (la versión reducida que carga el móvil).
 *
 * La generación descomprime el .zip ENTERO en memoria (JSZip) y decodifica sus
 * cortes; la función corre con 3009 MB. Los estudios de 300-600 MB que ya
 * funcionaban siguen igual: este guard solo evita que un .zip de 1-2 GB tumbe la
 * función por OOM y deje al visor móvil con un error mudo.
 */
export const MAX_CBCT_LITE_BYTES = 700 * 1024 * 1024; // 700 MB

/** Extensión en minúsculas de un nombre de archivo ("A.STL" → "stl"). */
export function extOfName(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function isStudyExt(ext: string): ext is StudyUploadExt {
  return (STUDY_UPLOAD_EXT as readonly string[]).includes(ext.toLowerCase());
}

/** Mallas 3D (se convierten a GLB web). DICOM y .zip NO son mallas. */
export function isMeshExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return e === "stl" || e === "ply" || e === "obj";
}

/** Sets CBCT: el .zip con la carpeta de cortes. */
export function isCbctZipExt(ext: string): boolean {
  return ext.toLowerCase() === "zip";
}

/** Content-Type que se guarda en el objeto y en PatientFile.mimeType. */
export function mimeForStudyExt(ext: string, fallback = ""): string {
  switch (ext.toLowerCase()) {
    case "stl":
      return "model/stl";
    case "obj":
      return "model/obj";
    case "zip":
      return "application/zip";
    case "dcm":
    case "dicom":
      return "application/dicom";
    case "ply":
    default:
      return fallback || "application/octet-stream";
  }
}

/**
 * Nombre saneado para el path del bucket. Conserva la extensión real y recorta;
 * el nombre ORIGINAL se guarda aparte en PatientFile.name (ahí sí se muestra tal
 * cual al usuario).
 */
export function safeStudyFileName(originalName: string, ext: string): string {
  const safe = originalName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80);
  return safe || `estudio.${ext}`;
}

/**
 * Carpeta destino según el tipo. La decide SIEMPRE el servidor a partir del
 * clinicId de la sesión: el cliente nunca propone un path.
 *
 * Se respetan las carpetas que ya existían para no romper lo subido antes:
 *   - .zip → <clinic>/dicom-sets/<paciente>/   (lo que lee el visor CBCT y el lite)
 *   - resto → <clinic>/models-3d/<paciente>/   (lo que leía el POST multipart)
 */
export function studyPathPrefix(clinicId: string, patientId: string, ext: string): string {
  const folder = isCbctZipExt(ext) ? "dicom-sets" : "models-3d";
  return `${clinicId}/${folder}/${patientId}/`;
}

/**
 * Path completo del objeto. `uuid` lo genera el servidor (crypto.randomUUID) —
 * va como parámetro para que este módulo siga siendo puro e importable desde el
 * navegador.
 */
export function studyStoragePath(
  clinicId: string,
  patientId: string,
  ext: string,
  uuid: string,
  safeName: string,
): string {
  const prefix = studyPathPrefix(clinicId, patientId, ext);
  // El .zip no arrastra el nombre original: el visor CBCT y el lite localizan el
  // estudio por el path, y PatientFile.name ya conserva el nombre de verdad.
  return isCbctZipExt(ext) ? `${prefix}${uuid}.zip` : `${prefix}${uuid}-${safeName}`;
}

/** Bytes → "1.4 GB" / "930.2 MB". Para mensajes de cuota y de la UI. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
