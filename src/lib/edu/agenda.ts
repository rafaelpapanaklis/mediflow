/**
 * DaleControl INSTITUCIONAL — la AGENDA contra la base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro (la hora, el rango, el choque, el
 * estado) vive en agenda-core.ts; el recorte, en visibility.ts. Aquí solo
 * hay consultas y las tres comprobaciones que necesitan la base:
 *
 *   1. que el paciente, el alumno y el sillón sean de ESTE instituto;
 *   2. que la hora QUEPA en el horario del sillón;
 *   3. que no CHOQUE con otra cita del mismo sillón ni del mismo alumno.
 *
 * 🔴 institutionId de la SESIÓN, siempre. 🔴 El `where` de toda lectura
 * sale de eduAppointmentScopeWhere: ninguna consulta de este archivo arma
 * su propio recorte.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";
import {
  EDU_AGENDA_MAX_ROWS,
  EDU_APPOINTMENT_DEFAULT_MINUTES,
  EDU_BUSY_STATUSES,
  EDU_CLINICA_MAX_ROWS,
  eduAppointmentCanTransition,
  eduAppointmentStamps,
  eduCaseFitsAppointment,
  eduCleanId,
  eduDayRange,
  eduFormatTime,
  eduMinutesToLabel,
  eduOptionalText,
  eduScheduleAllows,
  eduStatusNeedsManage,
  eduTodayISO,
  eduUtcToZoned,
  eduWeekDays,
  eduZonedToUtc,
  parseEduAppointmentStatus,
  parseEduAppointmentType,
  parseEduDayISO,
  parseEduDurationMinutes,
  parseEduMinuteOfDay,
  type EduAgendaPage,
  type EduAgendaQuery,
  type EduAppointmentRow,
  type EduStudentOption,
  type EduSupervisorOption,
} from "@/lib/edu/agenda-core";
import {
  eduAppointmentScopeWhere,
  eduCampusCovers,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
// Ola 9. El recordatorio de WhatsApp de una cita que se MUEVE o se CIERRA
// hay que cancelarlo: lleva la hora vieja congelada dentro del texto. La
// decisión de qué se cancela y qué no vive en whatsapp-core.ts (puro), y
// esta función solo escribe. Es best-effort a propósito — mover una cita no
// puede fallar porque el registro de WhatsApp esté caído.
import { applyEduReminderCancel } from "@/lib/edu/recordatorios";
import {
  EDU_CASE_CLOSED_STATUSES,
  type EduAppointmentStatus,
  type EduAppointmentType,
} from "@/lib/edu/types";

export type {
  EduAgendaPage,
  EduAgendaQuery,
  EduAppointmentRow,
  EduStudentOption,
  EduSupervisorOption,
} from "@/lib/edu/agenda-core";

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

/** El `select` de una cita. En una constante para que la agenda, /mi-dia y
 *  la ficha del paciente no se desincronicen. */
const APPOINTMENT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  type: true,
  status: true,
  notes: true,
  supervisorUserId: true,
  caseId: true,
  patient: { select: { id: true, folio: true, firstName: true, lastName: true } },
  student: {
    select: {
      id: true,
      matricula: true,
      programId: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      program: { select: { name: true } },
    },
  },
  // Ola 12: la SEDE viaja con la cita (derivada del sillón, como todo lo
  // de la Ola 11) para que la agenda del paciente pueda decir dónde es.
  chair: { select: { id: true, name: true, number: true, campus: { select: { name: true } } } },
  supervisor: { select: { firstName: true, lastName: true, email: true } },
  case: { select: { status: true, program: { select: { name: true } } } },
} satisfies Prisma.EduAppointmentSelect;

type AppointmentPayload = Prisma.EduAppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>;

/**
 * La fila que viaja a la pantalla. Las horas se formatean AQUÍ, en el
 * servidor y con la zona del instituto: si el navegador las formateara con
 * la suya, un alumno conectado desde otra zona vería su cita a otra hora, y
 * el primer render no coincidiría con el del servidor.
 */
function toRow(a: AppointmentPayload, timeZone: string): EduAppointmentRow {
  const z = eduUtcToZoned(a.startsAt, timeZone);
  return {
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    dayISO: z.dayISO,
    startLabel: eduMinutesToLabel(z.minuteOfDay),
    endLabel: eduFormatTime(a.endsAt, timeZone),
    minutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
    type: a.type,
    status: a.status,
    notes: a.notes,

    patientId: a.patient.id,
    patientName: [a.patient.firstName, a.patient.lastName].filter(Boolean).join(" ").trim() || "Sin nombre",
    patientFolio: a.patient.folio,

    studentId: a.student.id,
    studentName: personName(a.student.user),
    studentMatricula: a.student.matricula,
    studentProgramId: a.student.programId,
    studentProgramName: a.student.program.name,

    chairId: a.chair.id,
    chairName: a.chair.name,
    chairNumber: a.chair.number,
    chairCampusName: a.chair.campus.name,

    supervisorUserId: a.supervisorUserId,
    supervisorName: a.supervisor ? personName(a.supervisor) : null,

    caseId: a.caseId,
    caseStatus: a.case?.status ?? null,
    caseProgramName: a.case?.program.name ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * La agenda de un día o de una semana.
 *
 * El rango se calcula en la zona del INSTITUTO (medianoche a medianoche) y
 * el extremo derecho es exclusivo: con `lte` una cita de las 00:00 saldría
 * en dos días.
 */
export async function listEduAgenda(
  ctx: EduClinicaContext,
  query: EduAgendaQuery,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduAgendaPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "appointments");
  const days = query.view === "semana" ? eduWeekDays(query.dayISO) : [query.dayISO];

  if (eduScopeIsEmpty(scope)) return { rows: [], days, truncated: false };

  const rango = eduDayRange(days[0], timeZone, days.length);
  if (!rango) return { rows: [], days, truncated: false };

  const where: Prisma.EduAppointmentWhereInput = {
    ...eduAppointmentScopeWhere({
      institutionId,
      scope,
      now,
      // El filtro por especialidad se fusiona DENTRO del mismo objeto
      // `student` que el recorte; escribir `where.student` dos veces
      // perdería uno de los dos en silencio.
      studentExtra: query.programId ? { programId: query.programId } : undefined,
      // 🔴 Ola 11 · LA SEDE. Recorta POR EL SILLÓN de la cita, no por una
      // columna copiada en la cita: si un sillón se traslada de edificio,
      // sus citas se van con él, que es lo que la escuela espera.
      campusIds: ctx.campusIds,
    }),
    startsAt: { gte: rango.from, lt: rango.to },
  };
  if (query.chairId) where.chairId = query.chairId;
  if (query.studentId) where.studentId = query.studentId;
  if (query.type) where.type = query.type;
  if (query.status) where.status = query.status;

  const rows = await prisma.eduAppointment.findMany({
    where,
    orderBy: [{ startsAt: "asc" }],
    take: EDU_AGENDA_MAX_ROWS + 1,
    select: APPOINTMENT_SELECT,
  });

  return {
    days,
    truncated: rows.length > EDU_AGENDA_MAX_ROWS,
    rows: rows.slice(0, EDU_AGENDA_MAX_ROWS).map((a) => toRow(a, timeZone)),
  };
}

/**
 * Lo que le toca HOY a quien pregunta. Es /mi-dia.
 *
 * No tiene filtros ni vista de semana a propósito: es la pantalla que un
 * alumno abre de pie, con el teléfono en una mano y el paciente esperando.
 * El recorte es el mismo helper de siempre, así que un DOCENTE ve el día de
 * sus alumnos vigentes y la dirección ve el día entero, sin escribir una
 * sola regla nueva.
 */
export async function listEduToday(
  ctx: EduClinicaContext,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ dayISO: string; rows: EduAppointmentRow[] }> {
  const dayISO = eduTodayISO(timeZone, now);
  const page = await listEduAgenda(
    ctx,
    {
      view: "dia",
      dayISO,
      chairId: null,
      programId: null,
      studentId: null,
      type: null,
      status: null,
    },
    timeZone,
    now,
  );
  return { dayISO, rows: page.rows };
}

/** Una cita, SI le toca a quien pregunta (si no, se ve como inexistente). */
export async function getEduAppointment(
  ctx: EduClinicaContext,
  appointmentId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduAppointmentRow | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "appointments");
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(appointmentId);
  if (!id) return null;

  const a = await prisma.eduAppointment.findFirst({
    where: { ...eduAppointmentScopeWhere({ institutionId, scope, now }), id },
    select: APPOINTMENT_SELECT,
  });
  return a ? toRow(a, timeZone) : null;
}

/**
 * Las citas de un paciente (para su ficha). Mismo recorte de siempre: un
 * alumno ve las suyas aunque el paciente tenga otras con otro alumno.
 */
export async function listEduPatientAppointments(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduAppointmentRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "appointments");
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(patientId);
  if (!id) return [];

  const rows = await prisma.eduAppointment.findMany({
    where: { ...eduAppointmentScopeWhere({ institutionId, scope, now }), patientId: id },
    orderBy: [{ startsAt: "desc" }],
    take: 50,
    select: APPOINTMENT_SELECT,
  });
  return rows.map((a) => toRow(a, timeZone));
}

/**
 * Los alumnos a los que se les puede agendar, con su titular VIGENTE.
 *
 * El titular viaja para que el formulario lo proponga solo: si hubiera que
 * elegirlo a mano en cada cita, la mitad de las citas acabarían sin
 * supervisor y la otra mitad con el que no era.
 *
 * ⚠️ Esta lista NO está recortada por el alcance del padrón: quien agenda
 * (caja o dirección) necesita ver a TODOS los alumnos activos del
 * instituto, incluidos los que no supervisa nadie todavía. Lo que sí se
 * cierra es el tenant y el estado: un alumno de baja no sale.
 */
export async function listEduStudentOptions(
  ctx: EduClinicaContext,
  now: Date = new Date(),
): Promise<EduStudentOption[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduStudent.findMany({
    where: { institutionId, status: "ACTIVE" },
    orderBy: [{ matricula: "asc" }],
    take: EDU_CLINICA_MAX_ROWS,
    select: {
      id: true,
      matricula: true,
      programId: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      program: { select: { name: true } },
      supervisors: {
        where: { institutionId, ...eduCurrentAssignmentWhere(now) },
        orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
        take: 1,
        select: {
          supervisorUserId: true,
          supervisor: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  return rows.map((s) => ({
    id: s.id,
    name: personName(s.user),
    matricula: s.matricula,
    programId: s.programId,
    programName: s.program.name,
    supervisorUserId: s.supervisors[0]?.supervisorUserId ?? null,
    supervisorName: s.supervisors[0] ? personName(s.supervisors[0].supervisor) : null,
  }));
}

/** Docentes activos, para el <select> de supervisor. */
export async function listEduSupervisorOptions(
  ctx: EduClinicaContext,
): Promise<EduSupervisorOption[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduUser.findMany({
    where: { institutionId, role: "DOCENTE" },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
    take: EDU_CLINICA_MAX_ROWS,
    select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
  });
  return rows.map((u) => ({ id: u.id, name: personName(u), isActive: u.isActive }));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

interface SlotInput {
  dayISO: string;
  startMinute: number;
  minutes: number;
}

/** Lee y valida día + hora + duración de un body. */
function parseSlot(input: {
  day?: unknown;
  startMinute?: unknown;
  minutes?: unknown;
}): SlotInput {
  const dayISO = parseEduDayISO(input.day);
  if (!dayISO) throw new EduPadronError("La fecha de la cita es obligatoria (AAAA-MM-DD).");

  const startMinute = parseEduMinuteOfDay(input.startMinute);
  if (startMinute === null) throw new EduPadronError("La hora de la cita es obligatoria (HH:MM).");

  const minutes =
    input.minutes === undefined || input.minutes === null || input.minutes === ""
      ? EDU_APPOINTMENT_DEFAULT_MINUTES
      : parseEduDurationMinutes(input.minutes);
  if (!minutes) throw new EduPadronError("La duración tiene que ir de 10 minutos a 8 horas.");

  return { dayISO, startMinute, minutes };
}

/**
 * Convierte el hueco a instantes y comprueba que quepa en el horario del
 * sillón. Devuelve el par [inicio, fin).
 */
async function resolveSlot(
  institutionId: string,
  chairId: string,
  slot: SlotInput,
  timeZone: string,
): Promise<{ startsAt: Date; endsAt: Date }> {
  const startsAt = eduZonedToUtc(slot.dayISO, slot.startMinute, timeZone);
  if (!startsAt) throw new EduPadronError("Esa fecha y hora no son válidas.");
  const endMinute = slot.startMinute + slot.minutes;
  if (endMinute > 24 * 60) {
    throw new EduPadronError("La cita no puede pasar de la medianoche. Acórtala o muévela.");
  }
  const endsAt = eduZonedToUtc(slot.dayISO, endMinute, timeZone);
  if (!endsAt) throw new EduPadronError("Esa fecha y hora no son válidas.");

  const schedules = await prisma.eduChairSchedule.findMany({
    where: { institutionId, chairId },
    select: { weekday: true, startMinute: true, endMinute: true },
  });
  const weekday = eduUtcToZoned(startsAt, timeZone).weekday;
  if (!eduScheduleAllows(schedules, weekday, slot.startMinute, endMinute)) {
    throw new EduPadronError(
      "Ese sillón no está abierto a esa hora. Revisa su horario en Sillones o elige otro hueco.",
      409,
    );
  }

  return { startsAt, endsAt };
}

/**
 * El CHOQUE. Dos comprobaciones distintas porque son dos problemas
 * distintos:
 *   · el sillón — no caben dos pacientes en la misma unidad;
 *   · el alumno — no puede estar en dos sillones a la vez.
 *
 * Las canceladas y las "no llegó" no cuentan: su hueco quedó libre.
 *
 * ⚠️ Es una comprobación de aplicación, no una restricción de la base. Dos
 * altas EXACTAMENTE simultáneas podrían colarse; para cerrarlo del todo
 * haría falta una restricción de exclusión sobre un rango (`tstzrange`),
 * que Prisma no modela y que dejaría el schema y el .sql diciendo cosas
 * distintas. Queda anotado: en una clínica escolar el alta la teclea una
 * persona, y el que se cuele se ve en la agenda del día.
 */
async function assertNoClash(
  institutionId: string,
  input: {
    chairId: string;
    studentId: string;
    startsAt: Date;
    endsAt: Date;
    exceptId?: string;
  },
): Promise<void> {
  const solapa = {
    // [a,b) se pisan ⇔ a.inicio < b.fin && b.inicio < a.fin
    startsAt: { lt: input.endsAt },
    endsAt: { gt: input.startsAt },
    status: { in: EDU_BUSY_STATUSES },
    ...(input.exceptId ? { NOT: { id: input.exceptId } } : {}),
  };

  const enElSillon = await prisma.eduAppointment.findFirst({
    where: { institutionId, chairId: input.chairId, ...solapa },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (enElSillon) {
    throw new EduPadronError("Ese sillón ya está ocupado a esa hora.", 409);
  }

  const elAlumno = await prisma.eduAppointment.findFirst({
    where: { institutionId, studentId: input.studentId, ...solapa },
    select: { id: true },
  });
  if (elAlumno) {
    throw new EduPadronError("Ese alumno ya tiene otra cita a esa hora.", 409);
  }
}

/** Comprueba que paciente, alumno, sillón y supervisor sean de este
 *  instituto. Es lo que un permiso no puede saber.
 *
 * 🔴 Ola 11 — y que el SILLÓN sea de una sede a la que quien agenda entra.
 * No es un permiso (tiene `agenda.manage`), es alcance: un chairId del body
 * que apuntara a la otra sede metería un paciente en un edificio al que
 * quien agenda ni siquiera puede mirar.
 *
 * Devuelve además la ZONA HORARIA DE LA SEDE del sillón, que es con la que
 * hay que interpretar la hora de la cita — no con la del instituto. Una
 * universidad con un campus en Tijuana y otro en Mérida tiene dos "las 8 de
 * la mañana" distintas, y el horario del sillón está en la hora de PARED de
 * su edificio. */
async function resolveParties(
  institutionId: string,
  input: {
    patientId?: unknown;
    studentId?: unknown;
    chairId?: unknown;
    supervisorUserId?: unknown;
  },
  campusIds?: string[] | null,
): Promise<{
  patientId: string;
  studentId: string;
  chairId: string;
  supervisorUserId: string | null;
  chairTimeZone: string | null;
}> {
  const patientId = eduCleanId(input.patientId);
  const studentId = eduCleanId(input.studentId);
  const chairId = eduCleanId(input.chairId);

  const patient = patientId
    ? await prisma.eduPatient.findFirst({ where: { id: patientId, institutionId }, select: { id: true } })
    : null;
  if (!patient) throw new EduPadronError("Elige un paciente de este instituto.", 400);

  const student = studentId
    ? await prisma.eduStudent.findFirst({
        where: { id: studentId, institutionId },
        select: { id: true, status: true },
      })
    : null;
  if (!student) throw new EduPadronError("Elige un alumno de este instituto.", 400);
  if (student.status !== "ACTIVE") {
    throw new EduPadronError("Ese alumno no está activo en el padrón. No se le pueden agendar pacientes.");
  }

  const chair = chairId
    ? await prisma.eduChair.findFirst({
        where: { id: chairId, institutionId },
        select: {
          id: true,
          isActive: true,
          name: true,
          campusId: true,
          campus: { select: { name: true, timezone: true } },
        },
      })
    : null;
  if (!chair) throw new EduPadronError("Elige un sillón de este instituto.", 400);
  if (!chair.isActive) {
    throw new EduPadronError(`"${chair.name}" está dado de baja. Reactívalo o elige otro sillón.`);
  }
  if (!eduCampusCovers(campusIds, chair.campusId)) {
    throw new EduPadronError(
      `"${chair.name}" está en ${chair.campus.name}, una sede a la que no tienes acceso.`,
      403,
    );
  }

  let supervisorUserId: string | null = null;
  const rawSup = input.supervisorUserId;
  if (rawSup !== undefined && rawSup !== null && rawSup !== "") {
    const id = eduCleanId(rawSup);
    const sup = id
      ? await prisma.eduUser.findFirst({
          where: { id, institutionId, role: "DOCENTE" },
          select: { id: true, isActive: true },
        })
      : null;
    if (!sup) throw new EduPadronError("Ese docente no es de este instituto.", 404);
    if (!sup.isActive) throw new EduPadronError("Ese docente está dado de baja.");
    supervisorUserId = sup.id;
  }

  return {
    patientId: patient.id,
    studentId: student.id,
    chairId: chair.id,
    supervisorUserId,
    chairTimeZone: chair.campus.timezone || null,
  };
}

export interface EduAppointmentInput {
  patientId?: unknown;
  studentId?: unknown;
  chairId?: unknown;
  supervisorUserId?: unknown;
  caseId?: unknown;
  day?: unknown;
  startMinute?: unknown;
  minutes?: unknown;
  type?: unknown;
  notes?: unknown;
}

/**
 * EL CASO DEL QUE CUELGA UNA CITA. Se resuelve SIEMPRE aquí — al agendar y
 * al reagendar— y por eso es una sola función y no dos bloques parecidos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 P0-2 DE LA AUDITORÍA — LA CITA SE ENGANCHA SOLA CUANDO HAY CASO.
 *
 * Hasta ahora el `caseId` solo se ponía si el CLIENTE lo mandaba, y la
 * pantalla de agenda no lo manda nunca (no tiene selector de caso). En la
 * práctica eso significaba que casi todas las citas del producto nacían
 * con `caseId: null`, y una cita suelta le seguía abriendo al alumno la
 * ficha del paciente después de entregar el caso: la mitad de la Ola 6 no
 * funcionaba (ver el bloque largo de visibility.ts).
 *
 * Se resuelve en el SERVIDOR y no con un `<select>` en el modal, por dos
 * razones que se sostienen solas:
 *   1. quien agenda es CAJA, y caja NO VE CASOS — es la línea del contrato
 *      del vertical. Un desplegable de casos abiertos en el modal de alta
 *      le pondría en el navegador la especialidad y el procedimiento de
 *      cada paciente, que es exactamente lo que el alcance le niega;
 *   2. un campo que el cliente PUEDE olvidar es un campo que el cliente VA
 *      a olvidar. Aquí no hay forma de agendar sin enganchar.
 *
 * Reglas, en orden:
 *   · si el cliente manda `caseId`, manda el cliente — pero se valida
 *     contra el MISMO paciente y el MISMO alumno (eduCaseFitsAppointment);
 *   · una cita de TAMIZAJE nace suelta a propósito: es la valoración que
 *     abre el caso, así que es anterior a él. Es la única excepción, y es
 *     la razón de que `{ caseId: null }` exista en el `where` de pacientes;
 *   · si no, se busca el caso VIVO de ese paciente con ese alumno. Si hay
 *     exactamente uno, se engancha. Si hay cero (todavía no se abre) o más
 *     de uno (dos especialidades), se deja suelta: adivinar entre dos casos
 *     es peor que no enganchar, y para eso está el `caseId` explícito.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function resolveAppointmentCaseId(
  institutionId: string,
  cita: { patientId: string; studentId: string; type: EduAppointmentType },
  rawCaseId: unknown,
): Promise<string | null> {
  // 1 · El que mandó el cliente. Sin esto se podría colgar una cita de la
  // señora del caso del señor, y el expediente de los dos quedaría mal para
  // siempre.
  if (rawCaseId !== undefined && rawCaseId !== null && rawCaseId !== "") {
    const id = eduCleanId(rawCaseId);
    const caso = id
      ? await prisma.eduCase.findFirst({
          where: { id, institutionId },
          select: { id: true, patientId: true, studentId: true },
        })
      : null;
    if (!caso) throw new EduPadronError("Ese caso no es de este instituto.", 404);
    if (caso.patientId !== cita.patientId) {
      throw new EduPadronError("Ese caso es de otro paciente.");
    }
    if (!eduCaseFitsAppointment(caso, cita)) {
      throw new EduPadronError("Ese caso es de otro alumno.");
    }
    return caso.id;
  }

  // 2 · El tamizaje es anterior al caso: nace suelto.
  if (cita.type === "TAMIZAJE") return null;

  // 3 · El caso vivo de ese paciente con ese alumno, si es UNO solo.
  const abiertos = await prisma.eduCase.findMany({
    where: {
      institutionId,
      patientId: cita.patientId,
      studentId: cita.studentId,
      status: { notIn: EDU_CASE_CLOSED_STATUSES },
    },
    // Dos bastan para saber que hay más de uno; no hace falta traerlos todos.
    take: 2,
    select: { id: true },
  });
  return abiertos.length === 1 ? abiertos[0].id : null;
}

export async function createEduAppointment(
  ctx: EduClinicaContext,
  input: EduAppointmentInput,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const partes = await resolveParties(institutionId, input, ctx.campusIds);
  const slot = parseSlot(input);
  // 🔴 Ola 11 · LA HORA SE INTERPRETA EN LA ZONA DE LA SEDE DEL SILLÓN, no
  // en la del instituto. Con dos campus en husos distintos, "las 8" del
  // campus de Mérida y "las 8" del de Tijuana son dos instantes separados
  // por dos horas, y el horario del sillón está escrito en la hora de PARED
  // de su edificio. El `timeZone` que llega por parámetro queda como
  // respaldo para el instituto sin sedes.
  const zona = partes.chairTimeZone ?? timeZone;
  const { startsAt, endsAt } = await resolveSlot(institutionId, partes.chairId, slot, zona);

  const type = input.type === undefined || input.type === null || input.type === ""
    ? ("TRATAMIENTO" as EduAppointmentType)
    : parseEduAppointmentType(input.type);
  if (!type) throw new EduPadronError("Ese tipo de cita no existe.");

  // El caso: el que mande el cliente (comprobado contra el mismo paciente y
  // el mismo alumno) o, si no manda ninguno, el caso VIVO de ese paciente
  // con ese alumno. Ver resolveAppointmentCaseId — es el P0-2.
  const caseId = await resolveAppointmentCaseId(
    institutionId,
    { patientId: partes.patientId, studentId: partes.studentId, type },
    input.caseId,
  );

  // Cinturón contra el dedazo del año: una cita a más de un año vista casi
  // siempre es un "2206" en vez de "2026", y una vez guardada nadie la ve
  // nunca más porque ninguna vista llega hasta ahí.
  if (startsAt.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000) {
    throw new EduPadronError("Esa fecha está a más de un año. Revisa el año que escribiste.");
  }

  await assertNoClash(institutionId, {
    chairId: partes.chairId,
    studentId: partes.studentId,
    startsAt,
    endsAt,
  });

  const created = await prisma.eduAppointment.create({
    data: {
      institutionId,
      patientId: partes.patientId,
      studentId: partes.studentId,
      chairId: partes.chairId,
      supervisorUserId: partes.supervisorUserId,
      caseId,
      startsAt,
      endsAt,
      type,
      notes: eduOptionalText(input.notes, 1000) ?? null,
    },
    select: { id: true },
  });

  return created;
}

/**
 * Reagendar: mover la hora, el sillón, el alumno o el supervisor.
 *
 * 🔴 Una cita ya terminada, cancelada o marcada como "no llegó" NO se
 * mueve. Reagendar una cita terminada reescribiría algo que ya ocurrió; lo
 * que se hace es agendar otra.
 *
 * 🔴 Y SI CAMBIA EL ALUMNO, SE REVALIDA EL CASO. Ver el bloque del P1-3 más
 * abajo: una cita cuyo `caseId` es de otro alumno es una fila que miente
 * sobre quién atendió a quién.
 */
export async function updateEduAppointment(
  ctx: EduClinicaContext,
  appointmentId: string,
  input: EduAppointmentInput,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(appointmentId);
  if (!id) throw new EduPadronError("Esa cita no es de este instituto.", 404);

  const current = await prisma.eduAppointment.findFirst({
    where: { id, institutionId },
    select: {
      id: true,
      status: true,
      type: true,
      patientId: true,
      studentId: true,
      chairId: true,
      startsAt: true,
      endsAt: true,
      supervisorUserId: true,
      caseId: true,
    },
  });
  if (!current) throw new EduPadronError("Esa cita no es de este instituto.", 404);
  if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(current.status)) {
    throw new EduPadronError("Esa cita ya se cerró. Agenda otra en vez de moverla.", 409);
  }

  const data: Prisma.EduAppointmentUncheckedUpdateInput = {};

  const cambiaAlumno = input.studentId !== undefined;
  const cambiaSillon = input.chairId !== undefined;
  const cambiaHora = input.day !== undefined || input.startMinute !== undefined || input.minutes !== undefined;

  let studentId = current.studentId;
  let chairId = current.chairId;
  // Ola 11: la zona con la que se interpreta la hora es la de la SEDE del
  // sillón —el de destino si se está mudando la cita—, no la del instituto.
  let zona = timeZone;

  if (cambiaAlumno || cambiaSillon || input.supervisorUserId !== undefined) {
    const partes = await resolveParties(
      institutionId,
      {
        patientId: current.patientId,
        studentId: cambiaAlumno ? input.studentId : current.studentId,
        chairId: cambiaSillon ? input.chairId : current.chairId,
        supervisorUserId:
          input.supervisorUserId !== undefined ? input.supervisorUserId : current.supervisorUserId,
      },
      ctx.campusIds,
    );
    studentId = partes.studentId;
    chairId = partes.chairId;
    zona = partes.chairTimeZone ?? timeZone;
    if (cambiaAlumno) data.studentId = partes.studentId;
    if (cambiaSillon) data.chairId = partes.chairId;
    if (input.supervisorUserId !== undefined) data.supervisorUserId = partes.supervisorUserId;
  }

  let startsAt = current.startsAt;
  let endsAt = current.endsAt;

  if (cambiaHora) {
    // El día y la hora que se CONSERVAN (los que el body no manda) se leen
    // en la zona a la que VA la cita, no en la de donde estaba: si se
    // reagenda "solo la hora" a un sillón de otra sede, el día que se
    // conserva tiene que ser el día del calendario de esa otra sede.
    const z = eduUtcToZoned(current.startsAt, zona);
    const minutosActuales = Math.round(
      (current.endsAt.getTime() - current.startsAt.getTime()) / 60_000,
    );
    const slot = parseSlot({
      day: input.day ?? z.dayISO,
      startMinute: input.startMinute ?? z.minuteOfDay,
      minutes: input.minutes ?? minutosActuales,
    });
    const resuelto = await resolveSlot(institutionId, chairId, slot, zona);
    startsAt = resuelto.startsAt;
    endsAt = resuelto.endsAt;
    data.startsAt = startsAt;
    data.endsAt = endsAt;
  } else if (cambiaSillon) {
    // Cambiar de sillón sin cambiar la hora tiene que volver a comprobar el
    // horario: el sillón nuevo puede estar cerrado a esa hora — y si está
    // en otra sede, "esa hora" ni siquiera es el mismo instante.
    const z = eduUtcToZoned(current.startsAt, zona);
    const minutos = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000);
    await resolveSlot(
      institutionId,
      chairId,
      { dayISO: z.dayISO, startMinute: z.minuteOfDay, minutes: minutos },
      zona,
    );
  }

  if (input.type !== undefined) {
    const t = parseEduAppointmentType(input.type);
    if (!t) throw new EduPadronError("Ese tipo de cita no existe.");
    data.type = t;
  }
  if (input.notes !== undefined) {
    data.notes = eduOptionalText(input.notes, 1000) ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 P1-3 DE LA AUDITORÍA — SI LA CITA CAMBIA DE ALUMNO, EL CASO NO SE
  // QUEDA COMO ESTABA.
  //
  // El POST defiende esta invariante desde el primer día ("Ese caso es de
  // otro alumno") y el PATCH no la miraba: reagendar cambiaba `studentId` y
  // dejaba intacto un `caseId` cuyo dueño es OTRO. La fila quedaba diciendo
  // que B atendió el caso de A — y con eso las horas clínicas se cuentan
  // por `EduAppointment.studentId` mientras el caso pertenece a otro, la
  // etapa SESSION del gate de la Ola 4 firmaría una sesión que nadie dio, y
  // la bitácora enseña un par caso↔cita que no cuadra.
  //
  // No se rebota con un throw y es a propósito: mover una cita a otro
  // alumno es lo que hace caja cuando alguien falta, y prohibirlo dejaría
  // sin salida a la única persona que puede resolverlo un martes a las 9. Se
  // RESUELVE: el caso pasa a ser el del alumno nuevo (si tiene uno vivo con
  // ese paciente) o se suelta.
  //
  // ⚠️ Se compara el alumno RESULTANTE contra el que había, no la presencia
  // de `input.studentId`: la pantalla de reagendar manda el alumno siempre,
  // también cuando no lo cambia, y volver a derivar en cada movimiento
  // soltaría el caso de una cita cuyo caso se cerró (COMPLETED) — es decir,
  // reescribiría el pasado por mover una hora.
  // ═══════════════════════════════════════════════════════════════════════
  const alumnoCambio = studentId !== current.studentId;
  if (alumnoCambio || input.caseId !== undefined) {
    const tipo = (data.type as EduAppointmentType | undefined) ?? (current.type as EduAppointmentType);
    const caseId = await resolveAppointmentCaseId(
      institutionId,
      { patientId: current.patientId, studentId, type: tipo },
      input.caseId,
    );
    if (caseId !== current.caseId) data.caseId = caseId;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  if (cambiaHora || cambiaSillon || cambiaAlumno) {
    await assertNoClash(institutionId, {
      chairId,
      studentId,
      startsAt,
      endsAt,
      exceptId: current.id,
    });
  }

  await prisma.eduAppointment.update({ where: { id: current.id }, data });

  // 🔴 REAGENDAR CANCELA EL RECORDATORIO VIEJO.
  //
  // El texto del recordatorio se pinta al encolarlo, con la fecha y la hora
  // DENTRO. Si la cita se mueve y su aviso sigue en cola, al paciente le
  // llega la hora vieja — y viene un día antes, o no viene. En el dental
  // esto es un bug conocido y abierto; aquí se cierra en el mismo acto que
  // mueve la cita.
  //
  // Solo cuando cambia la HORA: mover el sillón o el supervisor no cambia
  // ni una palabra de lo que el paciente va a leer, y cancelar por eso
  // costaría una plantilla más (que Meta le cobra al instituto).
  if (data.startsAt !== undefined) {
    await applyEduReminderCancel({
      institutionId,
      appointmentId: current.id,
      reason: "Se canceló porque la cita se reagendó: el aviso llevaba la hora vieja.",
    });
  }

  return { id: current.id };
}

/**
 * Mueve el ESTADO de una cita: llegó → se sentó → se le trabaja → terminó.
 *
 * 🔴 QUIÉN PUEDE: el endpoint ya comprobó "agenda.view" y esta función
 * recibe `canManage` (¿trae "agenda.manage"?). Cancelar y dar por no
 * presentado son DECISIONES administrativas y exigen agenda.manage; los
 * cuatro estados clínicos los mueve quien ve la cita.
 *
 * Ésa es la razón de que /mi-dia sirva de algo: un ALUMNO solo trae
 * agenda.view por defecto y, sin esta distinción, no podría marcar nada de
 * su propio día. Lo que impide que mueva la de otro no es el permiso, es el
 * ALCANCE: la cita se busca con el `where` de visibilidad y una que no le
 * toca se ve exactamente igual que una que no existe.
 */
export async function setEduAppointmentStatus(
  ctx: EduClinicaContext,
  appointmentId: string,
  rawStatus: unknown,
  options: { canManage: boolean },
  now: Date = new Date(),
): Promise<{ id: string; status: EduAppointmentStatus }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "appointments");
  if (eduScopeIsEmpty(scope)) throw new EduPadronError("Esa cita no es de este instituto.", 404);

  const id = eduCleanId(appointmentId);
  if (!id) throw new EduPadronError("Esa cita no es de este instituto.", 404);

  const status = parseEduAppointmentStatus(rawStatus);
  if (!status) throw new EduPadronError("Ese estado de cita no existe.");

  if (eduStatusNeedsManage(status) && !options.canManage) {
    throw new EduPadronError(
      "Cancelar una cita o darla por no presentada necesita el permiso agenda.manage.",
      403,
    );
  }

  const current = await prisma.eduAppointment.findFirst({
    where: { ...eduAppointmentScopeWhere({ institutionId, scope, now }), id },
    select: {
      id: true,
      status: true,
      checkedInAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!current) throw new EduPadronError("Esa cita no es de este instituto.", 404);

  if (!eduAppointmentCanTransition(current.status, status)) {
    throw new EduPadronError(
      `Una cita en "${current.status}" no puede pasar a "${status}".`,
      409,
    );
  }

  await prisma.eduAppointment.update({
    where: { id: current.id },
    data: {
      status,
      // Las marcas de tiempo se DERIVAN del estado y no se capturan: así no
      // existe una cita terminada sin hora de fin, ni una hora de fin en
      // una que sigue agendada.
      ...eduAppointmentStamps(status, current, now),
    },
  });

  // 🔴 CANCELAR (O CERRAR) TAMBIÉN CANCELA EL RECORDATORIO.
  //
  // Los tres estados terminales por la misma razón: a una cita cancelada,
  // a una en la que el paciente no llegó y a una ya terminada NO se les
  // manda un "le recordamos su cita". El barrido tampoco las encontraría
  // (filtra por los estados vivos), pero la fila en cola se quedaría en
  // "en curso" para siempre y la pantalla diría algo que no va a pasar.
  if (status === "CANCELLED" || status === "NO_SHOW" || status === "COMPLETED") {
    await applyEduReminderCancel({
      institutionId,
      appointmentId: current.id,
      reason: "Se canceló porque la cita se cerró antes de que saliera el aviso.",
    });
  }

  return { id: current.id, status };
}

/**
 * Las valoraciones iniciales pendientes: las citas de TAMIZAJE de los
 * últimos días y de los que vienen.
 *
 * La ventana arranca SIETE DÍAS ATRÁS y no hoy a propósito: la valoración
 * del viernes se registra el lunes más veces de las que nadie querría
 * admitir, y si la pantalla solo mirara hacia adelante, esa cita
 * desaparecería y el caso nunca se abriría.
 *
 * Se filtran las canceladas y las que el paciente no llegó (no hubo
 * valoración) pero NO las que ya tienen caso: verlas con su "ya tiene caso
 * abierto" es cómo alguien se da cuenta de que un compañero ya lo hizo, en
 * vez de abrir un segundo caso y que el servidor lo rebote.
 */
export async function listEduPendingScreenings(
  ctx: EduClinicaContext,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduAppointmentRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "appointments");
  if (eduScopeIsEmpty(scope)) return [];

  const desde = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const hasta = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.eduAppointment.findMany({
    where: {
      ...eduAppointmentScopeWhere({ institutionId, scope, now }),
      type: "TAMIZAJE",
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { gte: desde, lt: hasta },
    },
    orderBy: [{ startsAt: "asc" }],
    take: 100,
    select: APPOINTMENT_SELECT,
  });
  return rows.map((a) => toRow(a, timeZone));
}
