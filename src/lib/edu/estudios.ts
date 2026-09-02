/**
 * DaleControl INSTITUCIONAL — los ESTUDIOS del expediente contra la base
 * de datos y contra Storage.
 *
 * SERVIDOR: importa prisma y el helper del bucket. Lo puro (topes,
 * extensiones, paths) vive en estudios-core.ts; aquí solo hay consultas y
 * las tres piezas de la subida directa.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL BINARIO NUNCA PASA POR EL SERVIDOR.
 *
 *   1. `signEduStudyUpload`    → valida y firma la URL de subida
 *   2. el NAVEGADOR hace el PUT contra esa URL (cientos de MB, sin techo)
 *   3. `confirmEduStudyUpload` → MIDE el objeto real y crea la fila
 *   4. `abortEduStudyUpload`   → limpia lo que se subió y no se confirmó
 *
 * Sin el paso 4, cancelar una subida de 900 MB dejaría el objeto en
 * Storage ocupando espacio real y sin fila que lo contabilice: espacio
 * fantasma que el instituto paga y que nadie puede ver.
 *
 * 🔴 EL TAMAÑO SE LE PREGUNTA A STORAGE, NUNCA AL CLIENTE. El que manda el
 * navegador en /sign es una PISTA para cortar antes de que alguien empiece
 * a subir 2 GB que iban a rebotar; el que se guarda y con el que se decide
 * es el que mide Storage en /confirm.
 *
 * 🔴 EL ALCANCE ES EL DEL EXPEDIENTE (recurso "cases"). Los estudios
 * cuelgan del PACIENTE porque una tomografía sirve para la endodoncia y
 * para la ortodoncia — pero caja no los ve, y eso lo decide el alcance, no
 * la tabla.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
  EDU_MAX_STUDY_BYTES,
  EDU_MAX_STUDY_LABEL,
  EDU_STUDY_EXT,
  EDU_STUDY_MAX_ROWS,
  eduExtOfName,
  eduFormatBytes,
  eduIsStudyExt,
  eduMimeForExt,
  eduResolveStudyKind,
  eduSafeStudyFileName,
  eduStudyIsImage,
  eduStudyIsPdf,
  eduStudyPathBelongsTo,
  eduStudyStoragePath,
  type EduStudyPage,
  type EduStudyRow,
} from "@/lib/edu/estudios-core";
import {
  eduSignReadMany,
  eduSignUpload,
  eduStorageConfigured,
  eduStorageObjectSizeWithRetry,
  eduStorageRemove,
} from "@/lib/edu/storage";
import { eduCaseScopeWhere, eduScopeIsEmpty, type EduClinicaContext } from "@/lib/edu/visibility";

export { EduPadronError as EduEstudiosError };
export type { EduStudyRow, EduStudyPage } from "@/lib/edu/estudios-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

const STUDY_SELECT = {
  id: true,
  kind: true,
  name: true,
  storagePath: true,
  mimeType: true,
  sizeBytes: true,
  notes: true,
  caseId: true,
  uploadedById: true,
  createdAt: true,
  case: { select: { program: { select: { name: true } } } },
  uploadedBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduStudySelect;

type StudyPayload = Prisma.EduStudyGetPayload<{ select: typeof STUDY_SELECT }>;

/**
 * BigInt → number.
 *
 * `JSON.stringify` no sabe serializar un BigInt y revienta el route handler
 * con "Do not know how to serialize a BigInt". El tope son 2 GB, muy por
 * debajo de Number.MAX_SAFE_INTEGER (9 PB), así que la conversión no pierde
 * un solo byte.
 */
function bytesToNumber(v: bigint): number {
  return Number(v);
}

function toRow(s: StudyPayload, url: string, timeZone: string): EduStudyRow {
  const size = bytesToNumber(s.sizeBytes);
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    mimeType: s.mimeType,
    sizeBytes: size,
    sizeLabel: eduFormatBytes(size),
    notes: s.notes,

    caseId: s.caseId,
    caseProgramName: s.case ? s.case.program.name : null,

    uploadedById: s.uploadedById,
    uploadedByName: personName(s.uploadedBy),
    createdAt: s.createdAt.toISOString(),
    createdLabel: stampLabel(s.createdAt, timeZone),

    url,
    isImage: eduStudyIsImage(s.mimeType),
    isPdf: eduStudyIsPdf(s.mimeType),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los estudios de un paciente, con su URL firmada RECIÉN generada.
 *
 * La URL no se guarda en la base nunca: caduca. Se firman todas en un solo
 * viaje a Storage (`createSignedUrls`) porque una galería de 40
 * radiografías con 40 viajes tarda lo que tarda, y se nota.
 *
 * ⚠️ El alcance es el CLÍNICO: quien puede abrir el expediente de este
 * paciente ve TODOS sus estudios, incluidos los que subió otro alumno para
 * otro caso. Es a propósito — una tomografía de la boca es de la boca, y
 * esconderle al de endodoncia la panorámica que pidió el de ortodoncia
 * significa que se la vuelvan a tomar al paciente.
 */
export async function listEduPatientStudies(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduStudyPage> {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return { rows: [], truncated: false };

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return { rows: [], truncated: false };

  const leidas = await prisma.eduStudy.findMany({
    where: { institutionId, patientId: paciente.id },
    orderBy: [{ createdAt: "desc" }],
    // Una de más, solo para poder DECIR que se cortó (ver
    // EDU_STUDY_MAX_ROWS). Se descarta en el `slice` de abajo.
    take: EDU_STUDY_MAX_ROWS + 1,
    select: STUDY_SELECT,
  });
  const truncated = leidas.length > EDU_STUDY_MAX_ROWS;
  // 🔴 EL CORTE VA ANTES DE FIRMAR. La fila sobrante no se pinta, así que
  // pedirle a Storage su URL sería un viaje pagado por un archivo que nadie
  // va a abrir.
  const rows = leidas.slice(0, EDU_STUDY_MAX_ROWS);
  if (rows.length === 0) return { rows: [], truncated };

  // Sin Storage configurado se devuelve la lista con la URL vacía en vez
  // de reventar: la pantalla enseña las tarjetas y dice que el archivo no
  // se puede abrir, que es información útil. Una excepción aquí dejaría la
  // pestaña en blanco sin explicar nada.
  const urls = eduStorageConfigured()
    ? await eduSignReadMany(rows.map((r) => r.storagePath))
    : new Map<string, string>();

  return {
    truncated,
    rows: rows.map((r) => toRow(r, urls.get(r.storagePath) ?? "", timeZone)),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LA SUBIDA, EN TRES PASOS
// ═══════════════════════════════════════════════════════════════════════

async function requireClinicalPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date,
): Promise<string> {
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no te toca.", 404);
  return paciente.id;
}

function requireStorage(): void {
  if (!eduStorageConfigured()) {
    throw new EduPadronError(
      "El almacenamiento de archivos no está configurado en este entorno. Avísale a quien administra el instituto.",
      503,
    );
  }
}

export interface EduSignedUpload {
  path: string;
  signedUrl: string;
  contentType: string;
  maxBytes: number;
}

/**
 * PASO 1 — valida y firma.
 *
 * Lo que se valida aquí (todo en el servidor, nada se cree del cliente):
 *   · sesión + alcance clínico + paciente de ESTE instituto
 *   · extensión dentro de la lista blanca
 *   · tamaño DECLARADO <= 2 GB
 *   · el PATH lo compone el servidor con el institutionId de la SESIÓN
 *
 * Lo que NO se puede validar aquí: la firma real del contenido (los magic
 * numbers), porque los bytes nunca pasan por el servidor. El tamaño
 * declarado es una PISTA —un cliente puede mentir— y por eso /confirm
 * vuelve a medir el objeto real antes de crear la fila.
 */
export async function signEduStudyUpload(
  ctx: EduClinicaContext,
  patientId: string,
  input: { name?: unknown; size?: unknown; contentType?: unknown },
  now: Date = new Date(),
): Promise<EduSignedUpload> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  if (!rawName) throw new EduPadronError("Falta el nombre del archivo.");

  const ext = eduExtOfName(rawName);
  if (!eduIsStudyExt(ext)) {
    throw new EduPadronError(
      `Ese formato no se acepta. Se aceptan: ${EDU_STUDY_EXT.map((e) => `.${e}`).join(", ")}.`,
    );
  }

  const declared = Number(input.size);
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new EduPadronError("Falta el tamaño del archivo.");
  }
  if (declared > EDU_MAX_STUDY_BYTES) {
    throw new EduPadronError(
      `Ese archivo pesa ${eduFormatBytes(declared)} y el máximo por archivo es ${EDU_MAX_STUDY_LABEL}.`,
      413,
    );
  }

  // 🔴 El path lo compone el SERVIDOR, con el institutionId de la sesión y
  // un UUID recién generado. El cliente nunca propone un path: si lo
  // hiciera, bastaría con teclear el de otra escuela para escribir en su
  // carpeta.
  const path = eduStudyStoragePath(
    institutionId,
    pid,
    randomUUID(),
    eduSafeStudyFileName(rawName, ext),
  );
  const contentType = eduMimeForExt(ext, typeof input.contentType === "string" ? input.contentType : "");

  const firmada = await eduSignUpload(path);
  if (!firmada) {
    throw new EduPadronError("No se pudo preparar la subida. Intenta de nuevo.", 500);
  }

  return { path, signedUrl: firmada.signedUrl, contentType, maxBytes: EDU_MAX_STUDY_BYTES };
}

export interface EduConfirmInput {
  path?: unknown;
  name?: unknown;
  caseId?: unknown;
  notes?: unknown;
  kind?: unknown;
}

/**
 * PASO 3 — mide el objeto real y lo registra.
 *
 * El objeto YA está en el bucket (lo subió el navegador). Aquí el servidor
 * decide si esa subida se convierte en una fila del expediente, y NO se
 * cree nada de lo que diga el cliente:
 *   · el `path` debe caer EXACTAMENTE en la carpeta de este instituto y
 *     este paciente — sin esto, conociendo un path ajeno se podría
 *     registrar el archivo de otra escuela dentro del expediente propio;
 *   · la extensión sale del PATH (que compuso el servidor al firmar), no
 *     del nombre que manda el cliente, así el tipo y la carpeta no se
 *     pueden divorciar;
 *   · el tamaño se le pregunta a STORAGE.
 *
 * Es IDEMPOTENTE: un reintento del cliente (o un doble clic) devuelve la
 * fila que ya existe en vez de duplicar el estudio. Lo garantiza el índice
 * único (institutionId, storagePath).
 */
export async function confirmEduStudyUpload(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduConfirmInput,
  now: Date = new Date(),
): Promise<{ id: string; alreadyRegistered: boolean }> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const path = typeof input.path === "string" ? input.path : "";
  if (!path) throw new EduPadronError("Falta la ruta del archivo subido.");
  if (!eduStudyPathBelongsTo(path, institutionId, pid)) {
    throw new EduPadronError("Esa ruta no es de este paciente.", 400);
  }

  const ext = eduExtOfName(path);
  if (!eduIsStudyExt(ext)) throw new EduPadronError("Esa ruta no es válida.", 400);

  const existente = await prisma.eduStudy.findFirst({
    where: { institutionId, storagePath: path },
    select: { id: true },
  });
  if (existente) return { id: existente.id, alreadyRegistered: true };

  const size = await eduStorageObjectSizeWithRetry(path);
  if (size == null) {
    // 409 y no 500: el objeto puede existir y todavía no listarse. El
    // cliente reintenta el REGISTRO (no la subida) y suele entrar.
    throw new EduPadronError(
      "El archivo todavía no aparece en el almacenamiento. Espera un momento y vuelve a intentar.",
      409,
    );
  }
  if (size > EDU_MAX_STUDY_BYTES) {
    // Se borra: si se quedara, ocuparía espacio sin fila que lo
    // contabilice, y nadie podría verlo ni para borrarlo.
    await eduStorageRemove(path).catch((e) => {
      console.error("[instituto/estudios] no se pudo borrar el objeto rechazado:", path, e);
    });
    throw new EduPadronError(
      `El archivo pesa ${eduFormatBytes(size)} y el máximo por archivo es ${EDU_MAX_STUDY_LABEL}.`,
      413,
    );
  }

  // El caso al que se engancha, si se engancha a alguno. Se comprueba
  // dentro del ALCANCE: no se puede colgar un estudio de un caso que quien
  // sube no puede ver.
  let caseId: string | null = null;
  if (input.caseId !== undefined && input.caseId !== null && input.caseId !== "") {
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

  const nombre =
    (typeof input.name === "string" ? input.name.trim().slice(0, 160) : "") || `estudio.${ext}`;

  const created = await prisma.eduStudy.create({
    data: {
      institutionId,
      patientId: pid,
      caseId,
      // 🔴 El `kind` lo decide la EXTENSIÓN del path que compuso el
      // servidor, no el cliente: si viniera del navegador, un .zip de 600
      // MB podría registrarse como "FOTO" y la galería intentaría pintarlo
      // con un <img>. Ola 12 — la ÚNICA corrección que se le acepta al
      // cliente es radiografía↔foto sobre una IMAGEN, porque ahí la
      // extensión no alcanza a decidir; todo lo demás lo sigue mandando el
      // path (ver eduResolveStudyKind).
      kind: eduResolveStudyKind(ext, input.kind),
      name: nombre,
      storagePath: path,
      mimeType: eduMimeForExt(ext),
      sizeBytes: BigInt(Math.trunc(size)),
      notes: eduOptionalText(input.notes, 1000) ?? null,
      uploadedById: ctx.eduUserId,
    },
    select: { id: true },
  });

  return { id: created.id, alreadyRegistered: false };
}

/**
 * LIMPIEZA — borra el objeto que se subió y NUNCA se confirmó.
 *
 * Se defiende en tres frentes porque borra bytes:
 *   1. sesión + alcance clínico + paciente de este instituto;
 *   2. el path tiene que caer en la carpeta de este instituto y paciente;
 *   3. NO debe existir ninguna fila EduStudy apuntando a ese path. Solo se
 *      borran huérfanos: si el archivo ya es parte del expediente, esta
 *      puerta no es un atajo para sacarlo de ahí.
 *
 * Es best-effort por diseño: si el navegador se cierra a media subida nadie
 * la llama, y ese caso queda para un barrido periódico de huérfanos
 * (anotado como pendiente en ORQUESTA.md).
 */
export async function abortEduStudyUpload(
  ctx: EduClinicaContext,
  patientId: string,
  input: { path?: unknown },
  now: Date = new Date(),
): Promise<{ deleted: boolean }> {
  const institutionId = requireInstitution(ctx);
  requireStorage();
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const path = typeof input.path === "string" ? input.path : "";
  if (!path) throw new EduPadronError("Falta la ruta del archivo.");
  if (!eduStudyPathBelongsTo(path, institutionId, pid)) {
    throw new EduPadronError("Esa ruta no es de este paciente.", 400);
  }

  const registrado = await prisma.eduStudy.findFirst({
    where: { institutionId, storagePath: path },
    select: { id: true },
  });
  if (registrado) {
    throw new EduPadronError("Ese archivo ya está registrado en el expediente.", 409);
  }

  try {
    await eduStorageRemove(path);
  } catch (e) {
    // Que falle la limpieza no debe romperle nada a quien simplemente
    // canceló una subida. Se registra para el barrido de huérfanos.
    console.error("[instituto/estudios] no se pudo borrar el huérfano:", path, e);
    return { deleted: false };
  }
  return { deleted: true };
}
