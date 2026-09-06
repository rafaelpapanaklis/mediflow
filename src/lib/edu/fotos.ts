/**
 * DaleControl INSTITUCIONAL — las FOTOS CLÍNICAS contra la base de datos y
 * contra Storage.
 *
 * SERVIDOR: importa prisma y el helper del bucket. Lo puro (topes, MIME,
 * paths, la agrupación por etapa y el par del comparador) vive en
 * fotos-core.ts; aquí solo hay consultas, compresión y Storage.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 AQUÍ EL BINARIO SÍ PASA POR EL SERVIDOR, Y ES LA DIFERENCIA ENTERA
 * CON LOS ESTUDIOS.
 *
 * Los estudios suben directo al bucket porque una tomografía pesa cientos
 * de MB. El precio: nadie puede mirar esos bytes, así que no hay
 * compresión, no hay miniatura y no hay comprobación del contenido real.
 *
 * Una foto clínica cabe en 25 MB, así que se hace lo contrario y en este
 * orden, que importa:
 *   1. permiso + alcance clínico + paciente de ESTE instituto
 *   2. MIME y tamaño DECLARADOS (rechazo barato, antes de leer nada más)
 *   3. NÚMERO MÁGICO del contenido — el `file.type` lo elige el navegador
 *   4. CUOTA del instituto, ANTES de escribir un byte en el bucket
 *   5. compresión con sharp (2 400 px JPEG q85) y miniatura (300 px WebP
 *      q80), las dos BEST-EFFORT
 *   6. subida del binario, subida de la miniatura, y la fila al final
 *
 * 🔴 EL PASO 6 VA AL FINAL A PROPÓSITO. Si la fila se creara antes de
 * subir, un fallo de Storage dejaría un expediente con una foto que no
 * existe. Al revés —objeto sin fila— el peor caso es un huérfano en el
 * bucket, que es el mismo modo de fallo que ya tienen los estudios y que
 * se limpia con un barrido; una foto fantasma en el expediente no se
 * limpia con nada porque nadie sabe que está mal.
 *
 * 🔴 EL ALCANCE ES EL DEL EXPEDIENTE (recurso "cases"), igual que las
 * notas, el odontograma y los estudios: las fotos cuelgan del PACIENTE
 * porque la cara y la boca son las mismas para la ortodoncia y para la
 * periodoncia, pero CAJA NO LAS VE. Eso lo decide el alcance, no la tabla.
 *
 * 🔴 PERMISOS: los que YA EXISTEN. `estudios.view` para mirar y
 * `estudios.upload` para subir, corregir y dar de baja. No se inventa
 * ninguna key nueva: una foto clínica es un archivo del expediente y quien
 * puede subir una radiografía puede subir una foto.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduCleanId,
  eduFormatDayShort,
  eduOptionalText,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { eduFormatBytes } from "@/lib/edu/estudios-core";
import {
  EDU_MAX_PHOTO_BYTES,
  EDU_PHOTO_JPEG_QUALITY,
  EDU_PHOTO_MAX_EDGE,
  EDU_PHOTO_MAX_ROWS,
  EDU_PHOTO_MIME,
  EDU_PHOTO_THUMB_EDGE,
  EDU_PHOTO_THUMB_QUALITY,
  eduParseCapturedAt,
  eduParsePhotoStage,
  eduParsePhotoType,
  eduPhotoExtForMime,
  eduPhotoStoragePath,
  eduPhotoThumbPath,
  eduSafePhotoFileName,
  eduValidarFotoSubida,
  type EduPhotoPage,
  type EduPhotoRow,
} from "@/lib/edu/fotos-core";
import { eduAlmCabe, eduAlmRechazo } from "@/lib/edu/almacenamiento-core";
import { getEduAlmacenamientoMedidor } from "@/lib/edu/almacenamiento";
import {
  eduSignRead,
  eduSignReadMany,
  eduStorageConfigured,
  eduStorageUpload,
} from "@/lib/edu/storage";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import type { EduPhotoStage, EduPhotoType } from "@/lib/edu/types";

export { EduPadronError as EduFotosError };
export type { EduPhotoRow, EduPhotoPage } from "@/lib/edu/fotos-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function requireStorage(): void {
  if (!eduStorageConfigured()) {
    throw new EduPadronError(
      "El almacenamiento de archivos no está configurado en este entorno. Avísale a quien administra el instituto.",
      503,
    );
  }
}

async function requireClinicalPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date,
): Promise<string> {
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no te toca.", 404);
  return paciente.id;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

/** "mié, 12 mar" en la zona del instituto. La fecha de TOMA, no la de subida. */
function dayLabel(d: Date, timeZone: string): string {
  const { dayISO } = eduUtcToZoned(d, eduSafeTimeZone(timeZone));
  return eduFormatDayShort(dayISO);
}

/**
 * BigInt → number. `JSON.stringify` no sabe serializar un BigInt y revienta
 * el route handler. El tope por foto son 25 MB, muy por debajo de
 * Number.MAX_SAFE_INTEGER: la conversión no pierde un byte.
 */
function bytesToNumber(v: bigint): number {
  return Number(v);
}

const PHOTO_SELECT = {
  id: true,
  photoType: true,
  stage: true,
  capturedAt: true,
  storagePath: true,
  thumbnailPath: true,
  mime: true,
  sizeBytes: true,
  width: true,
  height: true,
  notes: true,
  caseId: true,
  uploadedById: true,
  createdAt: true,
  case: { select: { program: { select: { name: true } } } },
  uploadedBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduClinicalPhotoSelect;

type PhotoPayload = Prisma.EduClinicalPhotoGetPayload<{ select: typeof PHOTO_SELECT }>;

function toRow(
  p: PhotoPayload,
  url: string,
  thumbUrl: string,
  timeZone: string,
): EduPhotoRow {
  const size = bytesToNumber(p.sizeBytes);
  return {
    id: p.id,
    photoType: p.photoType,
    stage: p.stage,
    capturedAt: p.capturedAt.toISOString(),
    capturedLabel: dayLabel(p.capturedAt, timeZone),

    mime: p.mime,
    sizeBytes: size,
    sizeLabel: eduFormatBytes(size),
    width: p.width,
    height: p.height,

    notes: p.notes,

    caseId: p.caseId,
    caseProgramName: p.case ? p.case.program.name : null,

    uploadedById: p.uploadedById,
    uploadedByName: personName(p.uploadedBy),
    createdAt: p.createdAt.toISOString(),

    url,
    thumbUrl,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURA
// ═══════════════════════════════════════════════════════════════════════

export interface EduPhotoFiltros {
  stage?: unknown;
  photoType?: unknown;
}

/**
 * Las fotos de un paciente, con su URL firmada RECIÉN generada.
 *
 * La URL no se guarda en la base nunca: caduca. Se firman TODAS —la foto y
 * su miniatura— en un solo viaje a Storage (`createSignedUrls`): una
 * galería de 40 fotos con 80 viajes tarda lo que tarda, y se nota.
 *
 * 🔴 LAS DADAS DE BAJA NO SALEN. `deletedAt: null` va en el `where` y no en
 * un `.filter()` posterior: un recorte que vive fuera de la consulta es un
 * recorte que el siguiente `findMany` se olvida de copiar.
 *
 * ⚠️ El alcance es el CLÍNICO: quien puede abrir el expediente de este
 * paciente ve TODAS sus fotos, incluidas las que subió otro alumno para
 * otro caso. Es a propósito — la cara es una sola, y esconderle al de
 * ortodoncia el "antes" que tomó el de periodoncia significa volver a
 * fotografiar al paciente.
 */
export async function listEduPatientPhotos(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  filtros: EduPhotoFiltros = {},
  now: Date = new Date(),
): Promise<EduPhotoPage> {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return { rows: [], truncated: false };

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return { rows: [], truncated: false };

  const where: Prisma.EduClinicalPhotoWhereInput = {
    institutionId,
    patientId: paciente.id,
    deletedAt: null,
  };
  // Un filtro que llega con un valor que no está en el enum se IGNORA en
  // vez de devolver cero filas: una píldora rota en la pantalla no puede
  // hacerle creer a nadie que el paciente no tiene fotos.
  const stage = eduParsePhotoStage(filtros?.stage);
  if (stage) where.stage = stage;
  const photoType = eduParsePhotoType(filtros?.photoType);
  if (photoType) where.photoType = photoType;

  const leidas = await prisma.eduClinicalPhoto.findMany({
    where,
    // Por fecha de TOMA y no de subida: es la que ordena el antes/después.
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    // Una de más, solo para poder DECIR que se cortó. Se descarta abajo.
    take: EDU_PHOTO_MAX_ROWS + 1,
    select: PHOTO_SELECT,
  });
  const truncated = leidas.length > EDU_PHOTO_MAX_ROWS;
  // 🔴 EL CORTE VA ANTES DE FIRMAR: pedirle a Storage la URL de una foto
  // que no se va a pintar es un viaje pagado por nadie.
  const rows = leidas.slice(0, EDU_PHOTO_MAX_ROWS);
  if (rows.length === 0) return { rows: [], truncated };

  // Sin Storage configurado se devuelve la lista con las URL vacías en vez
  // de reventar: la pantalla enseña las tarjetas y dice que la foto no se
  // puede abrir, que es información útil.
  const paths: string[] = [];
  for (const r of rows) {
    paths.push(r.storagePath);
    if (r.thumbnailPath) paths.push(r.thumbnailPath);
  }
  const urls = eduStorageConfigured()
    ? await eduSignReadMany(paths)
    : new Map<string, string>();

  return {
    truncated,
    rows: rows.map((r) =>
      toRow(
        r,
        urls.get(r.storagePath) ?? "",
        r.thumbnailPath ? urls.get(r.thumbnailPath) ?? "" : "",
        timeZone,
      ),
    ),
  };
}

export interface EduPhotoForViewer {
  id: string;
  patientId: string;
  storagePath: string;
  thumbnailPath: string | null;
  mime: string;
  sizeBytes: number;
  deletedAt: Date | null;
}

/**
 * UNA foto, buscada DENTRO del alcance CLÍNICO.
 *
 * 🔴 Es la puerta de las tres rutas del detalle (URL firmada, PATCH y
 * baja). El institutionId sale de la SESIÓN y el paciente pasa por
 * `eduPatientScopeWhere`, así que un id de otra escuela —o de un paciente
 * que a este rol no le toca— no existe: devuelve null y la ruta contesta
 * 404, igual que uno inventado.
 *
 * ⚠️ Devuelve TAMBIÉN las dadas de baja, con su `deletedAt`: quien llama
 * decide. Dar de baja dos veces tiene que poder contestar "ya estaba dada
 * de baja" y no "no existe", que le haría creer a alguien que perdió una
 * foto.
 */
export async function getEduPhotoForViewer(
  ctx: EduClinicaContext,
  photoId: string,
  now: Date = new Date(),
): Promise<EduPhotoForViewer | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(photoId);
  if (!id) return null;

  const row = await prisma.eduClinicalPhoto.findFirst({
    where: {
      id,
      institutionId,
      patient: eduPatientScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      patientId: true,
      storagePath: true,
      thumbnailPath: true,
      mime: true,
      sizeBytes: true,
      deletedAt: true,
    },
  });
  if (!row) return null;
  return { ...row, sizeBytes: bytesToNumber(row.sizeBytes) };
}

/**
 * La URL FIRMADA de una foto (y de su miniatura), recién generada.
 *
 * Existe como endpoint propio y no solo dentro del listado porque el
 * visor a pantalla completa se abre mucho después de que la galería se
 * pintó, y para entonces la URL de la lista puede haber caducado.
 */
export async function getEduPhotoSignedUrl(
  ctx: EduClinicaContext,
  photoId: string,
  now: Date = new Date(),
): Promise<{ url: string; thumbUrl: string }> {
  requireStorage();
  const foto = await getEduPhotoForViewer(ctx, photoId, now);
  if (!foto) throw new EduPadronError("Esa foto no existe o no te toca.", 404);
  if (foto.deletedAt) {
    throw new EduPadronError("Esa foto está dada de baja del expediente.", 410);
  }

  const url = await eduSignRead(foto.storagePath);
  const thumbUrl = foto.thumbnailPath ? await eduSignRead(foto.thumbnailPath) : "";
  if (!url) {
    throw new EduPadronError("No se pudo abrir la foto. Intenta de nuevo.", 502);
  }
  return { url, thumbUrl };
}

// ═══════════════════════════════════════════════════════════════════════
// LA SUBIDA — por el SERVIDOR, en un solo viaje
// ═══════════════════════════════════════════════════════════════════════

export interface EduPhotoUploadInput {
  /** Los bytes del archivo, ya leídos del multipart. */
  bytes: Uint8Array | Buffer;
  /** El MIME que DECLARA el navegador. Se comprueba contra el contenido. */
  mime?: unknown;
  /** El nombre original. Solo se usa para componer un path legible. */
  fileName?: unknown;
  stage?: unknown;
  photoType?: unknown;
  capturedAt?: unknown;
  caseId?: unknown;
  notes?: unknown;
}

interface Comprimida {
  body: Buffer;
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
  thumb: Buffer | null;
}

/**
 * Comprime y saca la miniatura. BEST-EFFORT, y eso es una decisión:
 *
 * si sharp no puede con el formato —HEIC/HEIF dependen de que la
 * compilación de libvips de este entorno traiga libheif— se sube el
 * ORIGINAL sin miniatura y la galería cae a la foto completa. Rebotar la
 * subida entera por la copia pequeña sería perder la foto por la
 * miniatura, con el paciente todavía en el sillón.
 *
 * El import es DINÁMICO porque sharp pesa y no tiene por qué entrar en el
 * bundle de las pantallas que solo listan.
 */
async function comprimirFoto(bytes: Buffer, mimeDeclarado: string): Promise<Comprimida> {
  try {
    const sharp = (await import("sharp")).default;
    const principal = await sharp(bytes)
      // `rotate()` sin argumentos aplica la orientación EXIF: sin esto,
      // media galería de un iPhone sale de lado.
      .rotate()
      .resize(EDU_PHOTO_MAX_EDGE, EDU_PHOTO_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: EDU_PHOTO_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    let thumb: Buffer | null = null;
    try {
      thumb = await sharp(bytes)
        .rotate()
        .resize(EDU_PHOTO_THUMB_EDGE, EDU_PHOTO_THUMB_EDGE, { fit: "cover" })
        .webp({ quality: EDU_PHOTO_THUMB_QUALITY })
        .toBuffer();
    } catch (e) {
      console.warn("[instituto/fotos] miniatura falló:", (e as Error).message);
    }

    return {
      body: principal.data,
      mime: "image/jpeg",
      ext: "jpg",
      width: principal.info?.width ?? null,
      height: principal.info?.height ?? null,
      thumb,
    };
  } catch (e) {
    console.warn(
      "[instituto/fotos] compresión sharp falló; se sube el original:",
      (e as Error).message,
    );
    return {
      body: bytes,
      mime: mimeDeclarado,
      ext: eduPhotoExtForMime(mimeDeclarado),
      width: null,
      height: null,
      thumb: null,
    };
  }
}

/**
 * SUBE una foto clínica al expediente del paciente.
 *
 * Devuelve el id de la fila creada. Lanza `EduPadronError` con el status y
 * el mensaje ya escritos para una persona: quien sube es un alumno con el
 * paciente en el sillón, y un 400 mudo lo deja mirando la pantalla.
 */
export async function uploadEduPatientPhoto(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduPhotoUploadInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const bytes = Buffer.isBuffer(input?.bytes) ? input.bytes : Buffer.from(input?.bytes ?? []);
  const mimeDeclarado = typeof input?.mime === "string" ? input.mime.toLowerCase() : "";

  // ── 1. Lo barato primero: MIME declarado y tamaño ────────────────────
  const invalido = eduValidarFotoSubida({ mime: mimeDeclarado, size: bytes.length });
  if (invalido) {
    throw new EduPadronError(invalido, bytes.length > EDU_MAX_PHOTO_BYTES ? 413 : 400);
  }

  // ── 2. El NÚMERO MÁGICO ──────────────────────────────────────────────
  // 🔴 `file.type` lo elige el navegador y se puede falsear: un .exe
  // renombrado a .jpg lo declara como quiera. Esto mira los primeros bytes
  // del contenido. Es el mismo helper que ya usan las firmas de
  // consentimiento del vertical (@/lib/consent/signature) e inmuebles —
  // se importa, no se copia.
  const magico = await validateMagicNumber(bytes, [...EDU_PHOTO_MIME]);
  if (magico) {
    throw new EduPadronError(
      "Ese archivo no es una imagen: su contenido no coincide con lo que dice ser.",
      400,
    );
  }

  // ── 3. LA CUOTA DEL INSTITUTO, ANTES DE ESCRIBIR UN BYTE ─────────────
  //
  // 🔴 Se decide con el tamaño de ENTRADA y no con el comprimido, aunque
  // lo que acabe ocupando sea menos. Comprimir primero para decidir sería
  // gastar CPU en una foto que va a rebotar igual, y equivocarse hacia el
  // lado conservador solo puede rechazar un poco antes de tiempo — nunca
  // dejar pasar de más.
  //
  // Son DOS TOPES DISTINTOS y los dos valen: arriba, lo que pesa ESA foto
  // (25 MB); aquí, lo que le queda a la ESCUELA.
  const medidor = await getEduAlmacenamientoMedidor(institutionId);
  if (!eduAlmCabe(medidor, bytes.length)) {
    // 507 Insufficient Storage, no 413: la foto no es demasiado grande, es
    // la escuela la que no tiene sitio. Se distinguen en los logs y el
    // mensaje dice cuánto queda, cuánto pesa esto y a quién avisarle.
    throw new EduPadronError(eduAlmRechazo(medidor, bytes.length), 507);
  }

  // ── 4. El caso, DENTRO DEL ALCANCE ───────────────────────────────────
  // No se puede colgar una foto de un caso que quien sube no puede ver, ni
  // de un caso de otro paciente.
  let caseId: string | null = null;
  if (input?.caseId !== undefined && input?.caseId !== null && input?.caseId !== "") {
    const scope = eduClinicalScope(ctx);
    const cid = eduCleanId(input.caseId);
    const caso = cid
      ? await prisma.eduCase.findFirst({
          where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id: cid, patientId: pid },
          select: { id: true },
        })
      : null;
    if (!caso) throw new EduPadronError("Ese caso no es de este paciente.", 404);
    caseId = caso.id;
  }

  // ── 5. Comprimir (best-effort) ───────────────────────────────────────
  const comprimida = await comprimirFoto(bytes, mimeDeclarado);

  // ── 6. Subir. El PATH lo compone el SERVIDOR ─────────────────────────
  // 🔴 con el institutionId de la SESIÓN y un UUID recién generado. El
  // cliente nunca propone un path: si lo hiciera, bastaría con teclear el
  // de otra escuela para escribir en su carpeta.
  const uuid = randomUUID();
  const path = eduPhotoStoragePath(
    institutionId,
    pid,
    uuid,
    eduSafePhotoFileName(input?.fileName, comprimida.ext),
  );

  const guardado = await eduStorageUpload(path, comprimida.body, comprimida.mime);
  if (!guardado) {
    throw new EduPadronError("No se pudo guardar la foto. Intenta de nuevo.", 502);
  }

  // La miniatura es best-effort del principio al fin: si su subida falla,
  // la foto queda sin miniatura y la galería usa la completa, en vez de
  // tumbar una subida que ya está guardada.
  let thumbPath: string | null = null;
  if (comprimida.thumb) {
    const tp = eduPhotoThumbPath(institutionId, pid, uuid);
    const okThumb = await eduStorageUpload(tp, comprimida.thumb, "image/webp");
    if (okThumb) thumbPath = tp;
  }

  // ── 7. Y AL FINAL la fila ────────────────────────────────────────────
  const stage: EduPhotoStage = eduParsePhotoStage(input?.stage) ?? "PRE";
  const photoType: EduPhotoType = eduParsePhotoType(input?.photoType) ?? "OTRA";
  const capturedAt = eduParseCapturedAt(input?.capturedAt, now) ?? now;

  const created = await prisma.eduClinicalPhoto.create({
    data: {
      institutionId,
      patientId: pid,
      caseId,
      uploadedById: ctx.eduUserId,
      photoType,
      stage,
      capturedAt,
      storagePath: path,
      thumbnailPath: thumbPath,
      mime: comprimida.mime,
      // Lo que de verdad ocupa en el bucket, que es lo que suma a la
      // cuota: el tamaño DESPUÉS de comprimir, no el que llegó.
      sizeBytes: BigInt(comprimida.body.length),
      width: comprimida.width,
      height: comprimida.height,
      notes: eduOptionalText(input?.notes, 1000) ?? null,
    },
    select: { id: true },
  });

  return { id: created.id };
}

// ═══════════════════════════════════════════════════════════════════════
// CORREGIR Y DAR DE BAJA
// ═══════════════════════════════════════════════════════════════════════

export interface EduPhotoPatch {
  stage?: unknown;
  photoType?: unknown;
  capturedAt?: unknown;
  notes?: unknown;
}

/**
 * CORRIGE la etapa, la vista, la fecha de toma o la nota de una foto.
 *
 * 🔴 Existe porque el error que se comete de verdad es marcar "Antes" lo
 * que era "Después", y hoy en los estudios eso no se puede corregir salvo
 * que el archivo sea un `.zip` (H-14). Una foto mal etiquetada rompe el
 * comparador en silencio: enseña dos "antes" y parece que no hubo
 * tratamiento.
 *
 * Un campo que no viene NO se toca (`undefined` = "no cambies"), y `notes`
 * en vacío BORRA la nota — la misma semántica que `eduOptionalText` en
 * todo el vertical.
 */
export async function updateEduPatientPhoto(
  ctx: EduClinicaContext,
  photoId: string,
  patch: EduPhotoPatch,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const foto = await getEduPhotoForViewer(ctx, photoId, now);
  if (!foto) throw new EduPadronError("Esa foto no existe o no te toca.", 404);
  if (foto.deletedAt) {
    throw new EduPadronError("Esa foto está dada de baja: ya no se corrige.", 409);
  }

  const data: Prisma.EduClinicalPhotoUpdateManyMutationInput = {};

  if (patch?.stage !== undefined) {
    const stage = eduParsePhotoStage(patch.stage);
    if (!stage) throw new EduPadronError("Esa etapa no existe.", 400);
    data.stage = stage;
  }
  if (patch?.photoType !== undefined) {
    const photoType = eduParsePhotoType(patch.photoType);
    if (!photoType) throw new EduPadronError("Esa vista no existe.", 400);
    data.photoType = photoType;
  }
  if (patch?.capturedAt !== undefined) {
    const capturedAt = eduParseCapturedAt(patch.capturedAt, now);
    if (!capturedAt) {
      throw new EduPadronError(
        "Esa fecha de toma no es válida. No puede quedar en el futuro: el comparador ordena por ella.",
        400,
      );
    }
    data.capturedAt = capturedAt;
  }
  if (patch?.notes !== undefined) {
    data.notes = eduOptionalText(patch.notes, 1000) ?? null;
  }

  if (Object.keys(data).length === 0) {
    throw new EduPadronError("No mandaste nada que cambiar.", 400);
  }

  // updateMany con el institutionId REPETIDO en el where: aunque el
  // findFirst de arriba ya lo comprobó, la escritura no se apoya en que
  // nadie meta mano entre las dos consultas.
  await prisma.eduClinicalPhoto.updateMany({
    where: { id: foto.id, institutionId, deletedAt: null },
    data,
  });
  return { id: foto.id };
}

/**
 * DA DE BAJA una foto del expediente. Baja SUAVE, con autor y con motivo.
 *
 * 🔴 EL BINARIO NO SE BORRA. El dental sí lo borra al dar de baja; aquí
 * no, y es una decisión: una foto que se retira del expediente sigue
 * siendo la constancia de que alguien la subió al paciente equivocado, y
 * 25 MB no son un problema de almacenamiento. La baja es reversible en la
 * base y el objeto sigue ahí.
 *
 * ⚠️ CONSECUENCIA HONESTA, y está en el reporte: la cuota suma las fotos
 * que NO están dadas de baja, así que esos bytes se pagan y dejan de verse
 * en el medidor. Es el mismo hueco que ya tienen los huérfanos de los
 * estudios (H-26) y se cierra con el mismo barrido, que no es de esta ola.
 *
 * 🔴 El motivo es OBLIGATORIO. Sin él, "dar de baja" y "borrar" son la
 * misma cosa con distinto nombre: dentro de un año, la fila dice que
 * alguien la quitó y no dice por qué, y eso no contesta nada.
 */
export async function softDeleteEduPatientPhoto(
  ctx: EduClinicaContext,
  photoId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const foto = await getEduPhotoForViewer(ctx, photoId, now);
  if (!foto) throw new EduPadronError("Esa foto no existe o no te toca.", 404);
  if (foto.deletedAt) {
    throw new EduPadronError("Esa foto ya estaba dada de baja.", 409);
  }

  const reason = eduOptionalText(rawReason, 500);
  if (!reason) {
    throw new EduPadronError(
      "Escribe por qué se retira la foto. Queda en el expediente y es lo que contesta la pregunta dentro de un año.",
      400,
    );
  }

  // Los tres campos se escriben JUNTOS, en una sola escritura: una baja
  // con fecha y sin autor, o con autor y sin motivo, no es una baja.
  await prisma.eduClinicalPhoto.updateMany({
    where: { id: foto.id, institutionId, deletedAt: null },
    data: { deletedAt: now, deletedById: ctx.eduUserId, deleteReason: reason },
  });
  return { id: foto.id };
}
