/**
 * DaleControl INSTITUCIONAL — las FOTOS CLÍNICAS contra la base de datos y
 * contra Storage.
 *
 * SERVIDOR: importa prisma y el helper del bucket. Lo puro (topes, MIME,
 * paths, la agrupación por etapa y el par del comparador) vive en
 * fotos-core.ts; aquí solo hay consultas, compresión y Storage.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 N-2 · EL BINARIO YA NO PASA POR EL SERVIDOR: SUBE DIRECTO AL BUCKET,
 * EN LOS MISMOS TRES PASOS QUE UN ESTUDIO.
 *
 * Pasaba por aquí, con `request.formData()` en un ROUTE HANDLER, y ahí
 * estaba el fallo: el `bodySizeLimit: "30mb"` de `next.config.mjs` solo
 * vale para SERVER ACTIONS. El cuerpo de un route handler lo corta la
 * plataforma (~4.5 MB) y la pantalla prometía 25 MB, con la compresión del
 * navegador en best-effort y cuatro caminos que mandaban el original.
 *
 * El orden de ahora, que importa igual que el de antes:
 *   /sign     1. permiso + alcance clínico + paciente de ESTE instituto
 *             2. MIME y tamaño DECLARADOS (rechazo barato)
 *             3. CUOTA del instituto, ANTES de firmar nada
 *             4. el PATH lo compone el servidor (institutionId de la SESIÓN)
 *   PUT       5. el navegador sube el JPEG y su miniatura, sin tocar aquí
 *   /confirm  6. TAMAÑO REAL preguntado a Storage (nunca al cliente)
 *             7. NÚMERO MÁGICO del contenido descargado
 *             8. y AL FINAL la fila
 *
 * 🔴 EL PASO 8 VA AL FINAL A PROPÓSITO, igual que antes. Un objeto sin fila
 * es un huérfano que se limpia (para eso está `abortEduPhotoUpload`); una
 * foto fantasma en el expediente no se limpia con nada porque nadie sabe
 * que está mal.
 *
 * 🔴 LA COMPRESIÓN SE FUE AL NAVEGADOR Y ES OBLIGATORIA. Sharp ya no ve la
 * foto: los 2 400 px JPEG q85 y la miniatura de 300 px WebP los hace el
 * canvas antes del PUT, y si el navegador no sabe decodificar el archivo se
 * RECHAZA con el motivo escrito en vez de subir el original. Lo que no se
 * perdió es el número mágico: /confirm descarga el objeto —medido antes, y
 * acotado a 25 MB— y comprueba sus primeros bytes.
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
  eduFormatTime,
  eduOptionalText,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import {
  EDU_RETIRADOS_MAX_ROWS,
  eduFormatBytes,
  type EduRetiradoRow,
} from "@/lib/edu/estudios-core";
import {
  EDU_MAX_PHOTO_BYTES,
  EDU_MAX_PHOTO_LABEL,
  EDU_PHOTO_MAX_ROWS,
  EDU_PHOTO_THUMB_MIME,
  EDU_PHOTO_THUMB_SUFIJO,
  EDU_PHOTO_UPLOAD_EXT,
  EDU_PHOTO_UPLOAD_MIME,
  eduParseCapturedAt,
  eduParsePhotoDimension,
  eduParsePhotoStage,
  eduParsePhotoType,
  eduPhotoPathBelongsTo,
  eduPhotoStoragePath,
  eduPhotoThumbPath,
  eduPhotoUuidDePath,
  eduSafePhotoFileName,
  eduValidarFirmaFoto,
  type EduPhotoPage,
  type EduPhotoRow,
} from "@/lib/edu/fotos-core";
import { eduAlmCabe, eduAlmRechazo } from "@/lib/edu/almacenamiento-core";
import { getEduAlmacenamientoMedidor } from "@/lib/edu/almacenamiento";
import {
  eduSignRead,
  eduSignReadMany,
  eduSignUpload,
  eduStorageConfigured,
  eduStorageDownload,
  eduStorageObjectSizeWithRetry,
  eduStorageRemove,
} from "@/lib/edu/storage";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_PHOTO_STAGE_LABELS,
  EDU_PHOTO_TYPE_LABELS,
  type EduPhotoStage,
  type EduPhotoType,
} from "@/lib/edu/types";

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
    // N-7 · El día CIVIL, en la zona del instituto. Es el mismo cálculo que
    // `dayLabel` de la línea de abajo, y va crudo para que el modal de
    // corregir siembre su `<input type="date">` con EL MISMO día que la
    // tarjeta pinta — no con el recorte en UTC, que se corre uno.
    capturedDayISO: eduUtcToZoned(p.capturedAt, eduSafeTimeZone(timeZone)).dayISO,
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
 *
 * 🔴 N-16 · `patientId` NO ES OPCIONAL Y SE COMPRUEBA. Las tres rutas del
 * detalle viven bajo `/pacientes/[id]/fotos/[fotoId]` y hasta ahora
 * ignoraban el `[id]`: no había fuga de tenant —el alcance cierra la
 * puerta— pero `DELETE /pacientes/A/fotos/<foto-de-B>` contestaba 200 y la
 * URL mentía sobre a quién se le tocó el expediente. Un rastro que miente
 * sobre el paciente es peor que no tenerlo.
 */
export async function getEduPhotoForViewer(
  ctx: EduClinicaContext,
  photoId: string,
  patientId: string,
  now: Date = new Date(),
): Promise<EduPhotoForViewer | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(photoId);
  if (!id) return null;
  const pid = eduCleanId(patientId);
  if (!pid) return null;

  const row = await prisma.eduClinicalPhoto.findFirst({
    where: {
      id,
      institutionId,
      // El paciente de la URL, y además el alcance: los dos, no uno.
      patientId: pid,
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
  patientId: string,
  now: Date = new Date(),
): Promise<{ url: string; thumbUrl: string }> {
  requireStorage();
  const foto = await getEduPhotoForViewer(ctx, photoId, patientId, now);
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
// LA SUBIDA, EN TRES PASOS (N-2)
// ═══════════════════════════════════════════════════════════════════════

export interface EduPhotoSignedUpload {
  /** El path del JPEG. Lo compone el servidor; el cliente lo devuelve tal cual. */
  path: string;
  /** El path de la miniatura, derivado del MISMO uuid. */
  thumbPath: string;
  signedUrl: string;
  thumbSignedUrl: string;
  contentType: string;
  thumbContentType: string;
  maxBytes: number;
}

/**
 * PASO 1 — valida y firma las DOS subidas (la foto y su miniatura).
 *
 * Lo que se valida aquí, todo en el servidor y sin creerle nada al cliente:
 *   · sesión + permiso + ALCANCE clínico del paciente
 *   · que lo que va a subir sea el JPEG comprimido (la compresión del
 *     navegador es obligatoria: `eduValidarFirmaFoto`)
 *   · tamaño DECLARADO <= 25 MB
 *   · que quepa en la CUOTA DEL INSTITUTO — 507 con el mensaje escrito,
 *     nunca un 413 mudo: quien sube tiene al paciente en el sillón
 *   · el PATH lo compone el servidor con el institutionId de la SESIÓN
 *
 * Lo que NO se puede validar aquí: el contenido real, porque los bytes no
 * pasan por el servidor. El tamaño declarado es una PISTA —un cliente puede
 * mentir— y por eso /confirm vuelve a medir el objeto Y a mirar sus
 * primeros bytes.
 *
 * 🔴 SE FIRMAN LAS DOS DE UNA VEZ, y no la miniatura en un segundo viaje:
 * dos redondeos a Storage desde un teléfono en 4G, con el paciente
 * delante, se notan. Que la miniatura tenga path propio DERIVADO del uuid
 * de la foto es lo que le deja a /confirm exigir que sean pareja.
 */
export async function signEduPhotoUpload(
  ctx: EduClinicaContext,
  patientId: string,
  input: { name?: unknown; size?: unknown; contentType?: unknown },
  now: Date = new Date(),
): Promise<EduPhotoSignedUpload> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const declarado = Number(input?.size);
  const invalido = eduValidarFirmaFoto({
    mime: typeof input?.contentType === "string" ? input.contentType.toLowerCase() : "",
    size: declarado,
  });
  if (invalido) {
    throw new EduPadronError(invalido, declarado > EDU_MAX_PHOTO_BYTES ? 413 : 400);
  }

  // ── LA CUOTA DEL INSTITUTO, ANTES DE FIRMAR ──────────────────────────
  //
  // 🔴 El corte va AQUÍ y no en /confirm, por lo mismo que en los estudios:
  // después de firmar, el navegador ya subió una foto que iba a rebotar
  // igual, y el rebote llegaría del bucket, sin palabras.
  //
  // Son DOS TOPES DISTINTOS y los dos valen: arriba, lo que pesa ESA foto;
  // aquí, lo que le queda a la ESCUELA.
  const medidor = await getEduAlmacenamientoMedidor(institutionId);
  if (!eduAlmCabe(medidor, declarado)) {
    // 507 Insufficient Storage, no 413: la foto no es demasiado grande, es
    // la escuela la que no tiene sitio. Se distinguen en los logs y el
    // mensaje dice cuánto queda, cuánto pesa esto y a quién avisarle.
    throw new EduPadronError(eduAlmRechazo(medidor, declarado), 507);
  }

  // 🔴 El PATH lo compone el SERVIDOR, con el institutionId de la SESIÓN y
  // un UUID recién generado. El cliente nunca propone un path: si lo
  // hiciera, bastaría con teclear el de otra escuela para escribir en su
  // carpeta.
  const uuid = randomUUID();
  const path = eduPhotoStoragePath(
    institutionId,
    pid,
    uuid,
    eduSafePhotoFileName(input?.name, EDU_PHOTO_UPLOAD_EXT),
  );
  const thumbPath = eduPhotoThumbPath(institutionId, pid, uuid);

  const firmada = await eduSignUpload(path);
  const firmadaThumb = await eduSignUpload(thumbPath);
  if (!firmada || !firmadaThumb) {
    throw new EduPadronError("No se pudo preparar la subida. Intenta de nuevo.", 500);
  }

  return {
    path,
    thumbPath,
    signedUrl: firmada.signedUrl,
    thumbSignedUrl: firmadaThumb.signedUrl,
    contentType: EDU_PHOTO_UPLOAD_MIME,
    thumbContentType: EDU_PHOTO_THUMB_MIME,
    maxBytes: EDU_MAX_PHOTO_BYTES,
  };
}

export interface EduPhotoConfirmInput {
  path?: unknown;
  thumbPath?: unknown;
  fileName?: unknown;
  stage?: unknown;
  photoType?: unknown;
  capturedAt?: unknown;
  caseId?: unknown;
  notes?: unknown;
  width?: unknown;
  height?: unknown;
}

/** Borra un objeto sin poder romperle nada a quien llama. */
async function limpiarObjeto(path: string | null): Promise<void> {
  if (!path) return;
  try {
    await eduStorageRemove(path);
  } catch (e) {
    console.error("[instituto/fotos] no se pudo borrar el objeto rechazado:", path, e);
  }
}

/**
 * PASO 3 — mide el objeto real, comprueba su contenido y lo registra.
 *
 * El objeto YA está en el bucket (lo subió el navegador). Aquí el servidor
 * decide si esa subida se convierte en una fila del expediente, y NO se
 * cree NADA de lo que diga el cliente:
 *   · el `path` debe caer EXACTAMENTE en la carpeta de este instituto y
 *     este paciente — sin esto, conociendo un path ajeno se podría
 *     registrar el archivo de otra escuela dentro del expediente propio;
 *   · la MINIATURA tiene que ser LA de esta foto: mismo uuid y el sufijo
 *     que escribe `eduPhotoThumbPath`. Que caiga en la carpeta no basta —
 *     si bastara, se podría enganchar la miniatura de otra foto;
 *   · el TAMAÑO se le pregunta a STORAGE, jamás al cliente;
 *   · el CONTENIDO se comprueba por NÚMERO MÁGICO. Es lo único que la
 *     tubería directa podía haber perdido y no se perdió: se descarga el
 *     objeto —después de medirlo, así que está acotado a 25 MB— y se miran
 *     sus primeros bytes. Un `.exe` renombrado rebota y el objeto se borra.
 *
 * 🔴 ES IDEMPOTENTE: un reintento del cliente o un doble toque devuelven la
 * fila que ya existe en vez de duplicar la foto. Lo garantiza el índice
 * único (institutionId, storagePath), que ya existía en el esquema y en
 * `sql/edu-ola-b.sql` — esta casilla no añade SQL.
 */
export async function confirmEduPhotoUpload(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduPhotoConfirmInput,
  now: Date = new Date(),
): Promise<{ id: string; alreadyRegistered: boolean }> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const path = typeof input?.path === "string" ? input.path : "";
  const uuid = eduPhotoUuidDePath(path, institutionId, pid);
  if (!uuid) throw new EduPadronError("Esa ruta no es de este paciente.", 400);

  // La miniatura es opcional en el ESQUEMA (`thumbnailPath String?`), pero
  // si viene tiene que ser la de ESTA foto.
  let thumbPath: string | null = null;
  if (input?.thumbPath !== undefined && input?.thumbPath !== null && input?.thumbPath !== "") {
    const t = typeof input.thumbPath === "string" ? input.thumbPath : "";
    if (
      !eduPhotoPathBelongsTo(t, institutionId, pid) ||
      !t.endsWith(EDU_PHOTO_THUMB_SUFIJO) ||
      t !== eduPhotoThumbPath(institutionId, pid, uuid)
    ) {
      throw new EduPadronError("Esa miniatura no es de esta foto.", 400);
    }
    thumbPath = t;
  }

  // ── IDEMPOTENCIA, lo primero: un reintento no vuelve a medir ni a
  //    descargar nada, y sobre todo no crea una segunda fila.
  const existente = await prisma.eduClinicalPhoto.findFirst({
    where: { institutionId, storagePath: path },
    select: { id: true },
  });
  if (existente) return { id: existente.id, alreadyRegistered: true };

  // ── EL TAMAÑO REAL, PREGUNTADO A STORAGE ─────────────────────────────
  const size = await eduStorageObjectSizeWithRetry(path);
  if (size == null) {
    // 409 y no 500: el objeto puede existir y todavía no listarse. El
    // cliente reintenta el REGISTRO (no la subida) y suele entrar.
    throw new EduPadronError(
      "La foto todavía no aparece en el almacenamiento. Espera un momento y vuelve a intentar.",
      409,
    );
  }
  if (size <= 0) {
    await limpiarObjeto(path);
    await limpiarObjeto(thumbPath);
    throw new EduPadronError("El archivo llegó vacío. Vuelve a elegirlo e inténtalo de nuevo.", 400);
  }
  if (size > EDU_MAX_PHOTO_BYTES) {
    // Se borra: si se quedara, ocuparía espacio sin fila que lo
    // contabilice, y nadie podría verlo ni para borrarlo.
    await limpiarObjeto(path);
    await limpiarObjeto(thumbPath);
    throw new EduPadronError(
      `Esa foto pesa ${eduFormatBytes(size)} y el máximo por foto es ${EDU_MAX_PHOTO_LABEL}.`,
      413,
    );
  }

  // ── EL NÚMERO MÁGICO ─────────────────────────────────────────────────
  //
  // 🔴 Va DESPUÉS de medir y no antes: descargar primero y preguntar
  // después sería cargar en memoria de la función lo que todavía no se
  // sabe si cabe. Y va con `EDU_PHOTO_UPLOAD_MIME` a secas y no con la
  // lista de cinco: lo que el navegador sube SIEMPRE es el JPEG que salió
  // del canvas, así que aceptar un HEIC aquí sería volver a meter en el
  // bucket el binario que después ningún escritorio sabe pintar (N-5).
  const bytes = await eduStorageDownload(path);
  if (!bytes) {
    throw new EduPadronError(
      "No se pudo leer la foto recién subida. Espera un momento y vuelve a intentar.",
      409,
    );
  }
  const magico = await validateMagicNumber(bytes, [EDU_PHOTO_UPLOAD_MIME]);
  if (magico) {
    await limpiarObjeto(path);
    await limpiarObjeto(thumbPath);
    throw new EduPadronError(
      "Ese archivo no es una foto JPEG: su contenido no coincide con lo que dice ser.",
      400,
    );
  }

  // ── El caso, DENTRO DEL ALCANCE ──────────────────────────────────────
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

  // ── Y AL FINAL la fila ───────────────────────────────────────────────
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
      mime: EDU_PHOTO_UPLOAD_MIME,
      // Lo que de verdad ocupa en el bucket, medido por Storage, que es lo
      // que suma a la cuota. La miniatura no cuenta, igual que antes.
      sizeBytes: BigInt(Math.trunc(size)),
      // Alto y ancho los mide el canvas del navegador. No son un dato de
      // seguridad —dicen la forma de la foto— pero se sanean igual: un
      // número raro en una columna Int tumba la escritura entera.
      width: eduParsePhotoDimension(input?.width),
      height: eduParsePhotoDimension(input?.height),
      notes: eduOptionalText(input?.notes, 1000) ?? null,
    },
    select: { id: true },
  });

  return { id: created.id, alreadyRegistered: false };
}

/**
 * LIMPIEZA — borra el objeto que se subió y NUNCA se confirmó.
 *
 * Es la misma puerta que `abortEduStudyUpload` y se defiende igual, porque
 * borra bytes:
 *   1. sesión + alcance clínico + paciente de este instituto;
 *   2. el path tiene que caer en la carpeta de este instituto y paciente;
 *   3. NO debe existir ninguna fila `EduClinicalPhoto` apuntando a ese
 *      path. Solo se borran HUÉRFANOS: si la foto ya es parte del
 *      expediente, esta puerta no es un atajo para sacarla de ahí — para
 *      eso está «Retirar», que deja constancia.
 *
 * 🔴 SIN `deletedAt: null` en el punto 3, y a propósito: una foto RETIRADA
 * sigue apuntando a su objeto (el binario se conserva), así que esta puerta
 * tampoco puede borrarlo. Si filtrara las retiradas, «cancelar una subida»
 * se convertiría en la forma de destruir la evidencia que «Retirar» existe
 * para conservar.
 *
 * Es best-effort por diseño: si el navegador se cierra a media subida nadie
 * la llama, y ese caso queda para el mismo barrido de huérfanos que ya
 * tienen los estudios (H-26, anotado y no resuelto).
 */
export async function abortEduPhotoUpload(
  ctx: EduClinicaContext,
  patientId: string,
  input: { path?: unknown; thumbPath?: unknown },
  now: Date = new Date(),
): Promise<{ deleted: boolean }> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const path = typeof input?.path === "string" ? input.path : "";
  if (!eduPhotoPathBelongsTo(path, institutionId, pid)) {
    throw new EduPadronError("Esa ruta no es de este paciente.", 400);
  }

  const registrada = await prisma.eduClinicalPhoto.findFirst({
    where: { institutionId, storagePath: path },
    select: { id: true },
  });
  if (registrada) {
    throw new EduPadronError(
      "Esa foto ya está registrada en el expediente, así que esta puerta no la saca: " +
        "aquí solo se limpia lo que se subió a medias. Si se subió por error, usa «Retirar» — " +
        "deja constancia de quién la retiró y por qué, y el archivo no se destruye.",
      409,
    );
  }

  const thumb =
    typeof input?.thumbPath === "string" &&
    eduPhotoPathBelongsTo(input.thumbPath, institutionId, pid) &&
    input.thumbPath.endsWith(EDU_PHOTO_THUMB_SUFIJO)
      ? input.thumbPath
      : null;

  try {
    await eduStorageRemove(path);
  } catch (e) {
    console.error("[instituto/fotos] no se pudo borrar el huérfano:", path, e);
    await limpiarObjeto(thumb);
    return { deleted: false };
  }
  await limpiarObjeto(thumb);
  return { deleted: true };
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
  patientId: string,
  patch: EduPhotoPatch,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const foto = await getEduPhotoForViewer(ctx, photoId, patientId, now);
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
  //
  // 🔴 N-16 · Y SE MIRA EL `count`. Sin esto, dos alumnos con el mismo
  // paciente abierto: el primero retira la foto, el segundo guarda su
  // corrección, escribe cero filas y recibe un 200 con «La foto quedó
  // en…». Un 200 que no escribió nada es la peor respuesta posible, porque
  // la persona se va convencida.
  const res = await prisma.eduClinicalPhoto.updateMany({
    where: { id: foto.id, institutionId, deletedAt: null },
    data,
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Esa foto se retiró del expediente mientras la corregías: no se guardó nada. Actualiza la pestaña.",
      409,
    );
  }
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
  patientId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const foto = await getEduPhotoForViewer(ctx, photoId, patientId, now);
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
  //
  // 🔴 N-16 · Y SE MIRA EL `count`: si otro la retiró entre la lectura y
  // esta escritura, aquí se escribieron CERO filas. Contestar 200 y «La
  // foto se retiró» le atribuiría a esta persona una baja que hizo otra, y
  // el motivo que se guardó no es el suyo.
  const res = await prisma.eduClinicalPhoto.updateMany({
    where: { id: foto.id, institutionId, deletedAt: null },
    data: { deletedAt: now, deletedById: ctx.eduUserId, deleteReason: reason },
  });
  if (res.count === 0) {
    throw new EduPadronError("Esa foto ya estaba dada de baja.", 409);
  }
  return { id: foto.id };
}

// ═══════════════════════════════════════════════════════════════════════
// N-16 · LO RETIRADO, PARA QUE EL MOTIVO SE PUEDA LEER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las fotos RETIRADAS de un paciente: qué, quién, cuándo y por qué.
 *
 * 🔴 EXISTE PORQUE EL MOTIVO ERA OBLIGATORIO Y NO LO LEÍA NADIE. El modal
 * de retirar promete con todas sus letras que la constancia «es lo que
 * contesta la pregunta dentro de un año», y hasta hoy esa pregunta solo se
 * contestaba en Postgres: no había una sola consulta con
 * `deletedAt: { not: null }` fuera del historial del odontograma.
 *
 * ⚠️ NO SE FIRMA NINGUNA URL. Esto es un registro de por qué algo dejó de
 * estar, no una segunda galería: pedirle a Storage cuarenta enlaces para
 * una sección plegada que casi nadie abre es un viaje pagado por nadie. Y
 * el binario sigue en el bucket, así que si alguna vez hace falta
 * recuperarlo, la fila dice exactamente cuál es.
 *
 * El permiso lo pone quien llama: la sección solo se pinta con
 * `estudios.upload`, que es el mismo que hace falta para retirar.
 */
export async function listEduPatientPhotosRetiradas(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduRetiradoRow[]> {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return [];

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return [];

  const rows = await prisma.eduClinicalPhoto.findMany({
    where: { institutionId, patientId: paciente.id, deletedAt: { not: null } },
    orderBy: [{ deletedAt: "desc" }],
    take: EDU_RETIRADOS_MAX_ROWS,
    select: {
      id: true,
      photoType: true,
      stage: true,
      capturedAt: true,
      deletedAt: true,
      deleteReason: true,
      deletedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const tz = eduSafeTimeZone(timeZone);
  return rows.map((r) => ({
    id: r.id,
    // La foto no tiene nombre de archivo (a propósito: se identifica por su
    // vista y su etapa), así que el "qué" se compone con lo que sí la
    // identifica para una persona.
    que: `${EDU_PHOTO_TYPE_LABELS[r.photoType]} · ${EDU_PHOTO_STAGE_LABELS[r.stage]} · ${dayLabel(
      r.capturedAt,
      tz,
    )}`,
    quien: r.deletedBy ? personName(r.deletedBy) : "",
    cuando: r.deletedAt ? `${dayLabel(r.deletedAt, tz)} ${eduFormatTime(r.deletedAt, tz)}` : "",
    porQue: r.deleteReason ?? "",
  }));
}
