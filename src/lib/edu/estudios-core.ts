/**
 * DaleControl INSTITUCIONAL — contrato de los ESTUDIOS del expediente:
 * radiografías, tomografías CBCT, fotos intraorales y PDFs.
 *
 * Módulo PURO a propósito (sin prisma, sin supabase, sin next/server): lo
 * importan tanto los route handlers como el componente cliente, para que el
 * límite que valida el servidor y el que muestra la UI sean el MISMO
 * número. Un tope duplicado es un tope que un día dice 2 GB en la pantalla
 * y 100 MB en el servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EL ARCHIVO NO PASA POR EL SERVIDOR
 *
 * Una tomografía CBCT pesa cientos de MB y el cuerpo de una petición en
 * Vercel se corta muy por debajo de eso (~4.5 MB). Subir la constante del
 * handler no mueve ese techo: no es nuestro. La única forma de aceptar un
 * estudio de verdad es que el binario NUNCA toque el servidor.
 *
 * Los tres pasos (ver src/app/api/instituto/pacientes/[id]/estudios/*):
 *   1. POST .../estudios/sign     → el servidor valida y firma una URL de
 *                                   subida de Supabase Storage
 *   2. PUT  <signedUrl>           → el NAVEGADOR sube directo al bucket
 *   3. POST .../estudios/confirm  → el servidor MIDE el objeto real y
 *                                   crea la fila EduStudy
 *
 * Es el mismo patrón que ya resolvió el dental en
 * src/lib/uploads/patient-study-upload.ts y src/app/api/patients/[id]/uploads/*.
 * El vertical NO lo importa: ese módulo compone el path con `clinicId` y
 * escribe en el bucket `patient-files` del producto dental. Aquí el path se
 * compone con `institutionId` y el bucket es propio.
 *
 * 🔴 EL PATH LO DECIDE EL SERVIDOR, SIEMPRE, y lleva el institutionId
 * ADENTRO. El cliente nunca propone un path: si lo propusiera, bastaría
 * con teclear el de otra escuela para escribir en su carpeta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduStudyKind } from "@/lib/edu/types";

/**
 * Bucket PRIVADO del vertical.
 *
 * ── POR QUÉ NO SE REUSA src/lib/storage.ts ─────────────────────────────
 * Ese módulo es del dental: su tipo `BucketName` solo admite
 * "patient-files" | "clinic-public", así que pasarle "edu-files" no
 * compila. Agregar el bucket ahí sería tocar un archivo COMPARTIDO por
 * productos vivos en producción. El vertical trae su propio helper
 * (src/lib/edu/storage.ts), con la misma forma y los mismos cuidados —
 * exactamente lo que ya hizo el vertical de inmuebles con `realty-files`.
 *
 * Lo crea sql/edu-ola-3.sql con `public = false` y SIN policies: en
 * Supabase, storage.objects tiene RLS activo por defecto, así que "sin
 * policy" = nadie entra con la anon key (que sí se expone al navegador).
 * La app firma y borra con el service role, que bypassa RLS por diseño.
 */
export const EDU_FILES_BUCKET = "edu-files";

/**
 * Tope por archivo: 2 GB.
 *
 * ⚠️ Para que 2 GB pasen de verdad, el límite de tamaño del bucket en el
 * panel de Supabase tiene que ser >= 2 GB (por defecto viene mucho más
 * bajo). Si no lo está, el PUT del navegador falla con 413 y /sign no
 * puede detectarlo — el .sql lo deja escrito.
 *
 * 🔴 Este número es 2 147 483 648, UNO MÁS que el máximo de un INTEGER de
 * Postgres (2 147 483 647). Por eso `EduStudy.sizeBytes` es BigInt: con
 * Int, el archivo más grande que el producto acepta desborda la columna
 * justo después de que el usuario esperó la subida entera.
 */
export const EDU_MAX_STUDY_BYTES = 2 * 1024 * 1024 * 1024;
export const EDU_MAX_STUDY_LABEL = "2 GB";

/**
 * Extensiones aceptadas.
 *   · jpg/jpeg/png/webp → radiografías exportadas y fotos intraorales
 *   · dcm/dicom         → un corte DICOM suelto
 *   · zip               → el set CBCT completo (carpeta de cortes)
 *   · pdf               → reportes e interconsultas
 *   · stl/ply/obj       → mallas de escáner intraoral
 */
export const EDU_STUDY_EXT = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "dcm",
  "dicom",
  "zip",
  "pdf",
  "stl",
  "ply",
  "obj",
] as const;
export type EduStudyExt = (typeof EDU_STUDY_EXT)[number];

/** El `accept` del <input type="file">. Derivado, no duplicado. */
export const EDU_STUDY_ACCEPT = EDU_STUDY_EXT.map((e) => `.${e}`).join(",");

/** Extensión en minúsculas ("A.STL" → "stl"). */
export function eduExtOfName(name: string): string {
  if (typeof name !== "string") return "";
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function eduIsStudyExt(ext: string): ext is EduStudyExt {
  return (EDU_STUDY_EXT as readonly string[]).includes(String(ext).toLowerCase());
}

/**
 * Qué es el archivo, deducido de la extensión.
 *
 * 🔴 Lo decide el SERVIDOR a partir del path que él mismo compuso, no el
 * cliente: si el `kind` viniera del navegador, un .zip de 600 MB podría
 * registrarse como "FOTO" y la galería intentaría pintarlo con un <img>.
 */
export function eduStudyKindForExt(ext: string): EduStudyKind {
  switch (String(ext).toLowerCase()) {
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
      // Una radiografía exportada y una foto intraoral llegan las dos como
      // imagen y no hay forma de distinguirlas por el archivo. Se asume
      // RADIOGRAFIA (es lo que más sube una escuela) y la persona lo
      // corrige en el formulario: adivinar mal es reversible, obligar a
      // clasificar antes de subir es un trámite.
      return "RADIOGRAFIA";
    case "dcm":
    case "dicom":
    case "zip":
      return "TOMOGRAFIA";
    case "pdf":
      return "PDF";
    default:
      return "OTRO";
  }
}

/** Content-Type que se le pone al objeto y se guarda en la fila. */
export function eduMimeForExt(ext: string, fallback = ""): string {
  switch (String(ext).toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "zip":
      return "application/zip";
    case "dcm":
    case "dicom":
      return "application/dicom";
    case "stl":
      return "model/stl";
    case "obj":
      return "model/obj";
    default:
      return fallback || "application/octet-stream";
  }
}

/** ¿Se puede pintar dentro de la página con un <img>? */
export function eduStudyIsImage(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

/** ¿Se puede incrustar como PDF? */
export function eduStudyIsPdf(mimeType: string | null | undefined): boolean {
  return mimeType === "application/pdf";
}

/**
 * Nombre saneado para el PATH. El nombre ORIGINAL se guarda aparte en
 * `EduStudy.name` (ahí sí se muestra tal cual).
 *
 * 🔴 EL RESULTADO SIEMPRE CONSERVA LA EXTENSIÓN, y eso no es cosmético:
 * `/confirm` deduce el tipo del archivo y su validez leyendo la extensión
 * DEL PATH (que compuso el servidor), no del nombre que mandó el cliente —
 * así el tipo y la carpeta no se pueden divorciar. Un nombre que se quedara
 * sin extensión al sanearse ("漢字.zip" o "///" acaban en "_") produciría un
 * path que el propio /confirm rechaza… después de que la persona esperó la
 * subida entera de una tomografía.
 */
export function eduSafeStudyFileName(originalName: string, ext: string): string {
  const e = String(ext ?? "").toLowerCase();
  const safe = String(originalName ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80)
    // Un nombre que empieza por "." o "_" tras el recorte solo produce
    // paths feos y archivos "ocultos" en cualquier visor de objetos.
    .replace(/^[._-]+/, "");
  if (!safe) return `estudio.${e}`;
  return safe.toLowerCase().endsWith(`.${e}`) ? safe : `${safe}.${e}`;
}

/**
 * La CARPETA del paciente dentro del bucket. Lleva el institutionId
 * adelante para que el bucket quede particionado por escuela: un listado
 * por prefijo nunca cruza institutos, y un borrado equivocado se queda
 * dentro de uno.
 */
export function eduStudyPathPrefix(institutionId: string, patientId: string): string {
  return `${institutionId}/estudios/${patientId}/`;
}

/**
 * El path completo. `uuid` lo genera el servidor (crypto.randomUUID) y va
 * como parámetro para que este módulo siga siendo puro e importable desde
 * el navegador.
 */
export function eduStudyStoragePath(
  institutionId: string,
  patientId: string,
  uuid: string,
  safeName: string,
): string {
  return `${eduStudyPathPrefix(institutionId, patientId)}${uuid}-${safeName}`;
}

/**
 * Solo los caracteres que produce `eduStudyStoragePath`. Cierra `../` y
 * cualquier intento de escaparse de la carpeta aunque el prefijo coincida.
 */
const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;

export function eduStudyPathIsSafe(path: unknown): path is string {
  if (typeof path !== "string" || !path) return false;
  if (path.length > 400) return false;
  if (path.includes("..")) return false;
  return SAFE_PATH.test(path);
}

/**
 * ¿Ese path cae EXACTAMENTE en la carpeta de esta escuela y este paciente?
 *
 * Es la comprobación que impide registrar en el expediente propio un
 * archivo de otra escuela conociendo su path. Se hace en /sign (implícita:
 * el path lo compone el servidor), en /confirm y en /abort.
 */
export function eduStudyPathBelongsTo(
  path: string,
  institutionId: string,
  patientId: string,
): boolean {
  if (!eduStudyPathIsSafe(path)) return false;
  if (!institutionId || !patientId) return false;
  return path.startsWith(eduStudyPathPrefix(institutionId, patientId));
}

/** Bytes → "1.4 GB" / "930.2 MB". Para la cuota y para la tarjeta. */
export function eduFormatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Techo de estudios por consulta. */
export const EDU_STUDY_MAX_ROWS = 200;

/**
 * TTL de la URL firmada de LECTURA: una hora.
 *
 * Más larga que los 5 minutos del dental a propósito. Esta pantalla es una
 * galería que se queda abierta durante toda la sesión clínica, y una URL de
 * 5 minutos convierte "mira la radiografía otra vez" en un recargo de
 * página. La URL sigue siendo imposible de adivinar y solo la recibe quien
 * YA pasó el permiso y el alcance.
 */
export const EDU_SIGNED_URL_TTL_SECONDS = 3600;

// ═══════════════════════════════════════════════════════════════════════
// La forma que viaja a la pantalla
// ═══════════════════════════════════════════════════════════════════════

export interface EduStudyRow {
  id: string;
  kind: EduStudyKind;
  name: string;
  mimeType: string;
  /** Número, no BigInt: un BigInt no se serializa a JSON y revienta el
   *  route handler con "Do not know how to serialize a BigInt". */
  sizeBytes: number;
  sizeLabel: string;
  notes: string | null;

  caseId: string | null;
  caseProgramName: string | null;

  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
  createdLabel: string;

  /** URL FIRMADA, recién generada al leer. Nunca se guarda en la base. */
  url: string;
  /** true si se puede pintar dentro de la página. */
  isImage: boolean;
  isPdf: boolean;
}
