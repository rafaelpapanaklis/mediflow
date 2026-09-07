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
    // Ola 12: las mallas dejan de caer en OTRO. Con su propio tipo, la
    // galería puede filtrar "Modelos 3D" y ofrecer el visor sin adivinar
    // por extensión — y el filtro no depende de re-parsear el nombre.
    case "stl":
    case "ply":
    case "obj":
      return "MODELO_3D";
    default:
      return "OTRO";
  }
}

/**
 * Ola 12 — el `kind` FINAL de un estudio, con la corrección del cliente
 * SOLO donde la extensión no alcanza a decidir.
 *
 * Una imagen (jpg/png/webp) puede ser una radiografía exportada o una foto
 * intraoral, y no hay forma de distinguirlas por el archivo: ahí (y SOLO
 * ahí) se acepta lo que eligió la persona en el formulario. Para todo lo
 * demás manda la extensión del path que compuso el servidor: aceptar
 * "FOTO" sobre un .zip de 600 MB haría que la galería intentara pintarlo
 * con un <img>, que es exactamente lo que esta función existe para
 * impedir. Un valor desconocido o incompatible se IGNORA en silencio y
 * gana la extensión: rebotar la subida entera por un radio mal tocado
 * sería castigar a quien ya esperó los megas.
 */
const EDU_IMAGE_KINDS: EduStudyKind[] = ["RADIOGRAFIA", "FOTO"];

export function eduResolveStudyKind(ext: string, rawKind: unknown): EduStudyKind {
  const porExtension = eduStudyKindForExt(ext);
  if (porExtension !== "RADIOGRAFIA") return porExtension;
  if (typeof rawKind !== "string") return porExtension;
  return (EDU_IMAGE_KINDS as string[]).includes(rawKind)
    ? (rawKind as EduStudyKind)
    : porExtension;
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
    case "ply":
      // Ola 12: tenía que caer al fallback octet-stream. Con tipo propio,
      // el visor y las descargas dicen qué es sin mirar la extensión.
      return "model/ply";
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

/**
 * Bytes → "5.0 TB" / "1.4 GB" / "930.2 MB". Para la cuota y para la tarjeta.
 *
 * 🔴 ES EL ÚNICO FORMATEADOR DE BYTES DEL VERTICAL. La cuota de
 * almacenamiento (src/lib/edu/almacenamiento-core.ts) le agregó el tramo de
 * TB en vez de escribir el suyo: con dos, el día que alguien cambie el
 * redondeo, la misma escuela leería "5.0 TB" en un sitio y "5120.0 GB" en
 * otro y no habría forma de saber cuál está bien.
 */
export function eduFormatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  // TB: sin este tramo, una cuota de 5 TB se lee "5120.0 GB" — un número
  // que nadie compara de cabeza contra un contrato que dice "5 TB".
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * Techo de estudios por consulta.
 *
 * 🔴 SE LEE `MAX + 1` Y SE DEVUELVE `truncated`, por lo mismo que las
 * notas (ver EDU_RECORD_MAX_ROWS en expediente-core.ts): una galería que
 * corta en 200 y calla le dice al alumno que la panorámica de hace año y
 * medio no se subió nunca. Medido con el instituto de demo: 240 estudios,
 * se pintaban 200, sin una palabra.
 */
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

  /**
   * ws2-t2 · LA EXTENSIÓN REAL DEL ARCHIVO, sacada del PATH que compuso el
   * servidor ("jpg", "zip", "stl"…).
   *
   * 🔴 VIAJA PORQUE AHORA SE PUEDE RENOMBRAR. Hasta hoy la pantalla
   * deducía qué visor abrir y qué icono pintar de `name`, y daba igual
   * porque `name` era el nombre con el que se subió. Desde que se puede
   * corregir el nombre, alguien puede dejarlo en "panorámica de Ana" —sin
   * extensión— y entonces `eduVisorPorExtension(name)` no encontraría el
   * visor de una tomografía que SÍ es un .zip. El path no sale del
   * servidor nunca; su extensión, sí, que es lo único que la pantalla
   * necesita y no puede mentir.
   */
  ext: string;

  /**
   * ws2-t2 · CUÁNDO SE TOMÓ (ISO), o null si nadie lo capturó.
   *
   * No es `createdAt`: una placa de hace un año subida hoy se ordenaba
   * como si fuera de hoy, y el expediente contaba una historia falsa.
   */
  takenAt: string | null;
  /** "mié, 12 mar" — la fecha de TOMA ya escrita, o "" si no hay. */
  takenLabel: string;
  /**
   * La fecha con la que se ORDENA la galería: la de toma cuando existe y
   * la de subida cuando no (el `COALESCE(takenAt, createdAt)` que pide el
   * esquema). Viaja resuelta desde el servidor para que la pantalla no
   * tenga que repetir la regla — ni equivocarse en la mitad de los sitios.
   */
  ordenAt: string;
  /** true si `ordenAt` salió de `takenAt`. Es lo que deja DECIRLO. */
  ordenPorToma: boolean;

  /**
   * ws2-t2 · Las MARCAS sobre la imagen (x/y relativos 0-1 + etiqueta).
   * Siempre un arreglo, nunca null: una lista vacía y "no hay" son lo
   * mismo aquí, y un null obliga a un `?? []` en cada sitio que la pinte.
   */
  annotations: EduStudyMark[];

  /** URL FIRMADA, recién generada al leer. Nunca se guarda en la base. */
  url: string;
  /** true si se puede pintar dentro de la página. */
  isImage: boolean;
  isPdf: boolean;
}

/**
 * Una página de estudios: las filas Y si se quedó algo fuera.
 *
 * Misma forma que `EduRecordPage` y que el resto del panel — la bandera
 * viaja pegada a las filas para que no exista una pantalla que reciba los
 * estudios y se olvide de preguntar si estaban todos.
 */
export interface EduStudyPage {
  rows: EduStudyRow[];
  truncated: boolean;
  /**
   * S-9 · CUÁNDO SE FIRMARON estas URLs (ISO).
   *
   * Las URLs de los archivos caducan a la hora (EDU_SIGNED_URL_TTL_SECONDS)
   * y esta pantalla se queda abierta TODA la sesión clínica — que es
   * exactamente por lo que el TTL es de una hora y no de cinco minutos.
   * Pasado ese rato, cada miniatura y cada "Abrir" contestan un 403 que se
   * lee como "el archivo se perdió".
   *
   * Con este sello la pantalla sabe cuándo va a pasar y lo dice ANTES,
   * ofreciendo actualizar. Viaja desde el servidor y no se calcula al
   * montar el componente: entre que el servidor firma y el navegador pinta
   * puede haber un rato (una pestaña restaurada, una conexión lenta).
   */
  signedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// ws2-t2 · EL RASTRO: retirar, corregir, ordenar y anotar
//
// Todo lo PURO de "un estudio se puede corregir y se puede retirar" vive
// aquí, y no dentro del route handler ni del componente, por la misma
// razón que los topes: lo que valida el servidor y lo que ofrece la
// pantalla tienen que ser LA MISMA regla. Un desplegable que ofrece
// "Modelo 3D" para un `.jpg` produce un 400 que la persona lee como un
// fallo del panel.
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 NADA SE BORRA: RETIRAR ES UNA BAJA SUAVE, Y EXIGE MOTIVO.
 *
 * El tope del motivo es el `@db.VarChar(500)` del esquema. Es obligatorio
 * por lo mismo que en las fotos: sin él, "retirar" y "borrar" son la misma
 * cosa con distinto nombre, y dentro de un año la fila dice que alguien lo
 * quitó y no dice por qué — que es justo la pregunta que se hace.
 */
export const EDU_STUDY_MOTIVO_MAX = 500;

/**
 * Lo que se le contesta a quien intenta LIMPIAR (abort) un archivo que ya
 * es parte del expediente.
 *
 * Antes decía solo «Ese archivo ya está registrado en el expediente» y ahí
 * se acababa la conversación: el alumno que acababa de subir la panorámica
 * al paciente equivocado leía un 409 y no tenía a dónde ir. Ahora dice a
 * dónde ir. El texto vive aquí —y no dentro del handler— porque hay una
 * prueba que lo fija: el día que alguien lo recorte a "409", la salida
 * vuelve a desaparecer.
 */
export const EDU_STUDY_ABORT_YA_REGISTRADO =
  "Ese archivo ya está registrado en el expediente, así que esta puerta no lo saca: " +
  "aquí solo se limpia lo que se subió a medias. Si se subió por error, ábrelo en " +
  "Estudios y usa «Retirar» — deja constancia de quién lo retiró y por qué, y el " +
  "archivo no se destruye.";

/**
 * La lista de valores del enum, aquí y no importada de types.ts, para que
 * este módulo siga sin depender de nada más que de su propio tipo. El
 * candado de que no se desincronice es un chequeo de TIPOS en
 * edu-estudios-rastro.test.ts (lo verifica `tsc --noEmit`).
 */
const EDU_STUDY_KINDS_SET: EduStudyKind[] = [
  "RADIOGRAFIA",
  "TOMOGRAFIA",
  "FOTO",
  "PDF",
  "OTRO",
  "MODELO_3D",
];

/**
 * ¿SE PUEDE RECLASIFICAR un estudio a ese `kind`?
 *
 * 🔴 SOLO ENTRE LOS COMPATIBLES CON LA EXTENSIÓN, y quien lo decide es
 * `eduResolveStudyKind`, que ya existía y ya tenía su prueba: se le
 * pregunta, y si lo que devuelve NO es lo que se pidió, es que la
 * extensión manda. Reimplementar la regla aquí sería tener dos.
 *
 * En la práctica: una imagen (.jpg/.png/.webp) puede ir y venir entre
 * RADIOGRAFIA y FOTO —que es la corrección que de verdad se necesita,
 * porque el servidor asume RADIOGRAFIA para toda imagen— y ningún `.zip`
 * puede convertirse en "Foto", que es lo que haría que la galería
 * intentara pintar 600 MB con un `<img>`.
 *
 * Devuelve el ERROR escrito para una persona, o null si pasa.
 */
export function eduValidarReclasificacion(ext: string, kind: unknown): string | null {
  if (typeof kind !== "string" || !(EDU_STUDY_KINDS_SET as readonly string[]).includes(kind)) {
    return "Ese tipo de estudio no existe.";
  }
  const resuelto = eduResolveStudyKind(ext, kind);
  if (resuelto === kind) return null;
  return (
    `Un archivo .${String(ext).toLowerCase()} no se puede clasificar así: por su formato es ` +
    `“${resuelto}”. Lo único que se corrige a mano es si una imagen es radiografía o foto ` +
    "clínica, porque ahí el archivo no lo dice."
  );
}

/**
 * Los tipos que TIENEN SENTIDO ofrecerle a una persona para ese archivo.
 *
 * La pantalla pinta esto y no la lista entera: un desplegable con seis
 * opciones de las que cinco rebotan no es una elección, es una trampa.
 * Sale de la MISMA función que valida, así que no se pueden separar.
 */
export function eduReclasificacionesPosibles(ext: string): EduStudyKind[] {
  return EDU_STUDY_KINDS_SET.filter((k) => eduResolveStudyKind(ext, k) === k);
}

/**
 * La FECHA DE TOMA que manda el cliente, o null si no la manda.
 *
 * ⚠️ Una fecha en el FUTURO se rechaza (devuelve `false`, que quien llama
 * traduce a 400): igual que en las fotos, una placa "tomada mañana"
 * desordena la galería para siempre y un dedazo en el año es la forma más
 * común de conseguirla. Se admite un día de margen para no pelearse con la
 * zona horaria del navegador.
 *
 * Tres respuestas y no dos, a propósito:
 *   · `undefined` → no vino: no se toca la columna;
 *   · `null`      → vino vacía: se BORRA la fecha de toma (vuelve a
 *                   ordenarse por la de subida);
 *   · `Date`      → la fecha.
 * `false` es "vino y no vale".
 */
export const EDU_STUDY_FUTURO_MS = 24 * 60 * 60 * 1000;

export function eduParseTakenAt(
  raw: unknown,
  now: Date = new Date(),
): Date | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  const t = d.getTime();
  if (!Number.isFinite(t)) return false;
  if (t > now.getTime() + EDU_STUDY_FUTURO_MS) return false;
  return d;
}

// ── EL ORDEN DE LA GALERÍA ─────────────────────────────────────────────

/**
 * La fecha con la que se ORDENA un estudio: la de TOMA si la hay, y si no
 * la de subida.
 *
 * 🔴 Es el `COALESCE(takenAt, createdAt)` que pide el comentario de la
 * columna en el esquema, escrito UNA vez. Sin esto, la mitad de las
 * pantallas ordenaría por `createdAt` y la otra mitad por `takenAt`, y la
 * misma radiografía saldría en dos sitios distintos de la misma lista.
 */
export function eduStudyOrdenISO(row: {
  takenAt?: string | null;
  createdAt: string;
}): { iso: string; porToma: boolean } {
  const t = row?.takenAt ? Date.parse(row.takenAt) : NaN;
  if (Number.isFinite(t)) return { iso: row.takenAt as string, porToma: true };
  return { iso: row?.createdAt ?? "", porToma: false };
}

/**
 * La galería, de la más reciente a la más antigua POR FECHA DE TOMA.
 *
 * ⚠️ Se ordena en memoria y no en la consulta, y hay que decirlo: Prisma
 * no sabe ordenar por `COALESCE(takenAt, createdAt)` sin bajar a SQL
 * crudo, y `orderBy: [{takenAt: 'desc'}, {createdAt:'desc'}]` NO es lo
 * mismo — pondría todas las que tienen fecha de toma antes que todas las
 * que no, aunque la de subida sea de anteayer.
 *
 * La CONSECUENCIA, dicha en voz alta: el recorte de los 200 sigue siendo
 * por fecha de SUBIDA (es lo que hace la consulta), así que lo que se
 * pierde al truncar son los 200 subidos más recientemente, reordenados
 * después por toma. Con 200 estudios en un paciente es un caso de
 * laboratorio; la pantalla ya avisa de que cortó.
 *
 * Empates: por id, para que el orden sea ESTABLE. Sin eso, dos placas
 * tomadas el mismo día bailan entre recarga y recarga.
 */
export function eduOrdenarEstudios<T extends { id: string; takenAt?: string | null; createdAt: string }>(
  rows: T[],
): T[] {
  return (Array.isArray(rows) ? [...rows] : []).sort((a, b) => {
    const ta = Date.parse(eduStudyOrdenISO(a).iso);
    const tb = Date.parse(eduStudyOrdenISO(b).iso);
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    if (va !== vb) return vb - va;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}

/** Lo que la pantalla DICE sobre su propio orden. Un orden que no se
 *  explica se lee como un orden roto. */
export const EDU_STUDY_ORDEN_NOTA =
  "Ordenados por fecha de toma cuando se registró; los que no la tienen, por la de subida.";

// ── LAS ANOTACIONES SOBRE LA IMAGEN ────────────────────────────────────

/**
 * UNA MARCA sobre la imagen.
 *
 * 🔴 `x` e `y` son RELATIVOS (0 a 1), no píxeles, y ésa es toda la
 * decisión: la misma radiografía se pinta a 320 px en un teléfono y a
 * 900 en un monitor, y una marca en píxeles apuntaría a otro diente en
 * cada pantalla. Con relativos, la marca cae donde tiene que caer sin
 * saber nada del tamaño.
 */
export interface EduStudyMark {
  /** 0 = borde izquierdo, 1 = borde derecho. */
  x: number;
  /** 0 = borde superior, 1 = borde inferior. */
  y: number;
  /** Lo que dice la marca. Recortado a 80: es una etiqueta, no una nota. */
  label: string;
}

export const EDU_STUDY_MARK_LABEL_MAX = 80;
/**
 * Techo de marcas por estudio. No es una limitación técnica: cincuenta
 * etiquetas encima de una panorámica no se leen, y el JSON de la columna
 * tampoco es un lugar para meter un cuaderno.
 */
export const EDU_STUDY_MAX_MARKS = 40;

function numeroEn01(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // Se PINZA en vez de rechazar: un arrastre que se sale un píxel del
  // marco es un gesto normal, no un dato corrupto.
  return Math.min(1, Math.max(0, n));
}

/**
 * El JSON de la columna → marcas de verdad.
 *
 * 🔴 NUNCA REVIENTA Y NUNCA DEVUELVE null. `annotations` es una columna
 * Json: puede traer lo que sea (una versión vieja, algo escrito a mano,
 * un objeto en vez de un arreglo). Lo que no encaja se DESCARTA en
 * silencio y lo que encaja se conserva — un visor que se cae por una
 * marca mal escrita deja al paciente sin su radiografía por una etiqueta.
 */
export function eduParseStudyMarks(raw: unknown): EduStudyMark[] {
  if (!Array.isArray(raw)) return [];
  const out: EduStudyMark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const x = numeroEn01(o.x);
    const y = numeroEn01(o.y);
    if (x === null || y === null) continue;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, EDU_STUDY_MARK_LABEL_MAX) : "";
    if (!label) continue;
    out.push({ x, y, label });
    if (out.length >= EDU_STUDY_MAX_MARKS) break;
  }
  return out;
}

/**
 * Marcas → lo que se guarda en la columna.
 *
 * Devuelve `null` cuando no queda ninguna: una columna Json con `[]` y una
 * vacía significan lo mismo y `null` es lo que ya tienen las filas que
 * nadie ha anotado. Dos representaciones de "sin marcas" es cómo se llega
 * a un `if` que solo mira una.
 */
export function eduSerializeStudyMarks(marks: unknown): EduStudyMark[] | null {
  const limpias = eduParseStudyMarks(marks);
  return limpias.length > 0 ? limpias : null;
}

// ── LA FECHA DE UN DÍA, SIN QUE SE CORRA UNO ───────────────────────────

/**
 * "2026-03-12" (lo que da un `<input type="date">`) → el instante que se
 * manda al servidor.
 *
 * 🔴 MEDIODÍA UTC Y NO MEDIANOCHE, y no es manía: la fecha de toma se
 * escribe en la base como un instante y se vuelve a leer en la ZONA DEL
 * INSTITUTO (`eduUtcToZoned`). Con `T00:00:00Z`, en cualquier zona al
 * oeste de Greenwich —México, todas— ese instante cae en el día ANTERIOR,
 * y la placa que el alumno fechó el 12 aparece rotulada el 11. Con
 * mediodía hay 12 horas de margen a cada lado: el día es el mismo de
 * UTC-11 a UTC+11.
 *
 * Es el mismo truco que ya usa `pagos-core.ts` para las fechas de las
 * mensualidades, y por el mismo susto.
 *
 * Devuelve "" si el día no tiene la forma de un día: quien llama manda
 * `undefined` y el servidor deja la columna como estaba.
 */
export function eduDiaISOaInstante(dia: unknown): string {
  const d = typeof dia === "string" ? dia.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return `${d}T12:00:00.000Z`;
}

/**
 * El instante que devuelve el servidor → lo que quiere un
 * `<input type="date">`.
 *
 * Se lee en UTC (`slice(0,10)`), que es la misma convención que
 * `eduDateInputValue` del padrón. Con lo que escribe `eduDiaISOaInstante`
 * el viaje de ida y vuelta es exacto: mediodía UTC recorta al mismo día en
 * el que se escribió.
 */
export function eduInstanteADiaInput(iso: unknown): string {
  const s = typeof iso === "string" ? iso : "";
  if (!s) return "";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════
// ws2-t2 (afinado) · LO RETIRADO, PARA QUE EL MOTIVO SE PUEDA LEER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Una fila de la sección plegada «Retirados».
 *
 * 🔴 EXISTE PORQUE EL MOTIVO ERA OBLIGATORIO, SE GUARDABA… Y NO LO LEÍA
 * NADIE. Los dos modales prometen lo mismo con todas sus letras —«es lo que
 * contesta la pregunta dentro de un año»— y hasta hoy esa pregunta solo se
 * contestaba en Postgres: no había una sola consulta con
 * `deletedAt: { not: null }` fuera del historial del odontograma.
 *
 * La forma es la MISMA para un estudio y para una foto a propósito: las dos
 * bajas son la misma decisión de producto (suave, con autor y con motivo, y
 * el binario se conserva), así que las dos se leen igual y la pantalla que
 * las pinta no tiene que saber cuál está mirando.
 */
export interface EduRetiradoRow {
  id: string;
  /** QUÉ era: el nombre del estudio, o «Sonrisa · Antes · 12 mar». */
  que: string;
  /** QUIÉN lo retiró. "" si la fila perdió a su autor (usuario borrado). */
  quien: string;
  /** CUÁNDO, ya escrito en la zona del instituto. */
  cuando: string;
  /** POR QUÉ. "" solo en filas viejas anteriores al motivo obligatorio. */
  porQue: string;
}

/**
 * Techo de la sección «Retirados».
 *
 * Es corta a propósito y no paginada: esto no es un archivo histórico, es
 * la respuesta a «¿por qué no está la panorámica que subí ayer?». Con más
 * de esto, la pregunta ya no es de esta pantalla.
 */
export const EDU_RETIRADOS_MAX_ROWS = 50;
