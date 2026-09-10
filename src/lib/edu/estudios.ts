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
// `Prisma` entra como VALOR y no solo como tipo: `Prisma.DbNull` es lo
// único que sabe escribir un NULL de verdad en una columna Json —
// `null` a secas en un campo Json significa "el JSON null" y Prisma lo
// rechaza en tiempo de tipos.
import { Prisma } from "@prisma/client";
import type { EduStudyKind } from "@/lib/edu/types";
import { prisma } from "@/lib/prisma";
import { CBCT_LITE_CONTENT_TYPE } from "@/components/patient-3d/cbct-lite-shared";
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
  EDU_STUDY_ABORT_YA_REGISTRADO,
  EDU_STUDY_EXT,
  EDU_RETIRADOS_MAX_ROWS,
  EDU_STUDY_MAX_ROWS,
  EDU_STUDY_MOTIVO_MAX,
  eduExtOfName,
  eduFormatBytes,
  eduIsStudyExt,
  eduMimeForExt,
  eduOrdenarEstudios,
  eduParseStudyMarks,
  eduParseTakenAt,
  eduResolveStudyKind,
  eduSafeStudyFileName,
  eduSerializeStudyMarks,
  eduStudyIsImage,
  eduStudyIsPdf,
  eduStudyOrdenISO,
  eduStudyPathBelongsTo,
  eduStudyStoragePath,
  eduValidarReclasificacion,
  type EduRetiradoRow,
  type EduStudyPage,
  type EduStudyRow,
} from "@/lib/edu/estudios-core";
import {
  eduAlmCabe,
  eduAlmRechazo,
  eduAlmRestanteBytes,
} from "@/lib/edu/almacenamiento-core";
import { getEduAlmacenamientoMedidor } from "@/lib/edu/almacenamiento";
import {
  eduSignRead,
  eduSignReadMany,
  eduSignUpload,
  eduStorageConfigured,
  eduStorageDownload,
  eduStorageObjectSize,
  eduStorageObjectSizeWithRetry,
  eduStorageRemove,
  eduStorageUpload,
} from "@/lib/edu/storage";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";

export { EduPadronError as EduEstudiosError };
export type { EduStudyRow, EduStudyPage, EduStudyMark } from "@/lib/edu/estudios-core";

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
  // ws2-t2: la fecha de TOMA (por la que ordena la galería) y las marcas
  // sobre la imagen. Las dos columnas existían desde la Ola B y no las
  // leía nadie.
  takenAt: true,
  annotations: true,
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
  const createdAt = s.createdAt.toISOString();
  const takenAt = s.takenAt ? s.takenAt.toISOString() : null;
  // La regla del COALESCE vive en el core y con su prueba: aquí solo se
  // le pregunta. Que el servidor mande `ordenAt` resuelto es lo que impide
  // que la galería y el resumen ordenen distinto la misma placa.
  const orden = eduStudyOrdenISO({ takenAt, createdAt });
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
    createdAt,
    createdLabel: stampLabel(s.createdAt, timeZone),

    // La extensión sale del PATH que compuso el servidor, no del `name`
    // que ahora se puede corregir: es lo único que no puede mentir sobre
    // qué es el archivo.
    ext: eduExtOfName(s.storagePath),

    takenAt,
    takenLabel: s.takenAt ? dayLabel(s.takenAt, timeZone) : "",
    ordenAt: orden.iso,
    ordenPorToma: orden.porToma,

    // El JSON de la columna nunca llega crudo a la pantalla: se sanea aquí
    // y lo que no encaja se descarta. Un visor no se puede caer por una
    // marca mal escrita.
    annotations: eduParseStudyMarks(s.annotations),

    url,
    isImage: eduStudyIsImage(s.mimeType),
    isPdf: eduStudyIsPdf(s.mimeType),
  };
}

/** "mié, 12 mar" en la zona del instituto — la fecha de TOMA, sin hora:
 *  de una placa se sabe el día en que se tomó, no la hora. */
function dayLabel(d: Date, timeZone: string): string {
  const { dayISO } = eduUtcToZoned(d, eduSafeTimeZone(timeZone));
  return eduFormatDayShort(dayISO);
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
  // S-9: el sello de cuándo se firmaron las URLs viaja SIEMPRE, también en
  // las respuestas vacías, para que la pantalla no tenga que tratar el
  // caso "no hay sello" como un caso aparte.
  const signedAt = now.toISOString();
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return { rows: [], truncated: false, signedAt };

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return { rows: [], truncated: false, signedAt };

  const leidas = await prisma.eduStudy.findMany({
    // 🔴 ws2-t2 · LOS RETIRADOS NO SALEN, y el recorte va en el `where` y
    // no en un `.filter()` posterior: un recorte que vive fuera de la
    // consulta es un recorte que el siguiente `findMany` se olvida de
    // copiar. Es exactamente lo que ya hacen las fotos.
    where: { institutionId, patientId: paciente.id, deletedAt: null },
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
  //
  // ⚠️ Y el corte es por fecha de SUBIDA, que es por lo que ordena la
  // consulta; el reorden por fecha de TOMA viene después, sobre lo que
  // quedó. Prisma no sabe ordenar por COALESCE sin bajar a SQL crudo, y
  // `orderBy: [{takenAt}, {createdAt}]` NO es lo mismo (pondría todas las
  // que tienen fecha de toma antes que todas las que no). Está escrito en
  // eduOrdenarEstudios y la pantalla avisa cuando corta.
  const rows = leidas.slice(0, EDU_STUDY_MAX_ROWS);
  if (rows.length === 0) return { rows: [], truncated, signedAt };

  // Sin Storage configurado se devuelve la lista con la URL vacía en vez
  // de reventar: la pantalla enseña las tarjetas y dice que el archivo no
  // se puede abrir, que es información útil. Una excepción aquí dejaría la
  // pestaña en blanco sin explicar nada.
  const urls = eduStorageConfigured()
    ? await eduSignReadMany(rows.map((r) => r.storagePath))
    : new Map<string, string>();

  return {
    truncated,
    signedAt,
    rows: eduOrdenarEstudios(rows.map((r) => toRow(r, urls.get(r.storagePath) ?? "", timeZone))),
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
 *   · tamaño DECLARADO <= 2 GB (el tope POR ARCHIVO)
 *   · que quepa en la CUOTA DEL INSTITUTO (el tope de la ESCUELA) — son
 *     dos límites distintos y los dos siguen valiendo
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

  // ── LA CUOTA DEL INSTITUTO ───────────────────────────────────────────
  //
  // 🔴 EL CORTE VA AQUÍ, ANTES DE FIRMAR. Después de firmar, el navegador
  // ya se pasó veinte minutos subiendo una tomografía que iba a rebotar
  // igual — y el rebote llegaría del bucket, sin palabras.
  //
  // Son DOS TOPES DISTINTOS y los dos siguen valiendo: arriba, lo que pesa
  // ESE archivo (2 GB, EDU_MAX_STUDY_BYTES, que es un límite técnico de la
  // subida); aquí, lo que le queda a la ESCUELA (su cuota contratada). Un
  // archivo de 1 GB pasa el primero y no pasa el segundo si quedan 200 MB.
  //
  // El tamaño con el que se decide es el DECLARADO, que un cliente podría
  // mentir a la baja. No importa para la cuota: mentir aquí solo consigue
  // colar UN archivo (acotado a 2 GB por el tope de arriba, que /confirm
  // vuelve a medir contra el objeto real), y el siguiente /sign ya ve el
  // total verdadero porque el consumo se cuenta, no se guarda.
  const medidor = await getEduAlmacenamientoMedidor(institutionId);
  if (!eduAlmCabe(medidor, declared)) {
    // 507 Insufficient Storage, no 413: el archivo no es demasiado grande,
    // es la escuela la que no tiene sitio. Se distinguen en los logs, y el
    // mensaje —que la pantalla enseña tal cual— dice cuánto queda, cuánto
    // pesa esto y a quién avisarle.
    throw new EduPadronError(eduAlmRechazo(medidor, declared), 507);
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
  /** ws2-t2 · CUÁNDO SE TOMÓ. Se captura al subir porque preguntarlo
   *  después no lo pregunta nadie: la placa de hace un año se sube hoy y
   *  se queda ordenada como de hoy para siempre. */
  takenAt?: unknown;
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

  // ws2-t2 · La fecha de TOMA. Una en el futuro se rechaza (desordena la
  // galería para siempre); una que no vino deja la columna vacía y la
  // galería ordena por la de subida, que es lo que hacía siempre.
  const taken = eduParseTakenAt(input.takenAt, now);
  if (taken === false) {
    throw new EduPadronError(
      "Esa fecha de toma no es válida. No puede quedar en el futuro: la galería ordena por ella.",
      400,
    );
  }

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
      takenAt: taken ?? null,
      uploadedById: ctx.eduUserId,
    },
    select: { id: true },
  });

  // ── LA CARRERA CON LA CUOTA ──────────────────────────────────────────
  //
  // 🔴 AQUÍ NO SE RECHAZA POR CUOTA, Y ES UNA DECISIÓN, NO UN OLVIDO.
  //
  // El corte vive en /sign. Dos personas que firman a la vez con la bolsa
  // casi llena ven las dos el mismo hueco y las dos suben: al llegar aquí,
  // el total puede quedar por encima de la cuota. Se registra igual.
  //
  // Porque en este punto los bytes YA ESTÁN en el bucket: rechazar no
  // ahorra un peso salvo que se BORRE el objeto, y eso es destruir una
  // radiografía que alguien subió entera por una carrera que no podía ver.
  // (El tope de 2 GB de arriba sí borra, y no es lo mismo: allí el cliente
  // mintió sobre el tamaño al firmar.) El rebase está acotado a lo que
  // estaba en vuelo, se autocorrige en el siguiente /sign —el consumo se
  // cuenta, no se guarda— y el /admin lo ve y lo factura.
  //
  // El razonamiento largo está en src/lib/edu/almacenamiento.ts.
  //
  // Lo que sí se hace es dejar RASTRO, sin poder romper nada: si esta
  // consulta falla, el estudio ya está registrado y así se queda.
  try {
    const medidor = await getEduAlmacenamientoMedidor(institutionId);
    if (eduAlmRestanteBytes(medidor) <= 0 && medidor.usadoBytes > medidor.cuotaBytes) {
      console.warn(
        "[instituto/estudios] cuota rebasada por una subida en vuelo:",
        JSON.stringify({
          institutionId,
          studyId: created.id,
          bytesDelArchivo: Math.trunc(size),
          usadoBytes: medidor.usadoBytes,
          cuotaBytes: medidor.cuotaBytes,
        }),
      );
    }
  } catch (e) {
    console.error("[instituto/estudios] no se pudo revisar la cuota tras registrar:", e);
  }

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

  // 🔴 SIN `deletedAt: null` A PROPÓSITO. Un estudio RETIRADO sigue
  // apuntando a su objeto: el binario se conserva (misma decisión que las
  // fotos), así que esta puerta tampoco puede borrarlo. Si filtrara los
  // retirados, "cancelar una subida" se convertiría en la forma de
  // destruir la evidencia que "Retirar" existe para conservar.
  const registrado = await prisma.eduStudy.findFirst({
    where: { institutionId, storagePath: path },
    select: { id: true },
  });
  if (registrado) {
    // ws2-t2 · Ya no se acaba la conversación en "ya está registrado": se
    // dice a dónde ir. El texto vive en estudios-core.ts, con su prueba.
    throw new EduPadronError(EDU_STUDY_ABORT_YA_REGISTRADO, 409);
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


// ════════════════════════════════════════════════════════════════════════
// EL ESTUDIO SUELTO — lo que necesita el visor montado en la ficha
// ════════════════════════════════════════════════════════════════════════

export interface EduStudyForViewer {
  id: string;
  patientId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  notes: string | null;
  /** ws2-t2 · null = vivo. Quien llama decide: dar de baja dos veces tiene
   *  que poder contestar "ya estaba retirado" y no "no existe". */
  deletedAt: Date | null;
}

/**
 * UN estudio, buscado DENTRO del alcance CLÍNICO.
 *
 * 🔴 Es la puerta de las dos rutas nuevas del visor (el CBCT reducido y
 * las notas). El institutionId sale de la SESIÓN y el paciente pasa por
 * `eduPatientScopeWhere`, así que un id de otra escuela —o de un paciente
 * que a este rol no le toca— no existe: devuelve null y la ruta contesta
 * 404, igual que uno inventado. El mismo recorte que usa la galería, para
 * que "lo que veo" y "lo que puedo preparar o anotar" no se separen nunca.
 *
 * ⚠️ ws2-t2 · Devuelve TAMBIÉN los RETIRADOS, con su `deletedAt`, y quien
 * llama decide qué hacer con eso — igual que `getEduPhotoForViewer`. Las
 * escrituras (notas, corrección, retirar) lo miran y contestan 409 o 410
 * con palabras; la LECTURA de la galería no llega aquí porque su `where`
 * ya los excluyó.
 */
export async function getEduStudyForViewer(
  ctx: EduClinicaContext,
  studyId: string,
  now: Date = new Date(),
): Promise<EduStudyForViewer | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(studyId);
  if (!id) return null;

  const row = await prisma.eduStudy.findFirst({
    where: {
      id,
      institutionId,
      patient: eduPatientScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      patientId: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      storagePath: true,
      notes: true,
      deletedAt: true,
    },
  });
  if (!row) return null;
  return { ...row, sizeBytes: bytesToNumber(row.sizeBytes) };
}

/**
 * Las NOTAS del estudio, escritas desde el visor.
 *
 * El visor del dental manda `{ doctorNotes }`; aquí se guarda en
 * `EduStudy.notes`, que es la MISMA columna que rellena el formulario de
 * subida y la que lee la línea de tiempo del expediente. Un solo sitio: si
 * el visor escribiera en otro lado, el estudio tendría dos notas y la ficha
 * enseñaría la vieja.
 *
 * El tope es el del `@db.VarChar(1000)` del esquema. Recortar aquí y no
 * rebotar es a propósito: quien acaba de escribir no pierde lo escrito por
 * pasarse de largo.
 */
export async function updateEduStudyNotes(
  ctx: EduClinicaContext,
  studyId: string,
  rawNotes: unknown,
  now: Date = new Date(),
): Promise<{ notes: string | null }> {
  const institutionId = requireInstitution(ctx);
  const estudio = await getEduStudyForViewer(ctx, studyId, now);
  if (!estudio) throw new EduPadronError("Ese estudio no existe o no te toca.", 404);

  if (estudio.deletedAt) {
    throw new EduPadronError("Ese estudio está retirado del expediente: ya no se edita.", 409);
  }

  const notes = eduOptionalText(rawNotes, 1000) ?? null;
  // updateMany con el institutionId REPETIDO en el where: aunque el
  // findFirst de arriba ya lo comprobó, la escritura no se apoya en que
  // nadie meta mano entre las dos consultas. Y `deletedAt: null` por lo
  // mismo: entre la lectura y la escritura, otro pudo retirarlo.
  //
  // 🔴 N-16 · Y SE MIRA EL `count`. Sin esto, escribir cero filas devolvía
  // 200 y la nota que la persona acaba de teclear desaparecía en el
  // siguiente refresco, sin una palabra.
  const res = await prisma.eduStudy.updateMany({
    where: { id: estudio.id, institutionId, deletedAt: null },
    data: { notes },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Ese estudio se retiró del expediente mientras escribías: la nota no se guardó. Actualiza la pestaña.",
      409,
    );
  }
  return { notes };
}

/**
 * El CBCT REDUCIDO para el móvil (`.lite2.bin`), generado una vez y reusado.
 *
 * Mismo patrón que la ruta del dental: se descarga el .zip original, se
 * reduce con `buildCbctLite` (lib COMPARTIDA — se importa, no se copia: la
 * próxima corrección de geometría del dental llega sola) y el binario
 * hermano se guarda al lado del original en el bucket `edu-files`. La
 * siguiente apertura lo encuentra hecho.
 *
 * 🔴 Es la invocación MÁS CARA del vertical: descomprime el .zip ENTERO en
 * memoria. El techo de tamaño es el MISMO número que el del dental
 * (importado, no copiado); el freno por instituto y el candado por estudio
 * los pone la ruta, que es quien tiene la petición.
 *
 * El import de `@/lib/cbct-lite` es DINÁMICO: JSZip y el decodificador
 * pesan, y no tienen por qué entrar en el bundle de las pantallas que
 * simplemente listan estudios.
 */
export interface EduLiteResult {
  liteUrl: string;
  cached: boolean;
  count?: number;
  rows?: number;
  cols?: number;
  sourceSlices?: number;
}

export async function buildEduStudyLite(
  estudio: EduStudyForViewer,
  litePath: string,
  targetXY: number,
): Promise<EduLiteResult> {
  requireStorage();

  const zip = await eduStorageDownload(estudio.storagePath);
  if (!zip) {
    throw new EduPadronError("No se pudo leer el estudio original.", 500);
  }

  const { buildCbctLite } = await import("@/lib/cbct-lite");
  const result = await buildCbctLite(zip, targetXY, 180);

  const guardado = await eduStorageUpload(
    litePath,
    Buffer.from(result.bytes),
    CBCT_LITE_CONTENT_TYPE,
  );
  if (!guardado) {
    throw new EduPadronError("No se pudo guardar la versión ligera del estudio.", 500);
  }

  const liteUrl = await eduSignRead(litePath);
  if (!liteUrl) {
    throw new EduPadronError("No se pudo firmar la versión ligera del estudio.", 500);
  }

  return {
    liteUrl,
    cached: false,
    count: result.meta.count,
    rows: result.meta.rows,
    cols: result.meta.cols,
    sourceSlices: result.sourceSlices,
  };
}

/** ¿Ya está generado el binario reducido? Devuelve su URL firmada o "". */
export async function eduLiteYaGenerado(litePath: string): Promise<string> {
  const size = await eduStorageObjectSize(litePath);
  if (size == null) return "";
  return eduSignRead(litePath);
}

// ═══════════════════════════════════════════════════════════════════════
// ws2-t2 · CORREGIR Y RETIRAR — el rastro que faltaba (H-14)
//
// Hasta hoy un estudio subido al paciente equivocado se quedaba en su
// expediente para siempre: no se podía renombrar, ni reclasificar, ni
// mover de caso, ni fechar, ni sacar. Lo ÚNICO editable era la nota, y
// `abortEduStudyUpload` decía que no con un 409 sin salida.
//
// 🔴 NADA SE BORRA. "Retirar" es una BAJA SUAVE con autor y con motivo, y
// el BINARIO SE CONSERVA — la misma decisión que las fotos, y por la misma
// razón: un estudio retirado es la constancia de que alguien lo subió al
// paciente equivocado, y esa constancia es justo lo que un expediente
// clínico no puede perder.
// ═══════════════════════════════════════════════════════════════════════

export interface EduStudyPatch {
  /** El nombre que se lee. Vacío NO borra: un estudio sin nombre no se
   *  encuentra nunca más. */
  name?: unknown;
  /** Solo entre los compatibles con la extensión (eduResolveStudyKind). */
  kind?: unknown;
  /** El caso, dentro del alcance. `null` o "" lo desengancha. */
  caseId?: unknown;
  /** ISO, o vacío para borrarla y volver a ordenar por la de subida. */
  takenAt?: unknown;
  notes?: unknown;
  /** Las marcas sobre la imagen. Se reemplazan enteras, no se fusionan. */
  annotations?: unknown;
}

/**
 * CORRIGE un estudio: nombre, tipo, caso, fecha de toma, nota y marcas.
 *
 * Un campo que no viene NO se toca (`undefined` = "no cambies"). `notes` y
 * `takenAt` en vacío BORRAN su valor; `name` en vacío se rechaza.
 *
 * 🔴 EL `kind` NO SE ACEPTA A CIEGAS. Pasa por `eduValidarReclasificacion`,
 * que le pregunta a `eduResolveStudyKind` —la misma función que decide el
 * tipo al registrar— si la extensión lo permite. Resultado práctico: una
 * imagen va y viene entre RADIOGRAFIA y FOTO (que es la corrección que de
 * verdad hace falta, porque el servidor asume RADIOGRAFIA para TODA
 * imagen y por eso el Resumen rotulaba "Radiografía" una foto de la
 * sonrisa), y un `.zip` de 600 MB nunca se convierte en "Foto".
 *
 * El permiso es `estudios.upload` y lo exige la ruta: corregir el tipo o
 * la fecha cambia lo que enseña el expediente, o sea, es escritura.
 */
export async function updateEduStudy(
  ctx: EduClinicaContext,
  studyId: string,
  patch: EduStudyPatch,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const estudio = await getEduStudyForViewer(ctx, studyId, now);
  if (!estudio) throw new EduPadronError("Ese estudio no existe o no te toca.", 404);
  if (estudio.deletedAt) {
    throw new EduPadronError("Ese estudio está retirado del expediente: ya no se corrige.", 409);
  }

  // `Unchecked…` y no `…UpdateManyMutationInput`: la variante "checked"
  // solo deja tocar escalares, y `caseId` es la clave foránea del caso.
  // Mover un estudio de caso es literalmente escribir esa columna.
  const data: Prisma.EduStudyUncheckedUpdateManyInput = {};

  if (patch?.name !== undefined) {
    const nombre = typeof patch.name === "string" ? patch.name.trim().slice(0, 160) : "";
    if (!nombre) {
      throw new EduPadronError(
        "El nombre no puede quedar vacío: es por lo que se encuentra el estudio después.",
        400,
      );
    }
    data.name = nombre;
  }

  if (patch?.kind !== undefined) {
    // 🔴 La extensión sale del PATH que compuso el servidor, no del nombre
    // que se ve en pantalla: renombrar "x.jpg" a "x.zip" no puede cambiar
    // lo que el archivo es. Es el mismo criterio de /confirm.
    const ext = eduExtOfName(estudio.storagePath);
    const malo = eduValidarReclasificacion(ext, patch.kind);
    if (malo) throw new EduPadronError(malo, 400);
    data.kind = patch.kind as EduStudyKind;
  }

  if (patch?.takenAt !== undefined) {
    const taken = eduParseTakenAt(patch.takenAt, now);
    if (taken === false) {
      throw new EduPadronError(
        "Esa fecha de toma no es válida. No puede quedar en el futuro: la galería ordena por ella.",
        400,
      );
    }
    data.takenAt = taken ?? null;
  }

  if (patch?.notes !== undefined) {
    data.notes = eduOptionalText(patch.notes, 1000) ?? null;
  }

  if (patch?.annotations !== undefined) {
    // Se REEMPLAZAN enteras y no se fusionan: el visor manda la lista que
    // tiene delante, y fusionar haría imposible BORRAR una marca.
    data.annotations = (eduSerializeStudyMarks(patch.annotations) ??
      Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull;
  }

  // El CASO va al final porque es el único que consulta: se comprueba
  // DENTRO del alcance y contra ESTE paciente. Mover un estudio a un caso
  // que quien lo mueve no puede ver sería esconderlo.
  if (patch?.caseId !== undefined) {
    if (patch.caseId === null || patch.caseId === "") {
      data.caseId = null;
    } else {
      const scope = eduClinicalScope(ctx);
      const cid = eduCleanId(patch.caseId);
      const caso = cid
        ? await prisma.eduCase.findFirst({
            where: {
              ...eduCaseScopeWhere({ institutionId, scope, now }),
              id: cid,
              patientId: estudio.patientId,
            },
            select: { id: true },
          })
        : null;
      if (!caso) throw new EduPadronError("Ese caso no es de este paciente.", 404);
      data.caseId = caso.id;
    }
  }

  if (Object.keys(data).length === 0) {
    throw new EduPadronError("No mandaste nada que cambiar.", 400);
  }

  // updateMany con el institutionId REPETIDO y `deletedAt: null`: aunque
  // el findFirst de arriba ya lo comprobó, la escritura no se apoya en que
  // nadie meta mano entre las dos consultas.
  //
  // 🔴 N-16 · Y SE MIRA EL `count`: dos alumnos con el mismo paciente
  // abierto, el primero retira el estudio y el segundo recibe un 200 con
  // «quedó corregido» sin haber escrito nada. Un 200 que no escribió es la
  // peor respuesta posible, porque la persona se va convencida.
  const res = await prisma.eduStudy.updateMany({
    where: { id: estudio.id, institutionId, deletedAt: null },
    data,
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Ese estudio se retiró del expediente mientras lo corregías: no se guardó nada. Actualiza la pestaña.",
      409,
    );
  }
  return { id: estudio.id };
}

/**
 * RETIRA un estudio del expediente. Baja SUAVE, con autor y con MOTIVO.
 *
 * 🔴 NUNCA `prisma.eduStudy.delete`, y el BINARIO SE QUEDA en el bucket.
 * Es la misma decisión que las fotos y la contraria a la goma del
 * odontograma (H-17), que sí destruía rastro. La contrapartida, dicha en
 * voz alta: esos bytes siguen ocupando sitio en Storage y dejan de contar
 * para la cuota — el mismo hueco que los huérfanos (H-26), que se cierra
 * con el mismo barrido periódico y no con esta casilla.
 *
 * 🔴 EL MOTIVO ES OBLIGATORIO. Sin él, "retirar" y "borrar" son la misma
 * cosa con distinto nombre: dentro de un año la fila dice que alguien lo
 * quitó y no dice por qué, que es exactamente la pregunta que se hace.
 */
export async function softDeleteEduStudy(
  ctx: EduClinicaContext,
  studyId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const estudio = await getEduStudyForViewer(ctx, studyId, now);
  if (!estudio) throw new EduPadronError("Ese estudio no existe o no te toca.", 404);
  if (estudio.deletedAt) {
    // 409 y no 404: un 404 le haría creer a alguien que perdió el estudio.
    throw new EduPadronError("Ese estudio ya estaba retirado del expediente.", 409);
  }

  const reason = eduOptionalText(rawReason, EDU_STUDY_MOTIVO_MAX);
  if (!reason) {
    throw new EduPadronError(
      "Escribe por qué se retira el estudio. Queda en el expediente y es lo que contesta la pregunta dentro de un año.",
      400,
    );
  }

  // Los tres campos se escriben JUNTOS, en una sola escritura: una baja
  // con fecha y sin autor, o con autor y sin motivo, no es una baja.
  //
  // 🔴 N-16 · Y SE MIRA EL `count`: si otro lo retiró entre la lectura y
  // esta escritura, aquí se escribieron CERO filas. Contestar 200 le
  // atribuiría a esta persona una baja que hizo otra, y el motivo que
  // quedó guardado no es el suyo.
  const res = await prisma.eduStudy.updateMany({
    where: { id: estudio.id, institutionId, deletedAt: null },
    data: { deletedAt: now, deletedById: ctx.eduUserId, deleteReason: reason },
  });
  if (res.count === 0) {
    throw new EduPadronError("Ese estudio ya estaba retirado del expediente.", 409);
  }
  return { id: estudio.id };
}

// ════════════════════════════════════════════════════════════════════════
// N-16 · LO RETIRADO, PARA QUE EL MOTIVO SE PUEDA LEER
// ════════════════════════════════════════════════════════════════════════

/**
 * Los estudios RETIRADOS de un paciente: qué, quién, cuándo y por qué.
 *
 * 🔴 EXISTE PORQUE EL MOTIVO ERA OBLIGATORIO Y NO LO LEÍA NADIE.
 * `estudio-editar.tsx` promete con todas sus letras que la constancia «es
 * lo que contesta la pregunta dentro de un año», y hasta hoy esa pregunta
 * solo se contestaba en Postgres: no había una sola consulta con
 * `deletedAt: { not: null }` fuera del historial del odontograma.
 *
 * ⚠️ NO SE FIRMA NINGUNA URL. Esto es el registro de por qué algo dejó de
 * estar, no una segunda galería: la sección va plegada y casi nadie la
 * abre, y pedirle a Storage cincuenta enlaces para eso es un viaje pagado
 * por nadie. El binario sigue en el bucket, así que si alguna vez hace
 * falta recuperarlo, la fila dice exactamente cuál es.
 *
 * El permiso lo pone quien llama: la sección solo se pinta con
 * `estudios.upload`, que es el mismo que hace falta para retirar.
 */
export async function listEduPatientStudiesRetirados(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduRetiradoRow[]> {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return [];

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return [];

  const rows = await prisma.eduStudy.findMany({
    where: { institutionId, patientId: paciente.id, deletedAt: { not: null } },
    orderBy: [{ deletedAt: "desc" }],
    take: EDU_RETIRADOS_MAX_ROWS,
    select: {
      id: true,
      name: true,
      deletedAt: true,
      deleteReason: true,
      deletedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const tz = eduSafeTimeZone(timeZone);
  return rows.map((r) => ({
    id: r.id,
    que: r.name,
    quien: r.deletedBy ? personName(r.deletedBy) : "",
    cuando: r.deletedAt ? stampLabel(r.deletedAt, tz) : "",
    porQue: r.deleteReason ?? "",
  }));
}
