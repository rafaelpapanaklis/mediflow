/**
 * DaleControl INSTITUCIONAL — EL GATE DE AUTORIZACIÓN contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". Lo puro
 * vive en autorizaciones-core.ts y el sha256 en autorizaciones-hash.ts.
 *
 * 🔴 LAS CUATRO REGLAS DE ORO DE ESTE ARCHIVO
 *
 * 1. TODA función recibe el contexto de sesión y saca de ahí el
 *    institutionId. Ninguna lo acepta suelto, ninguna lo lee de un body.
 *
 * 2. NINGUNA lectura arma su propio recorte: el alcance sale de
 *    `eduVisibility(ctx, "cases")`, el mismo del expediente. Para CAJA eso es
 *    "none" y el `where` no devuelve una sola fila — ni con
 *    `autorizaciones.view` encendido a mano. Un docente que ya rotó tampoco
 *    ve (ni firma) lo de los alumnos que entregó: el recorte cuelga de la
 *    asignación VIGENTE, no de una columna del caso.
 *
 * 3. EL HASH SE RECALCULA AL FIRMAR, sobre lo que el docente tiene delante.
 *    No se copia el que traía la petición: si el alumno editó entre que la
 *    mandó y que se firmó, lo que queda autorizado tiene que ser lo que se
 *    leyó, no lo que se mandó.
 *
 * 4. NADIE FIRMA SU PROPIA PETICIÓN. No es un permiso: es que una firma sobre
 *    lo que uno mismo pidió no es una firma. Se comprueba aquí y no en el
 *    endpoint porque el endpoint no sabe de quién era la fila.
 *
 * Las escrituras NO comprueban permisos: eso lo hace el endpoint con
 * eduApiGuard antes de llamar. Aquí se comprueba la PERTENENCIA, que es lo
 * que un permiso no puede saber.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import {
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_APPROVAL_BATCH_MAX,
  EDU_APPROVAL_EMERGENCY_REASON_MAX,
  EDU_APPROVAL_EMERGENCY_REASON_MIN,
  EDU_APPROVAL_MAX_ROWS,
  EDU_APPROVAL_NOTE_MAX,
  EDU_APPROVAL_NOTE_MIN,
  eduApprovalBatchSkipReason,
  eduApprovalContentChanged,
  eduApprovalDecisionNeedsNote,
  eduApprovalEffectiveStatus,
  eduApprovalStageForCaseStatus,
  eduApprovalTargetForStage,
  eduApprovalWaitSeverity,
  eduApprovalWaitedLabel,
  eduApprovalWaitedMinutes,
  eduCaseGateVerdict,
  parseEduApprovalDecision,
  parseEduApprovalStage,
  parseEduApprovalTarget,
  type EduApprovalBatchSkip,
  type EduApprovalRow,
  type EduApprovalSnapshot,
  type EduApprovalSummary,
  type EduApprovalTarget,
  type EduApprovalTargetOption,
  type EduGateVerdict,
} from "@/lib/edu/autorizaciones-core";
import { eduApprovalHash } from "@/lib/edu/autorizaciones-hash";
import { EDU_SOAP_LABELS } from "@/lib/edu/expediente-core";
import {
  EDU_APPOINTMENT_TYPE_LABELS,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_CASE_STATUS_LABELS,
  type EduApprovalStage,
  type EduCaseStatus,
} from "@/lib/edu/types";

export { EduPadronError as EduAutorizacionError };
export type {
  EduApprovalRow,
  EduApprovalGroup,
  EduApprovalTargetOption,
} from "@/lib/edu/autorizaciones-core";

/**
 * Cliente de Prisma o cliente de transacción, indistintamente.
 *
 * El GATE tiene que poder correr DENTRO de la transacción que mueve el caso
 * (src/lib/edu/casos.ts): comprobarlo fuera dejaría una ventana entre "sí
 * puede avanzar" y el UPDATE en la que alguien podría revocar la firma.
 */
type EduDb = Prisma.TransactionClient;

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

/**
 * Sello legible EN LA ZONA DEL INSTITUTO ("mar 1 sep 14:30").
 *
 * `requestedAt` y `decidedAt` son INSTANTES, no fechas de calendario: una
 * petición de las 19:00 en Tijuana pintada en UTC saldría al día siguiente, y
 * en una bandeja ordenada por antigüedad eso se lee como un error del
 * sistema.
 */
function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

/**
 * Cuánto texto de cada campo viaja a la bandeja.
 *
 * ⚠️ No es un capricho de payload: 300 peticiones × 5 campos × 4 000
 * caracteres son megabytes de JSON hacia un teléfono en el piso clínico.
 * Cuando algo se recorta, la tarjeta LO DICE y ofrece abrir la nota
 * completa — un docente no puede firmar creyendo que leyó todo.
 */
const RESUMEN_MAX = 600;

function recorta(texto: string): { text: string; cut: boolean } {
  const t = texto.trim();
  if (t.length <= RESUMEN_MAX) return { text: t, cut: false };
  return { text: `${t.slice(0, RESUMEN_MAX)}…`, cut: true };
}

// ═══════════════════════════════════════════════════════════════════════
// LO QUE SE FIRMA: leer la fila apuntada, resumirla y resumirla en un hash
// ═══════════════════════════════════════════════════════════════════════

interface TargetInfo {
  /** null = la fila apuntada ya no existe. Cuenta como "cambió". */
  hash: string | null;
  summary: EduApprovalSummary;
  /** El paciente al que pertenece, para poder enlazar el expediente. */
  patientId: string | null;
}

const TARGET_FALTA: TargetInfo = {
  hash: null,
  summary: {
    title: "Ya no existe",
    lines: [
      {
        label: "Qué pasó",
        text: "Lo que se mandó a autorizar se borró o cambió de caso. Una firma sobre algo que ya no está no autoriza nada: pídela otra vez sobre lo que sí exista.",
      },
    ],
  },
  patientId: null,
};

const RECORD_TARGET_SELECT = {
  id: true,
  caseId: true,
  patientId: true,
  subjetivo: true,
  objetivo: true,
  analisis: true,
  plan: true,
  diagnostico: true,
  status: true,
  createdAt: true,
} satisfies Prisma.EduRecordSelect;

const APPOINTMENT_TARGET_SELECT = {
  id: true,
  caseId: true,
  patientId: true,
  startsAt: true,
  endsAt: true,
  chairId: true,
  type: true,
  chair: { select: { name: true, number: true } },
} satisfies Prisma.EduAppointmentSelect;

type RecordTarget = Prisma.EduRecordGetPayload<{ select: typeof RECORD_TARGET_SELECT }>;
type AppointmentTarget = Prisma.EduAppointmentGetPayload<{
  select: typeof APPOINTMENT_TARGET_SELECT;
}>;

function recordSnapshot(r: RecordTarget): EduApprovalSnapshot {
  return {
    kind: "EduRecord",
    subjetivo: r.subjetivo,
    objetivo: r.objetivo,
    analisis: r.analisis,
    plan: r.plan,
    diagnostico: r.diagnostico,
  };
}

function appointmentSnapshot(a: AppointmentTarget): EduApprovalSnapshot {
  return {
    kind: "EduAppointment",
    startsAtISO: a.startsAt.toISOString(),
    endsAtISO: a.endsAt.toISOString(),
    chairId: a.chairId,
    type: a.type,
  };
}

function recordSummary(r: RecordTarget): EduApprovalSummary {
  const lines: { label: string; text: string }[] = [];
  const campos: [keyof RecordTarget, string][] = [
    ["subjetivo", EDU_SOAP_LABELS.subjetivo],
    ["objetivo", EDU_SOAP_LABELS.objetivo],
    ["analisis", EDU_SOAP_LABELS.analisis],
    ["plan", EDU_SOAP_LABELS.plan],
  ];
  for (const [key, label] of campos) {
    const raw = r[key];
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const { text, cut } = recorta(raw);
    lines.push({ label, text: cut ? `${text} (recortado: ábrela para leerla completa)` : text });
  }
  if (lines.length === 0) {
    lines.push({
      label: "Ojo",
      text: "La nota está vacía. Firmar una nota en blanco autoriza exactamente nada: devuélvela pidiendo cambios.",
    });
  }
  return {
    title: r.diagnostico ? r.diagnostico.trim() : "Nota clínica sin diagnóstico escrito",
    lines,
  };
}

function appointmentSummary(a: AppointmentTarget, timeZone: string): EduApprovalSummary {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(a.startsAt, tz);
  const sillon = a.chair ? `${a.chair.name} (n.º ${a.chair.number})` : "Sillón dado de baja";
  return {
    title: `${eduFormatDayShort(dayISO)} · ${eduFormatTime(a.startsAt, tz)}–${eduFormatTime(a.endsAt, tz)}`,
    lines: [
      { label: "Sillón", text: sillon },
      {
        label: "Tipo",
        text: EDU_APPOINTMENT_TYPE_LABELS[a.type as keyof typeof EDU_APPOINTMENT_TYPE_LABELS] ?? a.type,
      },
      {
        label: "Ojo",
        text: "Si esta cita se reagenda o cambia de sillón, la firma deja de valer sola: ya no es la misma sesión.",
      },
    ],
  };
}

function claveTarget(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/**
 * Lee de golpe TODAS las filas apuntadas y devuelve su hash y su resumen.
 *
 * Dos consultas como mucho, sean 3 peticiones o 300: una por tabla apuntada.
 * Leer el objetivo de cada autorización dentro del bucle sería el N+1 de
 * manual, y la bandeja es una pantalla que se recarga cada vez que el
 * docente firma algo.
 *
 * 🔴 Las dos consultas filtran por institutionId aunque el id sea un cuid
 * imposible de adivinar: un `targetId` de otra escuela no puede resolver
 * NUNCA, ni siquiera para pintar un resumen.
 */
async function loadTargets(
  db: EduDb,
  institutionId: string,
  refs: { targetType: string; targetId: string }[],
  timeZone: string,
  /**
   * El GATE corre DENTRO de la transacción que mueve un caso y solo necesita
   * el hash. Armar los resúmenes ahí sería formatear fechas con Intl con una
   * transacción abierta, para tirar el resultado en la línea siguiente.
   */
  conResumen = true,
): Promise<Map<string, TargetInfo>> {
  const recordIds = new Set<string>();
  const apptIds = new Set<string>();
  for (const r of refs) {
    if (r.targetType === "EduRecord") recordIds.add(r.targetId);
    else if (r.targetType === "EduAppointment") apptIds.add(r.targetId);
  }

  const [records, appts] = await Promise.all([
    recordIds.size > 0
      ? db.eduRecord.findMany({
          where: { institutionId, id: { in: Array.from(recordIds) } },
          select: RECORD_TARGET_SELECT,
        })
      : Promise.resolve([] as RecordTarget[]),
    apptIds.size > 0
      ? db.eduAppointment.findMany({
          where: { institutionId, id: { in: Array.from(apptIds) } },
          select: APPOINTMENT_TARGET_SELECT,
        })
      : Promise.resolve([] as AppointmentTarget[]),
  ]);

  const SIN_RESUMEN: EduApprovalSummary = { title: "", lines: [] };

  const out = new Map<string, TargetInfo>();
  for (const r of records) {
    out.set(claveTarget("EduRecord", r.id), {
      hash: eduApprovalHash(recordSnapshot(r)),
      summary: conResumen ? recordSummary(r) : SIN_RESUMEN,
      patientId: r.patientId,
    });
  }
  for (const a of appts) {
    out.set(claveTarget("EduAppointment", a.id), {
      hash: eduApprovalHash(appointmentSnapshot(a)),
      summary: conResumen ? appointmentSummary(a, timeZone) : SIN_RESUMEN,
      patientId: a.patientId,
    });
  }
  return out;
}

/** Solo los hashes: lo que necesita el GATE, sin armar resúmenes. */
async function loadTargetHashes(
  db: EduDb,
  institutionId: string,
  refs: { targetType: string; targetId: string }[],
): Promise<Map<string, string | null>> {
  const info = await loadTargets(db, institutionId, refs, "UTC", false);
  const out = new Map<string, string | null>();
  for (const r of refs) {
    const k = claveTarget(r.targetType, r.targetId);
    out.set(k, info.get(k)?.hash ?? null);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

const APPROVAL_SELECT = {
  id: true,
  stage: true,
  status: true,
  targetType: true,
  targetId: true,
  contentHash: true,
  requestedAt: true,
  decidedAt: true,
  decisionNote: true,
  isEmergency: true,
  emergencyReason: true,
  caseId: true,
  requestedById: true,
  case: {
    select: {
      id: true,
      status: true,
      program: { select: { name: true } },
      patient: { select: { id: true, folio: true, firstName: true, lastName: true } },
      student: {
        select: {
          id: true,
          matricula: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
  requestedBy: { select: { firstName: true, lastName: true, email: true } },
  decidedBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduCaseApprovalSelect;

type ApprovalPayload = Prisma.EduCaseApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

function toRow(
  a: ApprovalPayload,
  target: TargetInfo,
  timeZone: string,
  now: Date,
  viewerUserId: string,
): EduApprovalRow {
  const contentChanged = eduApprovalContentChanged(
    { status: a.status, contentHash: a.contentHash, isEmergency: a.isEmergency },
    target.hash,
  );
  const status = eduApprovalEffectiveStatus(
    { status: a.status, contentHash: a.contentHash, isEmergency: a.isEmergency },
    target.hash,
  );
  const waitedMinutes = eduApprovalWaitedMinutes(a.requestedAt, now);

  // 🔴 "La mandaste tú" se decide con el id de la SESIÓN, no con un campo del
  // cliente: es lo que saca del lote las peticiones que uno mismo escribió.
  const propia = a.requestedById === viewerUserId;

  return {
    id: a.id,
    stage: a.stage,
    stageLabel: EDU_APPROVAL_STAGE_LABELS[a.stage],
    status,
    storedStatus: a.status,
    targetType: a.targetType as EduApprovalTarget,
    targetId: a.targetId,

    caseId: a.caseId,
    programName: a.case.program.name,
    caseStatusLabel: EDU_CASE_STATUS_LABELS[a.case.status] ?? a.case.status,

    patientId: a.case.patient.id,
    patientName:
      [a.case.patient.firstName, a.case.patient.lastName].filter(Boolean).join(" ").trim() ||
      "Sin nombre",
    patientFolio: a.case.patient.folio,

    studentId: a.case.student.id,
    studentName: personName(a.case.student.user),
    studentMatricula: a.case.student.matricula,

    requestedByName: personName(a.requestedBy),
    requestedAt: a.requestedAt.toISOString(),
    requestedAtLabel: stampLabel(a.requestedAt, timeZone),
    waitedMinutes,
    waitedLabel: eduApprovalWaitedLabel(waitedMinutes),
    waitSeverity: eduApprovalWaitSeverity(waitedMinutes),

    decidedByName: a.decidedBy ? personName(a.decidedBy) : null,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    decidedAtLabel: a.decidedAt ? stampLabel(a.decidedAt, timeZone) : null,
    decisionNote: a.decisionNote,

    isEmergency: a.isEmergency,
    emergencyReason: a.emergencyReason,

    contentChanged,
    batchSkip: propia
      ? "propia"
      : eduApprovalBatchSkipReason({ status, isEmergency: a.isEmergency, contentChanged }),

    summary: target.summary,
  };
}

/**
 * Persiste las que vencieron solas.
 *
 * ⚠️ Se escribe desde una LECTURA a propósito, y con `updateMany` acotado a
 * `status: "APPROVED"`: si dos pantallas lo hacen a la vez, la segunda no
 * encuentra nada que actualizar en vez de pisar una decisión nueva. Sin esta
 * escritura, "vencida" solo existiría en la pantalla que la calculó — y la
 * bandeja de al lado seguiría diciendo "autorizado" sobre un texto que ya
 * cambió.
 */
async function persistExpired(
  db: EduDb,
  institutionId: string,
  rows: { id: string; storedStatus: string; status: string }[],
): Promise<void> {
  const ids = rows
    .filter((r) => r.storedStatus === "APPROVED" && r.status === "EXPIRED")
    .map((r) => r.id);
  if (ids.length === 0) return;
  await db.eduCaseApproval.updateMany({
    where: { institutionId, id: { in: ids }, status: "APPROVED" },
    data: { status: "EXPIRED" },
  });
}

export interface EduApprovalInboxPage {
  rows: EduApprovalRow[];
  truncated: boolean;
}

/**
 * LA BANDEJA: todo lo que está esperando firma y le toca a quien pregunta.
 *
 * Orden: las URGENCIAS primero y después por orden de llegada. Es el mismo
 * orden que usa el índice `edu_case_approvals_bandeja_idx`.
 */
export async function listEduApprovalInbox(
  ctx: EduClinicaContext,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduApprovalInboxPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const found = await prisma.eduCaseApproval.findMany({
    where: {
      institutionId,
      status: "PENDING",
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    orderBy: [{ isEmergency: "desc" }, { requestedAt: "asc" }],
    take: EDU_APPROVAL_MAX_ROWS + 1,
    select: APPROVAL_SELECT,
  });

  const page = found.slice(0, EDU_APPROVAL_MAX_ROWS);
  const targets = await loadTargets(prisma, institutionId, page, timeZone);
  const rows = page.map((a) =>
    toRow(a, targets.get(claveTarget(a.targetType, a.targetId)) ?? TARGET_FALTA, timeZone, now, ctx.eduUserId),
  );

  return { rows, truncated: found.length > EDU_APPROVAL_MAX_ROWS };
}

export interface EduCaseApprovalState {
  rows: EduApprovalRow[];
  /** El veredicto de las DOS puertas del caso, ya resuelto. */
  gates: { stage: EduApprovalStage; verdict: EduGateVerdict }[];
}

/**
 * Todo lo que se ha pedido en ESTE caso, y en qué van sus dos puertas.
 *
 * Es lo que se pinta en la ficha: el estado de autorización, quién firmó, qué
 * exactamente y a qué hora. No hay un historial aparte — estas filas SON el
 * historial, que es justo por lo que un reenvío crea una nueva en vez de
 * reescribir la anterior.
 */
export async function getEduCaseApprovalState(
  ctx: EduClinicaContext,
  caseId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduCaseApprovalState> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return { rows: [], gates: [] };
  const id = eduCleanId(caseId);
  if (!id) return { rows: [], gates: [] };

  const found = await prisma.eduCaseApproval.findMany({
    where: {
      institutionId,
      caseId: id,
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    orderBy: [{ requestedAt: "desc" }],
    take: EDU_APPROVAL_MAX_ROWS,
    select: APPROVAL_SELECT,
  });

  const targets = await loadTargets(prisma, institutionId, found, timeZone);
  const rows = found.map((a) =>
    toRow(a, targets.get(claveTarget(a.targetType, a.targetId)) ?? TARGET_FALTA, timeZone, now, ctx.eduUserId),
  );
  await persistExpired(prisma, institutionId, rows);

  // Las DOS puertas del caso. Se juzgan con `r.status`, que en `toRow` ya es
  // el estado EFECTIVO (el hash comprobado contra el contenido de hoy): pasar
  // aquí el de la columna haría que una firma vencida siguiera abriendo, y la
  // ficha diría "autorizado" de algo que el gate rechaza tres líneas después.
  const gates = (["PLAN", "DISCHARGE"] as EduApprovalStage[]).map((stage) => ({
    stage,
    verdict: eduCaseGateVerdict(
      stage,
      rows
        .filter((r) => r.stage === stage)
        .map((r) => ({ status: r.status, isEmergency: r.isEmergency })),
    ),
  }));

  return { rows, gates };
}

// ═══════════════════════════════════════════════════════════════════════
// EL GATE
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 ¿PUEDE ESTE CASO AVANZAR A ESTE ESTADO?
 *
 * Es la función que convierte todo lo anterior en un gate de verdad. La llama
 * `updateEduCase` (src/lib/edu/casos.ts) DENTRO de su transacción: cualquier
 * camino que mueva un caso pasa por ahí, así que no hay un segundo endpoint
 * por el que colarse.
 *
 * Devuelve un veredicto en vez de lanzar para que el llamador decida el
 * status HTTP y para poder pintar el mismo texto en la ficha ANTES de que
 * nadie intente nada — el mensaje que explica qué falta es la mitad del
 * producto.
 *
 * ⚠️ No comprueba permisos ni alcance: el caso ya se buscó dentro del alcance
 * antes de llegar aquí. Duplicar el recorte solo daría un segundo sitio donde
 * equivocarse.
 */
export async function eduCaseGateCheck(
  db: EduDb,
  institutionId: string,
  caseId: string,
  to: EduCaseStatus,
): Promise<EduGateVerdict> {
  const stage = eduApprovalStageForCaseStatus(to);
  if (!stage) {
    return { ok: true, viaEmergency: false, detail: "Ese cambio de estado no necesita firma." };
  }

  const filas = await db.eduCaseApproval.findMany({
    where: { institutionId, caseId, stage },
    select: {
      id: true,
      status: true,
      contentHash: true,
      isEmergency: true,
      targetType: true,
      targetId: true,
    },
  });
  if (filas.length === 0) return eduCaseGateVerdict(stage, []);

  const hashes = await loadTargetHashes(db, institutionId, filas);

  const efectivas = filas.map((f) => ({
    id: f.id,
    stored: f.status,
    status: eduApprovalEffectiveStatus(
      { status: f.status, contentHash: f.contentHash, isEmergency: f.isEmergency },
      hashes.get(claveTarget(f.targetType, f.targetId)) ?? null,
    ),
    contentHash: f.contentHash,
    isEmergency: f.isEmergency,
  }));

  // Se marcan las que vencieron.
  //
  // ⚠️ Esto corre DENTRO de la transacción que mueve el caso, así que cuando
  // el veredicto es "no", el `throw` del llamador se lleva también esta
  // escritura. Es aceptable y no rompe nada: el estado efectivo se RECALCULA
  // en cada lectura (`eduApprovalEffectiveStatus`), así que la columna es una
  // caché, no la verdad. La ficha del caso la persiste por su cuenta, fuera
  // de transacción, la próxima vez que alguien la abra. Lo que NUNCA depende
  // de esa columna es el gate: aquí se vuelve a comparar el hash siempre.
  await persistExpired(
    db,
    institutionId,
    efectivas.map((e) => ({ id: e.id, storedStatus: e.stored, status: e.status })),
  );

  return eduCaseGateVerdict(stage, efectivas);
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

function textoObligatorio(raw: unknown, min: number, max: number, queFalta: string): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < min) throw new EduPadronError(queFalta);
  return v.slice(0, max);
}

/** El caso, buscado DENTRO del alcance. Uno que no toca se ve como uno que no existe. */
async function resolveCase(
  ctx: EduClinicaContext,
  institutionId: string,
  rawCaseId: unknown,
  now: Date,
): Promise<{ id: string; studentId: string; patientId: string }> {
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no manda actos clínicos a autorización.", 403);
  }
  const id = eduCleanId(rawCaseId);
  const caso = id
    ? await prisma.eduCase.findFirst({
        where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id },
        select: { id: true, studentId: true, patientId: true },
      })
    : null;
  if (!caso) throw new EduPadronError("Ese caso no existe o no te toca.", 404);
  return caso;
}

export interface EduApprovalRequestInput {
  caseId?: unknown;
  stage?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  isEmergency?: unknown;
  emergencyReason?: unknown;
}

/**
 * PEDIR AUTORIZACIÓN. Es el "Enviar a autorización" del alumno.
 *
 * 🔴 SIN HISTORIAL APARTE: si ya había una PENDING sobre la MISMA fila, se
 * cierra como CHANGES_REQUESTED y se crea una NUEVA. Las filas son el
 * historial. Reescribir la anterior borraría a qué hora se pidió la primera
 * vez, que es media respuesta a "¿por qué este paciente esperó dos horas?".
 *
 * ⚠️ La anterior queda sin `decidedById` a propósito: nadie la decidió, la
 * sustituyó un reenvío. La nota lo dice con todas sus letras en vez de
 * atribuirle a un docente una decisión que no tomó.
 */
export async function requestEduApproval(
  ctx: EduClinicaContext,
  input: EduApprovalRequestInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const stage = parseEduApprovalStage(input.stage);
  if (!stage) throw new EduPadronError("Elige qué le estás mandando a autorizar.");

  // El tipo lo DECIDE la etapa. Si el cliente manda uno, tiene que coincidir:
  // aceptar el suyo dejaría que un PLAN apuntara a una cita y el gate del
  // caso buscaría firmas donde no hay contenido clínico que firmar.
  const esperado = eduApprovalTargetForStage(stage);
  if (input.targetType !== undefined && input.targetType !== null && input.targetType !== "") {
    const pedido = parseEduApprovalTarget(input.targetType);
    if (pedido !== esperado) {
      throw new EduPadronError(
        `Para ${EDU_APPROVAL_STAGE_LABELS[stage].toLowerCase()} hay que mandar ${
          esperado === "EduRecord" ? "una nota clínica" : "una cita"
        }.`,
      );
    }
  }

  const caso = await resolveCase(ctx, institutionId, input.caseId, now);
  const targetId = eduCleanId(input.targetId);
  if (!targetId) throw new EduPadronError("Elige qué exactamente mandas a autorizar.");

  // 🔴 La fila apuntada tiene que ser DE ESTE CASO. Sin esta comprobación, un
  // alumno podría colgar del caso de su paciente una nota del caso de otro
  // —una que él sí puede ver— y el docente firmaría sobre el expediente
  // equivocado sin que nada se viera raro.
  let snapshot: EduApprovalSnapshot;
  if (esperado === "EduRecord") {
    const nota = await prisma.eduRecord.findFirst({
      where: { id: targetId, institutionId, caseId: caso.id },
      select: RECORD_TARGET_SELECT,
    });
    if (!nota) throw new EduPadronError("Esa nota no es de este caso.", 404);
    snapshot = recordSnapshot(nota);
  } else {
    const cita = await prisma.eduAppointment.findFirst({
      where: { id: targetId, institutionId, caseId: caso.id },
      select: APPOINTMENT_TARGET_SELECT,
    });
    if (!cita) {
      throw new EduPadronError(
        "Esa cita no está enganchada a este caso. Engánchala primero desde la agenda.",
        404,
      );
    }
    snapshot = appointmentSnapshot(cita);
  }

  const isEmergency = input.isEmergency === true || input.isEmergency === "true";
  let emergencyReason: string | null = null;
  if (isEmergency) {
    // No se le impide proceder: se le pide que escriba por qué. Un motivo de
    // dos letras es la casilla que se llena para saltarse el trámite.
    emergencyReason = textoObligatorio(
      input.emergencyReason,
      EDU_APPROVAL_EMERGENCY_REASON_MIN,
      EDU_APPROVAL_EMERGENCY_REASON_MAX,
      "Escribe por qué es urgente. No se te va a impedir seguir: queda escrito, y eso es lo que protege al paciente y a ti.",
    );
  }

  const contentHash = eduApprovalHash(snapshot);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // El índice único PARCIAL de la base (una PENDING por fila apuntada) se
      // satisface porque esto sale del índice ANTES del insert.
      await tx.eduCaseApproval.updateMany({
        where: { institutionId, targetType: esperado, targetId, status: "PENDING" },
        data: {
          status: "CHANGES_REQUESTED",
          decidedAt: now,
          decisionNote: "Sustituida por un reenvío. No la decidió nadie.",
        },
      });

      return tx.eduCaseApproval.create({
        data: {
          institutionId,
          caseId: caso.id,
          stage,
          targetType: esperado,
          targetId,
          contentHash,
          status: "PENDING",
          // 🔴 De la SESIÓN, jamás del body: quién pide es media firma.
          requestedById: ctx.eduUserId,
          requestedAt: now,
          isEmergency,
          emergencyReason,
        },
        select: { id: true },
      });
    });
    return created;
  } catch (err) {
    // P2002 = el índice único parcial. Solo puede pasar si otra petición
    // idéntica entró en el mismo milisegundo; se contesta con algo legible en
    // vez de un 500.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new EduPadronError(
        "Eso ya está esperando firma. Refresca la pantalla: probablemente lo mandaste dos veces.",
        409,
      );
    }
    throw err;
  }
}

export interface EduApprovalDecisionInput {
  decision?: unknown;
  note?: unknown;
  /** El trazo de la firma, si la escuela lo captura. Path de Storage. */
  signatureUrl?: unknown;
  /** De la PETICIÓN HTTP, nunca del body. */
  ip?: string | null;
  userAgent?: string | null;
}

/** Lo que se escribe al decidir, compartido por la decisión suelta y el lote. */
function datosDeDecision(
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED",
  ctx: EduClinicaContext,
  now: Date,
  extra: { note: string | null; hash?: string; ip?: string | null; userAgent?: string | null; signatureUrl?: string | null },
): Prisma.EduCaseApprovalUncheckedUpdateInput {
  const data: Prisma.EduCaseApprovalUncheckedUpdateInput = {
    status: decision,
    decidedById: ctx.eduUserId,
    decidedAt: now,
    decisionNote: extra.note,
  };
  if (decision === "APPROVED") {
    // 🔴 EL HASH SE VUELVE A CALCULAR AQUÍ, sobre lo que el docente tiene
    // delante — no se copia el de la petición. Si el alumno editó entre que
    // la mandó y que se firmó, lo que queda autorizado es lo que se leyó.
    if (extra.hash) data.contentHash = extra.hash;
    data.signedIp = extra.ip ?? null;
    data.signedUserAgent = extra.userAgent ?? null;
    if (extra.signatureUrl !== undefined) data.signatureUrl = extra.signatureUrl;
  }
  return data;
}

/**
 * DECIDIR una autorización: autorizar, pedir cambios o rechazar.
 *
 * Las tres cosas que comprueba y que un permiso no puede saber:
 *  1. que la fila le TOQUE a quien decide (alcance de "cases": un docente que
 *     ya rotó no firma lo de los alumnos que entregó);
 *  2. que siga PENDIENTE — dos docentes mirando la misma bandeja es el caso
 *     normal, no el raro;
 *  3. que no la haya pedido él mismo.
 */
export async function decideEduApproval(
  ctx: EduClinicaContext,
  approvalId: string,
  input: EduApprovalDecisionInput,
  now: Date = new Date(),
): Promise<{ id: string; status: string }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Esa autorización no existe o no te toca.", 404);
  }
  const id = eduCleanId(approvalId);
  if (!id) throw new EduPadronError("Esa autorización no existe o no te toca.", 404);

  const decision = parseEduApprovalDecision(input.decision);
  if (!decision) throw new EduPadronError("Esa decisión no existe.");

  const actual = await prisma.eduCaseApproval.findFirst({
    where: {
      institutionId,
      id,
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      status: true,
      targetType: true,
      targetId: true,
      requestedById: true,
      isEmergency: true,
    },
  });
  if (!actual) throw new EduPadronError("Esa autorización no existe o no te toca.", 404);

  if (actual.status !== "PENDING") {
    throw new EduPadronError(
      "Esa autorización ya la decidió alguien. Refresca la bandeja para ver en qué quedó.",
      409,
    );
  }

  // 🔴 NADIE FIRMA SU PROPIA PETICIÓN. No hay excepción para la dirección: la
  // separación de funciones no es un permiso que se pueda encender.
  //
  // ⚠️ El caso que hay que saber desatorar, y por eso el mensaje lo dice: si
  // la dirección manda algo de un alumno que NO tiene supervisor vigente, no
  // hay nadie más con alcance sobre ese alumno y la petición se queda sin
  // quien la firme. La salida no es aflojar esta regla — es asignarle
  // supervisor al alumno, que es lo que le faltaba de todos modos.
  if (actual.requestedById === ctx.eduUserId) {
    throw new EduPadronError(
      "No puedes decidir lo que tú mismo mandaste: una firma sobre la propia petición no es una firma. Que la revise el docente que supervisa a ese alumno; si no tiene supervisor vigente, asígnaselo desde Docentes y él la firma.",
      409,
    );
  }

  let note: string | null = null;
  if (eduApprovalDecisionNeedsNote(decision)) {
    note = textoObligatorio(
      input.note,
      EDU_APPROVAL_NOTE_MIN,
      EDU_APPROVAL_NOTE_MAX,
      decision === "CHANGES_REQUESTED"
        ? "Escribe QUÉ hay que cambiar. Devolverlo sin decir qué es devolverlo dos veces."
        : "Escribe por qué lo rechazas. El alumno tiene que poder aprender algo de esto.",
    );
  } else if (typeof input.note === "string" && input.note.trim().length > 0) {
    note = input.note.trim().slice(0, EDU_APPROVAL_NOTE_MAX);
  }

  let hash: string | undefined;
  if (decision === "APPROVED") {
    // 🔴 El hash se lee AHORA, no se copia el de la petición: lo que queda
    // autorizado tiene que ser lo que el docente tuvo delante.
    const hashes = await loadTargetHashes(prisma, institutionId, [actual]);
    const h = hashes.get(claveTarget(actual.targetType, actual.targetId)) ?? null;
    if (!h) {
      throw new EduPadronError(
        "Lo que ibas a autorizar ya no existe: se borró o cambió de caso. No se puede firmar algo que no está.",
        409,
      );
    }
    hash = h;
  }

  const signatureUrl =
    typeof input.signatureUrl === "string" && input.signatureUrl.trim().length > 0
      ? input.signatureUrl.trim()
      : undefined;

  await prisma.eduCaseApproval.update({
    where: { id: actual.id },
    data: datosDeDecision(decision, ctx, now, {
      note,
      hash,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      signatureUrl,
    }),
  });

  return { id: actual.id, status: decision };
}

export interface EduApprovalBatchResult {
  approved: number;
  skipped: { id: string; reason: EduApprovalBatchSkip }[];
}

/**
 * AUTORIZAR EN LOTE.
 *
 * 🔴 EXISTE PARA QUE EL GATE NO SE VUELVA UN SELLO DE GOMA, y por eso mismo
 * NO se traga todo. Un docente con quince alumnos recibe decenas de
 * peticiones al día: sin lote firma sin leer en dos semanas. Pero si el lote
 * se llevara justo lo que hay que leer, el sello de goma lo habríamos
 * construido nosotros.
 *
 * Se quedan FUERA y se devuelven con su motivo:
 *  · las URGENCIAS — son las únicas que YA ocurrieron sin firma;
 *  · las que el alumno editó después de mandarlas;
 *  · las que él mismo pidió;
 *  · las que dejaron de estar pendientes mientras miraba la lista.
 *
 * Solo autoriza. Pedir cambios y rechazar llevan motivo escrito y van una por
 * una: un "no" en lote es un "no" que nadie explicó.
 */
export async function decideEduApprovalBatch(
  ctx: EduClinicaContext,
  ids: unknown,
  input: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<EduApprovalBatchResult> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no firma autorizaciones.", 403);
  }

  const limpios = Array.isArray(ids)
    ? Array.from(new Set(ids.map((x) => eduCleanId(x)).filter((x): x is string => Boolean(x))))
    : [];
  if (limpios.length === 0) throw new EduPadronError("No marcaste ninguna.");
  if (limpios.length > EDU_APPROVAL_BATCH_MAX) {
    throw new EduPadronError(
      `De ${EDU_APPROVAL_BATCH_MAX} en ${EDU_APPROVAL_BATCH_MAX} como mucho. Firmar doscientas de un botonazo no es una decisión.`,
    );
  }

  const filas = await prisma.eduCaseApproval.findMany({
    where: {
      institutionId,
      id: { in: limpios },
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      status: true,
      contentHash: true,
      isEmergency: true,
      targetType: true,
      targetId: true,
      requestedById: true,
    },
  });

  const hashes = await loadTargetHashes(prisma, institutionId, filas);
  const skipped: { id: string; reason: EduApprovalBatchSkip }[] = [];
  const aprobables: { id: string; hash: string }[] = [];

  // Las que ni siquiera aparecieron (otra escuela, otro docente, id
  // inventado) se reportan como "ya no está esperando firma": desde fuera se
  // ven igual que una que acaban de decidir, y confirmar cuáles existen sería
  // decirle a alguien qué hay en la bandeja de otro.
  const vistas = new Set(filas.map((f) => f.id));
  for (const id of limpios) {
    if (!vistas.has(id)) skipped.push({ id, reason: "no-pendiente" });
  }

  for (const f of filas) {
    const h = hashes.get(claveTarget(f.targetType, f.targetId)) ?? null;
    const contentChanged = eduApprovalContentChanged(f, h);
    const status = eduApprovalEffectiveStatus(f, h);

    if (f.requestedById === ctx.eduUserId) {
      skipped.push({ id: f.id, reason: "propia" });
      continue;
    }
    const razon = eduApprovalBatchSkipReason({
      status,
      isEmergency: f.isEmergency,
      contentChanged,
    });
    if (razon) {
      skipped.push({ id: f.id, reason: razon });
      continue;
    }
    // `contentChanged` es false, así que este hash existe; el `?? ""` solo
    // calla al compilador.
    aprobables.push({ id: f.id, hash: h ?? "" });
  }

  if (aprobables.length > 0) {
    await prisma.$transaction(
      aprobables.map((a) =>
        prisma.eduCaseApproval.update({
          // El `status: "PENDING"` del where no se puede poner en un
          // `update` de Prisma, así que la carrera se cierra con la
          // comprobación de arriba; la ventana es de milisegundos y lo peor
          // que pasa es que se re-firme algo ya firmado con el mismo
          // contenido.
          where: { id: a.id },
          data: datosDeDecision("APPROVED", ctx, now, {
            note: null,
            hash: a.hash,
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          }),
        }),
      ),
    );
  }

  return { approved: aprobables.length, skipped };
}

// ═══════════════════════════════════════════════════════════════════════
// LO QUE SE PUEDE MANDAR A AUTORIZAR (para el desplegable del alumno)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las notas y las citas de un caso, en la forma mínima del desplegable.
 *
 * Se reusa el MISMO recorte que todo lo demás para que no exista una opción
 * que aparece en la lista y luego el POST rechaza.
 */
export async function listEduApprovalTargets(
  ctx: EduClinicaContext,
  caseId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ records: EduApprovalTargetOption[]; appointments: EduApprovalTargetOption[] }> {
  const institutionId = requireInstitution(ctx);
  const caso = await resolveCase(ctx, institutionId, caseId, now);
  const tz = eduSafeTimeZone(timeZone);

  const [notas, citas] = await Promise.all([
    prisma.eduRecord.findMany({
      where: { institutionId, caseId: caso.id },
      orderBy: [{ createdAt: "desc" }],
      take: 30,
      select: RECORD_TARGET_SELECT,
    }),
    prisma.eduAppointment.findMany({
      where: { institutionId, caseId: caso.id },
      orderBy: [{ startsAt: "desc" }],
      take: 30,
      select: APPOINTMENT_TARGET_SELECT,
    }),
  ]);

  return {
    records: notas.map((n) => ({
      id: n.id,
      kind: "EduRecord" as const,
      label: n.diagnostico ? n.diagnostico.trim() : "Nota sin diagnóstico",
      detail: `${stampLabel(n.createdAt, tz)} · ${n.status.toLowerCase()}`,
    })),
    appointments: citas.map((c) => ({
      id: c.id,
      kind: "EduAppointment" as const,
      label: `${eduFormatDayShort(eduUtcToZoned(c.startsAt, tz).dayISO)} ${eduFormatTime(c.startsAt, tz)}`,
      detail: c.chair ? `${c.chair.name} (n.º ${c.chair.number})` : "Sillón dado de baja",
    })),
  };
}
