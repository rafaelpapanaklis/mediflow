/**
 * DaleControl INSTITUCIONAL — contrato de las FOTOS CLÍNICAS del paciente.
 *
 * Módulo PURO a propósito (sin prisma, sin supabase, sin next/server): lo
 * importan tanto los route handlers como la pantalla, para que el límite
 * que valida el servidor y el que muestra la UI sean el MISMO número. Un
 * tope duplicado es un tope que un día dice 25 MB en la pantalla y 5 MB en
 * el servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ESTA FOTO SÍ PASA POR EL SERVIDOR (y el estudio no)
 *
 * Un ESTUDIO sube DIRECTO al bucket porque una tomografía CBCT pesa
 * cientos de MB y el cuerpo de una petición en Vercel se corta muy por
 * debajo de eso (~4.5 MB). El precio de esa decisión está escrito en el
 * informe ws2-t1 §4.3: no hay compresión, no hay miniatura, y una foto de
 * celular de 8 MB se guarda entera y la galería la descarga entera.
 *
 * Una FOTO CLÍNICA es otra cosa: 25 MB de tope, y a cambio de que los
 * bytes pasen por aquí el servidor puede hacer las tres cosas que el
 * estudio no puede:
 *   1. comprobar el MIME por NÚMERO MÁGICO (los primeros bytes), no por
 *      la extensión ni por lo que declare el navegador;
 *   2. reducirla a 2 400 px JPEG q85, que es lo que evita que el
 *      expediente de un paciente pese 300 MB en fotos de celular;
 *   3. generar la MINIATURA de 300 px, sin la cual una galería de 40
 *      fotos se descarga entera para pintar cuarenta cuadraditos.
 *
 * Los 25 MB no son un capricho: son el mismo tope que el dental
 * (MAX_PHOTO_BYTES), holgado para una cámara y muy por debajo del techo
 * del cuerpo de una petición sin streaming.
 *
 * 🔴 EL PATH LO DECIDE EL SERVIDOR, SIEMPRE, y lleva el institutionId
 * ADENTRO — igual que los estudios. El cliente nunca propone un path: si
 * lo propusiera, bastaría con teclear el de otra escuela para escribir en
 * su carpeta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { EDU_SIGNED_URL_TTL_SECONDS, eduFormatBytes } from "@/lib/edu/estudios-core";
import {
  EDU_PHOTO_STAGES,
  EDU_PHOTO_TYPES,
  type EduPhotoStage,
  type EduPhotoType,
} from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// LÍMITES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tope por foto: 25 MB.
 *
 * El mismo número que el dental. Es holgado para una foto de cámara o de
 * celular (una de 48 Mpx ronda los 12 MB) y se queda muy por debajo del
 * techo de un cuerpo de petición leído de golpe.
 */
export const EDU_MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const EDU_MAX_PHOTO_LABEL = "25 MB";

/**
 * Los MIME que se aceptan, comprobados contra el NÚMERO MÁGICO del
 * contenido y no contra la extensión ni contra lo que diga el navegador.
 *
 * HEIC/HEIF están porque es lo que produce un iPhone por omisión: sin
 * ellos, la mitad de las fotos de una clínica rebotan antes de empezar.
 */
export const EDU_PHOTO_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
export type EduPhotoMime = (typeof EDU_PHOTO_MIME)[number];

/** El `accept` del <input type="file">. Derivado, no duplicado. */
export const EDU_PHOTO_ACCEPT = EDU_PHOTO_MIME.join(",");

export function eduIsPhotoMime(mime: unknown): mime is EduPhotoMime {
  return typeof mime === "string" && (EDU_PHOTO_MIME as readonly string[]).includes(mime);
}

/**
 * Los parámetros de la compresión, en UN sitio.
 *
 * Son los mismos que el dental usa en `uploadClinicalPhotoAction`, y viven
 * como constantes para que la prueba pueda fijarlos: el día que alguien
 * baje la calidad al 40 % "para ahorrar espacio", el expediente clínico
 * deja de servir para comparar y nadie se entera hasta que un docente lo
 * mira en pantalla grande.
 */
export const EDU_PHOTO_MAX_EDGE = 2400;
export const EDU_PHOTO_JPEG_QUALITY = 85;
export const EDU_PHOTO_THUMB_EDGE = 300;
export const EDU_PHOTO_THUMB_QUALITY = 80;

/**
 * Techo de fotos por consulta.
 *
 * 🔴 SE LEE `MAX + 1` Y SE DEVUELVE `truncated`, por lo mismo que las
 * notas y los estudios: una galería que corta y CALLA le dice al alumno
 * que la foto del "antes" no se subió nunca.
 */
export const EDU_PHOTO_MAX_ROWS = 200;

/**
 * TTL de la URL firmada de lectura. El MISMO que el de los estudios
 * (una hora), importado y no copiado: dos números para lo mismo es cómo
 * se llega a que la galería caduque a los 5 minutos y el visor a los 60.
 */
export const EDU_PHOTO_SIGNED_URL_TTL_SECONDS = EDU_SIGNED_URL_TTL_SECONDS;

// ═══════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE LA SUBIDA
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿Se puede aceptar este archivo? Devuelve el ERROR escrito para una
 * persona, o null si pasa.
 *
 * 🔴 Es lo que se comprueba ANTES de gastar CPU comprimiendo y ANTES de
 * escribir un byte en el bucket. El MIME que llega aquí es el DECLARADO;
 * quien llama vuelve a comprobarlo contra el número mágico del contenido,
 * porque `file.type` lo elige el navegador y se puede falsear.
 *
 * ⚠️ `size` de 0 se rechaza: un archivo vacío pasa cualquier tope y
 * produce una fila con una foto que no se puede abrir.
 */
export function eduValidarFotoSubida(input: {
  mime?: unknown;
  size?: unknown;
}): string | null {
  if (!eduIsPhotoMime(input?.mime)) {
    return (
      "Ese formato no se acepta como foto clínica. Se aceptan JPEG, PNG, WebP y HEIC/HEIF " +
      "(lo que produce un iPhone)."
    );
  }
  const size = Number(input?.size);
  if (!Number.isFinite(size) || size <= 0) {
    return "El archivo llegó vacío. Vuelve a elegirlo e inténtalo de nuevo.";
  }
  if (size > EDU_MAX_PHOTO_BYTES) {
    return (
      `Esa foto pesa ${eduFormatBytes(size)} y el máximo por foto es ${EDU_MAX_PHOTO_LABEL}. ` +
      "Si viene de una cámara, exporta una versión más chica y vuelve a subirla."
    );
  }
  return null;
}

/** El valor de etapa que manda el cliente, o `null` si no es uno de los cuatro. */
export function eduParsePhotoStage(raw: unknown): EduPhotoStage | null {
  return typeof raw === "string" && (EDU_PHOTO_STAGES as string[]).includes(raw)
    ? (raw as EduPhotoStage)
    : null;
}

/** La vista que manda el cliente, o `null` si no es una de las diez. */
export function eduParsePhotoType(raw: unknown): EduPhotoType | null {
  return typeof raw === "string" && (EDU_PHOTO_TYPES as string[]).includes(raw)
    ? (raw as EduPhotoType)
    : null;
}

/**
 * La fecha de TOMA que manda el cliente.
 *
 * Devuelve `null` si no es una fecha válida — quien llama cae a "ahora",
 * que es la verdad más probable y nunca deja la columna vacía.
 *
 * ⚠️ Una fecha en el FUTURO se rechaza: una foto tomada mañana ordena mal
 * el comparador para siempre, y un dedazo en el año ("2036") es la forma
 * más común de conseguirla. Se admite un margen de un día para no pelearse
 * con la zona horaria del navegador.
 */
export const EDU_PHOTO_FUTURO_MS = 24 * 60 * 60 * 1000;

export function eduParseCapturedAt(raw: unknown, now: Date = new Date()): Date | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  if (t > now.getTime() + EDU_PHOTO_FUTURO_MS) return null;
  return d;
}

// ═══════════════════════════════════════════════════════════════════════
// EL PATH DENTRO DEL BUCKET
// ═══════════════════════════════════════════════════════════════════════

/**
 * La CARPETA de las fotos de un paciente dentro de `edu-files`.
 *
 * 🔴 EL institutionId VA ADELANTE, como en `eduStudyPathPrefix`, y no
 * detrás de un "fotos/" global: es lo que hace que el bucket quede
 * particionado POR ESCUELA. Con `fotos/<institutionId>/…`, un listado por
 * el prefijo `fotos/` cruzaría institutos; con esto, listar `<inst>/` da
 * todo lo de una escuela y nada de las demás, y un borrado equivocado se
 * queda dentro de una.
 */
export function eduPhotoPathPrefix(institutionId: string, patientId: string): string {
  return `${institutionId}/fotos/${patientId}/`;
}

/**
 * El path completo de la foto. `uuid` lo genera el servidor
 * (crypto.randomUUID) y va como parámetro para que este módulo siga siendo
 * puro e importable desde el navegador.
 */
export function eduPhotoStoragePath(
  institutionId: string,
  patientId: string,
  uuid: string,
  safeName: string,
): string {
  return `${eduPhotoPathPrefix(institutionId, patientId)}${uuid}-${safeName}`;
}

/**
 * El path de la MINIATURA, derivado del mismo uuid.
 *
 * Vive en la MISMA carpeta que su foto a propósito: dar de baja una foto
 * tiene que poder llevarse su miniatura sin buscarla en otro sitio, y las
 * dos caen dentro del mismo `eduPhotoPathBelongsTo`.
 */
export function eduPhotoThumbPath(
  institutionId: string,
  patientId: string,
  uuid: string,
): string {
  return `${eduPhotoPathPrefix(institutionId, patientId)}${uuid}-thumb.webp`;
}

/**
 * Nombre saneado para el PATH. El nombre original NO se guarda: a
 * diferencia de un estudio, una foto se identifica por su vista y su
 * etapa, no por cómo la llamó el teléfono ("IMG_4821.HEIC").
 */
export function eduSafePhotoFileName(originalName: unknown, ext: string): string {
  const e = String(ext ?? "").toLowerCase() || "jpg";
  const safe = String(originalName ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-60)
    .replace(/^[._-]+/, "")
    .toLowerCase();
  if (!safe) return `foto.${e}`;
  // Se REEMPLAZA la extensión original en vez de conservarla: el binario
  // que se guarda es el COMPRIMIDO, y un ".heic" en el path de un JPEG es
  // una mentira que el visor acaba creyéndose.
  const sinExt = safe.replace(/\.[a-z0-9]{1,5}$/, "") || "foto";
  return `${sinExt}.${e}`;
}

/** La extensión que le toca al binario ya comprimido, según su MIME. */
export function eduPhotoExtForMime(mime: string): string {
  switch (String(mime).toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

/** Solo los caracteres que produce `eduPhotoStoragePath`. Cierra `../`. */
const SAFE_PATH = /^[a-zA-Z0-9/._-]+$/;

export function eduPhotoPathIsSafe(path: unknown): path is string {
  if (typeof path !== "string" || !path) return false;
  if (path.length > 400) return false;
  if (path.includes("..")) return false;
  return SAFE_PATH.test(path);
}

/**
 * ¿Ese path cae EXACTAMENTE en la carpeta de esta escuela y este paciente?
 *
 * Es la comprobación que impide que un path de otra escuela acabe firmado
 * o borrado desde aquí. Se aplica a la foto Y a su miniatura.
 */
export function eduPhotoPathBelongsTo(
  path: string,
  institutionId: string,
  patientId: string,
): boolean {
  if (!eduPhotoPathIsSafe(path)) return false;
  if (!institutionId || !patientId) return false;
  return path.startsWith(eduPhotoPathPrefix(institutionId, patientId));
}

// ═══════════════════════════════════════════════════════════════════════
// LA FORMA QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduPhotoRow {
  id: string;
  photoType: EduPhotoType;
  stage: EduPhotoStage;
  /** ISO. Es la columna por la que ORDENA el comparador. */
  capturedAt: string;
  /** "12 mar 2026" — la fecha ya escrita, en la zona del instituto. */
  capturedLabel: string;

  mime: string;
  /** Número, no BigInt: un BigInt revienta el route handler al serializar. */
  sizeBytes: number;
  sizeLabel: string;
  width: number | null;
  height: number | null;

  notes: string | null;

  caseId: string | null;
  caseProgramName: string | null;

  uploadedById: string;
  uploadedByName: string;
  createdAt: string;

  /** URL FIRMADA, recién generada al leer. Nunca se guarda en la base. */
  url: string;
  /** URL firmada de la miniatura, o "" si no tiene (compresión fallida). */
  thumbUrl: string;
}

/**
 * Una página de fotos: las filas Y si se quedó algo fuera.
 *
 * Misma forma que `EduStudyPage` y que `EduRecordPage` — la bandera viaja
 * pegada a las filas para que no exista una pantalla que reciba las fotos
 * y se olvide de preguntar si estaban todas.
 */
export interface EduPhotoPage {
  rows: EduPhotoRow[];
  truncated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// LA GALERÍA Y EL COMPARADOR — puros, y aquí porque son lo que se prueba
// ═══════════════════════════════════════════════════════════════════════

export interface EduPhotoGrupo {
  stage: EduPhotoStage;
  rows: EduPhotoRow[];
}

/**
 * Las fotos AGRUPADAS por etapa, en el orden PRE → DURANTE → POST →
 * CONTROL y, dentro de cada grupo, de la más antigua a la más reciente.
 *
 * Devuelve SIEMPRE los cuatro grupos, incluidos los vacíos: una galería
 * que esconde el grupo "Antes" cuando está vacío no le dice a nadie que
 * falta el antes, que es justo lo que hay que ver.
 */
export function eduAgruparFotosPorEtapa(rows: EduPhotoRow[]): EduPhotoGrupo[] {
  const lista = Array.isArray(rows) ? rows : [];
  return EDU_PHOTO_STAGES.map((stage) => ({
    stage,
    rows: lista.filter((r) => r?.stage === stage).sort(porFecha),
  }));
}

/** Ascendente por fecha de TOMA. Empates: por id, para que sea estable. */
function porFecha(a: EduPhotoRow, b: EduPhotoRow): number {
  const ta = Date.parse(a?.capturedAt ?? "");
  const tb = Date.parse(b?.capturedAt ?? "");
  const va = Number.isFinite(ta) ? ta : 0;
  const vb = Number.isFinite(tb) ? tb : 0;
  if (va !== vb) return va - vb;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

export interface EduPhotoPar {
  a: EduPhotoRow | null;
  b: EduPhotoRow | null;
}

/**
 * EL PAR QUE PROPONE EL COMPARADOR: A = "antes", B = "después".
 *
 * Réplica exacta de lo que hace `PhotoCompareSlider` del dental, escrita
 * aquí —en un módulo puro y con su prueba— en vez de dentro del
 * componente:
 *
 *   1. ordena TODO por `capturedAt` ascendente;
 *   2. A = la primera con `stage === "PRE"`; si no hay ninguna, la más
 *      antigua de todas;
 *   3. B = la última con `stage` POST o CONTROL **que no sea A**; si no
 *      hay, la más reciente de todas;
 *   4. la pantalla deja cambiar A y B a mano; esto es solo la propuesta.
 *
 * 🔴 Con una sola foto devuelve la MISMA en A y en B, y eso es correcto:
 * el comparador enseña "hace falta otra foto" y no se cae. Con cero
 * devuelve los dos en null.
 *
 * ⚠️ El descarte `p.id !== a.id` del paso 3 no es cosmético: sin él, una
 * galería con una única foto marcada CONTROL se compararía consigo misma
 * y el deslizador no movería nada, que se ve exactamente igual que un bug.
 */
export function eduParFotosComparador(rows: EduPhotoRow[]): EduPhotoPar {
  const orden = (Array.isArray(rows) ? [...rows] : []).sort(porFecha);
  if (orden.length === 0) return { a: null, b: null };

  const a = orden.find((p) => p.stage === "PRE") ?? orden[0];

  const alReves = [...orden].reverse();
  const b =
    alReves.find((p) => (p.stage === "POST" || p.stage === "CONTROL") && p.id !== a.id) ??
    orden[orden.length - 1];

  return { a, b };
}

/** ¿Hay material para comparar de verdad (dos fotos distintas)? */
export function eduPuedeCompararFotos(rows: EduPhotoRow[]): boolean {
  const par = eduParFotosComparador(rows);
  return Boolean(par.a && par.b && par.a.id !== par.b.id);
}

/** Cuántas hay en cada etapa. Para las píldoras de filtro con contador. */
export function eduContarFotosPorEtapa(rows: EduPhotoRow[]): Record<EduPhotoStage, number> {
  const out = { PRE: 0, DURANTE: 0, POST: 0, CONTROL: 0 } as Record<EduPhotoStage, number>;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && (EDU_PHOTO_STAGES as string[]).includes(r.stage)) out[r.stage] += 1;
  }
  return out;
}
