/**
 * DaleControl INSTITUCIONAL — las NOTAS CLÍNICAS contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". Lo
 * puro y compartible vive en expediente-core.ts; aquí solo hay consultas.
 *
 * 🔴 LAS TRES REGLAS DE ORO DE ESTE ARCHIVO
 *
 * 1. TODA función recibe el contexto de sesión y saca de ahí el
 *    institutionId. Ninguna lo acepta suelto, ninguna lo lee de un body.
 *
 * 2. NINGUNA lectura arma su propio recorte: el alcance sale de
 *    `eduClinicalScope` (expediente-core.ts), que es el del recurso
 *    "cases". Para CAJA eso es "none" y el `where` no devuelve una sola
 *    fila — ni con `expediente.view` encendido a mano.
 *
 * 3. NOM-004, y es la que gobierna todo lo demás:
 *      · el AUTOR de una nota es siempre identificable y sale de la SESIÓN;
 *      · el PACIENTE y el ALUMNO salen del CASO, nunca del body: si
 *        vinieran del cliente, se podría escribir una nota en el
 *        expediente de una persona atribuyéndosela a otra;
 *      · una nota FIRMADA no se edita. Se corrige con una nota NUEVA que
 *        la referencia.
 *
 * Las escrituras NO comprueban permisos: eso lo hace el endpoint con
 * assertEduPermission antes de llamar. Aquí se comprueba la PERTENENCIA,
 * que es lo que un permiso no puede saber.
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
  EDU_RECORD_DIAGNOSIS_MAX,
  EDU_RECORD_MAX_ROWS,
  EDU_RECORD_TEXT_MAX,
  eduClinicalScope,
  eduRecordCanTransition,
  eduRecordHasContent,
  eduRecordIsEditable,
  eduRecordStamps,
  eduRecordText,
  parseEduRecordStatus,
  type EduCaseOption,
  type EduRecordRow,
} from "@/lib/edu/expediente-core";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { EDU_CASE_CLOSED_STATUSES, EDU_ROLE_LABELS, type EduRecordStatus } from "@/lib/edu/types";

export { EduPadronError as EduExpedienteError };
export type { EduRecordRow, EduCaseOption } from "@/lib/edu/expediente-core";

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
 * Sello de tiempo legible EN LA ZONA DEL INSTITUTO ("mar 1 sep 14:30").
 *
 * 🔴 `createdAt` es un INSTANTE, no una fecha de calendario, así que aquí
 * NO se usa `formatEduDate` (que formatea en UTC a propósito, para los
 * cumpleaños y los contratos). Pintar un instante en UTC en una escuela de
 * Tijuana pondría una nota de las 19:00 en el día siguiente.
 */
function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

const RECORD_SELECT = {
  id: true,
  status: true,
  subjetivo: true,
  objetivo: true,
  analisis: true,
  plan: true,
  diagnostico: true,
  submittedAt: true,
  signedAt: true,
  correctsId: true,
  createdAt: true,
  updatedAt: true,
  caseId: true,
  patientId: true,
  appointmentId: true,
  studentId: true,
  authorUserId: true,
  case: { select: { program: { select: { name: true } } } },
  student: { select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } } },
  author: { select: { firstName: true, lastName: true, email: true, role: true } },
  signedBy: { select: { firstName: true, lastName: true, email: true } },
  appointment: { select: { id: true, startsAt: true } },
  _count: { select: { correctedBy: true } },
} satisfies Prisma.EduRecordSelect;

type RecordPayload = Prisma.EduRecordGetPayload<{ select: typeof RECORD_SELECT }>;

function toRow(r: RecordPayload, timeZone: string): EduRecordRow {
  const tz = eduSafeTimeZone(timeZone);
  return {
    id: r.id,
    status: r.status,

    subjetivo: r.subjetivo,
    objetivo: r.objetivo,
    analisis: r.analisis,
    plan: r.plan,
    diagnostico: r.diagnostico,

    caseId: r.caseId,
    caseProgramName: r.case.program.name,
    patientId: r.patientId,

    studentId: r.studentId,
    studentName: personName(r.student.user),
    studentMatricula: r.student.matricula,

    authorUserId: r.authorUserId,
    authorName: personName(r.author),
    authorRoleLabel: EDU_ROLE_LABELS[r.author.role] ?? r.author.role,

    appointmentId: r.appointmentId,
    appointmentDayISO: r.appointment ? eduUtcToZoned(r.appointment.startsAt, tz).dayISO : null,
    appointmentLabel: r.appointment ? stampLabel(r.appointment.startsAt, tz) : null,

    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
    signedByName: r.signedBy ? personName(r.signedBy) : null,

    correctsId: r.correctsId,
    correctionsCount: r._count.correctedBy,

    createdAt: r.createdAt.toISOString(),
    createdLabel: stampLabel(r.createdAt, tz),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿Puede esta persona abrir el expediente de este paciente?
 *
 * Devuelve el paciente o null. El id de la URL NO basta: la fila se busca
 * con el `where` del alcance CLÍNICO, así que un paciente de otra escuela
 * —o de otro alumno, o cualquiera si quien pregunta es caja— se ve
 * exactamente igual que uno que no existe. Es lo que debe pasar: un 403
 * confirmaría que ese folio existe.
 *
 * Lo usan los TRES módulos de esta ola (notas, odontograma y estudios): es
 * la única puerta del expediente.
 */
export async function getEduClinicalPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<{ id: string; folio: string; firstName: string; lastName: string } | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;

  return prisma.eduPatient.findFirst({
    // 🔴 `eduPatientScopeWhere` con el alcance de "cases", no con el de
    // "patients". Para caja, "patients" es `all` y "cases" es `none`: con
    // el alcance equivocado, caja abriría el expediente de toda la escuela.
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, folio: true, firstName: true, lastName: true },
  });
}

/**
 * Las notas de un paciente, más recientes primero.
 *
 * El recorte cuelga del CASO (`case: {…}`) y no del paciente: un alumno que
 * lleva la endodoncia de esta señora NO lee las notas de su ortodoncia, que
 * son de otro alumno y de otro docente. Que pueda abrir la ficha del
 * paciente no le da su expediente completo.
 */
export async function listEduPatientRecords(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  options: { caseId?: string | null } = {},
  now: Date = new Date(),
): Promise<EduRecordRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(patientId);
  if (!id) return [];

  const where: Prisma.EduRecordWhereInput = {
    institutionId,
    patientId: id,
    case: eduCaseScopeWhere({ institutionId, scope, now }),
  };
  const caseId = eduCleanId(options.caseId);
  if (caseId) where.caseId = caseId;

  const rows = await prisma.eduRecord.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: EDU_RECORD_MAX_ROWS,
    select: RECORD_SELECT,
  });
  return rows.map((r) => toRow(r, timeZone));
}

/**
 * Los casos de ESTE paciente que le tocan a quien pregunta, en la forma
 * mínima del `<select>` de "¿a qué caso va esta nota?".
 *
 * Se reusa el mismo recorte de las notas para que no exista un caso que
 * aparece en el desplegable y luego el POST rechaza.
 */
export async function listEduPatientCaseOptions(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<EduCaseOption[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(patientId);
  if (!id) return [];

  const rows = await prisma.eduCase.findMany({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), patientId: id },
    orderBy: [{ openedAt: "desc" }],
    take: 50,
    select: {
      id: true,
      status: true,
      program: { select: { name: true } },
      student: {
        select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    programName: c.program.name,
    studentName: personName(c.student.user),
    studentMatricula: c.student.matricula,
    isOpen: !(EDU_CASE_CLOSED_STATUSES as string[]).includes(c.status),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * El caso al que va la nota, comprobado DENTRO del alcance.
 *
 * Devuelve además su paciente y su alumno, que es de donde salen esas dos
 * columnas de la nota: si vinieran del body, se podría escribir una nota
 * en el expediente de una persona y atribuírsela a otra.
 */
async function resolveCase(
  institutionId: string,
  ctx: EduClinicaContext,
  rawCaseId: unknown,
  now: Date,
): Promise<{ id: string; patientId: string; studentId: string; status: string }> {
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no abre expedientes clínicos.", 403);
  }
  const caseId = eduCleanId(rawCaseId);
  const caso = caseId
    ? await prisma.eduCase.findFirst({
        where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id: caseId },
        select: { id: true, patientId: true, studentId: true, status: true },
      })
    : null;
  if (!caso) throw new EduPadronError("Ese caso no existe o no te toca.", 404);
  return caso;
}

export interface EduRecordInput {
  caseId?: unknown;
  appointmentId?: unknown;
  subjetivo?: unknown;
  objetivo?: unknown;
  analisis?: unknown;
  plan?: unknown;
  diagnostico?: unknown;
  /** La nota FIRMADA a la que ésta corrige. */
  correctsId?: unknown;
}

/**
 * Escribe una nota nueva. Nace SIEMPRE en BORRADOR.
 *
 * No se crea directamente firmada aunque quien escriba tenga todos los
 * permisos: firmar es un acto aparte, con su propia petición y su propio
 * sello de tiempo. Crear-y-firmar en un solo POST haría que un doble clic
 * dejara dos notas firmadas idénticas en un expediente que ya no se puede
 * editar.
 */
export async function createEduRecord(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduRecordInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const caso = await resolveCase(institutionId, ctx, input.caseId, now);

  // 🔴 El caso tiene que ser DE ESTE paciente, el de la URL.
  //
  // Sin esta línea, un POST a /pacientes/A/expediente con el `caseId` de un
  // caso de B —uno que quien escribe SÍ puede ver, así que el alcance no
  // dice nada— escribiría la nota en el expediente de B. No es una fuga de
  // datos: es peor, es una nota clínica en la persona equivocada. Y como
  // paciente y alumno se derivan del caso, la fila quedaría internamente
  // coherente y nadie la encontraría nunca.
  const esperado = eduCleanId(patientId);
  if (!esperado || caso.patientId !== esperado) {
    throw new EduPadronError("Ese caso no es de este paciente.", 404);
  }

  // La cita, si la nota documenta una sesión concreta. Tiene que ser del
  // MISMO paciente: una nota colgada de la cita de otra persona rompe la
  // línea de tiempo del expediente de los dos.
  let appointmentId: string | null = null;
  if (input.appointmentId !== undefined && input.appointmentId !== null && input.appointmentId !== "") {
    const id = eduCleanId(input.appointmentId);
    const cita = id
      ? await prisma.eduAppointment.findFirst({
          where: { id, institutionId, patientId: caso.patientId },
          select: { id: true },
        })
      : null;
    if (!cita) throw new EduPadronError("Esa cita no es de este paciente.", 404);
    appointmentId = cita.id;
  }

  // La nota a la que corrige. Solo se corrige lo FIRMADO: una nota en
  // borrador o entregada se arregla editándola, y encadenar correcciones a
  // borradores llenaría el expediente de versiones de algo que nunca se
  // cerró.
  let correctsId: string | null = null;
  if (input.correctsId !== undefined && input.correctsId !== null && input.correctsId !== "") {
    const id = eduCleanId(input.correctsId);
    const previa = id
      ? await prisma.eduRecord.findFirst({
          where: { id, institutionId, caseId: caso.id },
          select: { id: true, status: true },
        })
      : null;
    if (!previa) throw new EduPadronError("Esa nota no es de este caso.", 404);
    if (previa.status !== "FIRMADA") {
      throw new EduPadronError(
        "Solo se corrige una nota FIRMADA. Ésa todavía se puede editar directamente.",
      );
    }
    correctsId = previa.id;
  }

  const created = await prisma.eduRecord.create({
    data: {
      institutionId,
      caseId: caso.id,
      // 🔴 Del CASO, no del body.
      patientId: caso.patientId,
      studentId: caso.studentId,
      // 🔴 De la SESIÓN, no del body. NOM-004: el autor siempre
      // identificable, y siempre el de verdad.
      authorUserId: ctx.eduUserId,
      appointmentId,
      correctsId,
      status: "BORRADOR",
      subjetivo: eduRecordText(input.subjetivo, EDU_RECORD_TEXT_MAX) ?? null,
      objetivo: eduRecordText(input.objetivo, EDU_RECORD_TEXT_MAX) ?? null,
      analisis: eduRecordText(input.analisis, EDU_RECORD_TEXT_MAX) ?? null,
      plan: eduRecordText(input.plan, EDU_RECORD_TEXT_MAX) ?? null,
      diagnostico: eduRecordText(input.diagnostico, EDU_RECORD_DIAGNOSIS_MAX) ?? null,
    },
    select: { id: true },
  });

  return created;
}

/**
 * Edita el contenido de una nota y/o la mueve de estado.
 *
 * 🔴 LA REGLA DE LA NOM-004 SE APLICA AQUÍ Y NO EN EL ENDPOINT: una nota
 * FIRMADA rebota TODO —texto, diagnóstico, cita y estado— aunque quien lo
 * intente sea la dirección del instituto. No es un permiso que falte: es
 * que un expediente que se puede reescribir deja de ser un registro de lo
 * que pasó.
 *
 * El caso y el paciente de la nota NO se cambian nunca. Una nota escrita en
 * el caso equivocado se anula con una corrección, igual que en papel.
 */
export async function updateEduRecord(
  ctx: EduClinicaContext,
  recordId: string,
  input: EduRecordInput & { status?: unknown },
  now: Date = new Date(),
): Promise<{ id: string; status: EduRecordStatus }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  const id = eduCleanId(recordId);
  if (!id) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  // Se busca DENTRO del alcance: una nota que no le toca a quien pregunta
  // se ve igual que una que no existe.
  const actual = await prisma.eduRecord.findFirst({
    where: {
      institutionId,
      id,
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      status: true,
      caseId: true,
      patientId: true,
      submittedAt: true,
      subjetivo: true,
      objetivo: true,
      analisis: true,
      plan: true,
      diagnostico: true,
    },
  });
  if (!actual) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  if (!eduRecordIsEditable(actual.status)) {
    throw new EduPadronError(
      "Esa nota está FIRMADA y no se modifica. Si hay algo que corregir, escribe una nota nueva que la corrija: así queda el registro de las dos.",
      409,
    );
  }

  const data: Prisma.EduRecordUpdateInput = {};

  if (input.subjetivo !== undefined) {
    data.subjetivo = eduRecordText(input.subjetivo, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.objetivo !== undefined) {
    data.objetivo = eduRecordText(input.objetivo, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.analisis !== undefined) {
    data.analisis = eduRecordText(input.analisis, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.plan !== undefined) {
    data.plan = eduRecordText(input.plan, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.diagnostico !== undefined) {
    data.diagnostico = eduRecordText(input.diagnostico, EDU_RECORD_DIAGNOSIS_MAX) ?? null;
  }

  if (input.appointmentId !== undefined) {
    if (input.appointmentId === null || input.appointmentId === "") {
      data.appointment = { disconnect: true };
    } else {
      const apptId = eduCleanId(input.appointmentId);
      const cita = apptId
        ? await prisma.eduAppointment.findFirst({
            where: { id: apptId, institutionId, patientId: actual.patientId },
            select: { id: true },
          })
        : null;
      if (!cita) throw new EduPadronError("Esa cita no es de este paciente.", 404);
      data.appointment = { connect: { id: cita.id } };
    }
  }

  let siguiente: EduRecordStatus = actual.status;
  if (input.status !== undefined) {
    const st = parseEduRecordStatus(input.status);
    if (!st) throw new EduPadronError("Ese estado de nota no existe.");
    if (st !== actual.status) {
      if (!eduRecordCanTransition(actual.status, st)) {
        throw new EduPadronError(
          `Una nota ${actual.status.toLowerCase()} no puede pasar a ${st.toLowerCase()}.`,
          409,
        );
      }

      // Una nota VACÍA no se entrega ni se firma. Se comprueba con lo que
      // va a quedar guardado (lo que ya estaba MÁS lo que llega en este
      // mismo PATCH), no solo con lo de la base: si no, escribir y firmar
      // en una sola petición rebotaría siempre.
      if (st !== "BORRADOR") {
        const final = {
          subjetivo: (data.subjetivo as string | null | undefined) ?? actual.subjetivo,
          objetivo: (data.objetivo as string | null | undefined) ?? actual.objetivo,
          analisis: (data.analisis as string | null | undefined) ?? actual.analisis,
          plan: (data.plan as string | null | undefined) ?? actual.plan,
          diagnostico: (data.diagnostico as string | null | undefined) ?? actual.diagnostico,
        };
        if (!eduRecordHasContent(final)) {
          throw new EduPadronError("La nota está vacía: escribe algo antes de entregarla o firmarla.");
        }
      }

      const sellos = eduRecordStamps(st, now, ctx.eduUserId, { submittedAt: actual.submittedAt });
      data.status = st;
      data.submittedAt = sellos.submittedAt;
      data.signedAt = sellos.signedAt;
      // `signedBy` se conecta o se desconecta; nunca se escribe el id a
      // pelo, que en Prisma es un campo de relación y no compila.
      data.signedBy = sellos.signedByUserId
        ? { connect: { id: sellos.signedByUserId } }
        : { disconnect: true };
      siguiente = st;
    }
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduRecord.update({ where: { id: actual.id }, data });
  return { id: actual.id, status: siguiente };
}
