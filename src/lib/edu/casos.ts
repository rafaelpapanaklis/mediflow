/**
 * DaleControl INSTITUCIONAL — EL CASO contra la base de datos.
 *
 * SERVIDOR: importa prisma. El recorte sale de visibility.ts y lo puro de
 * agenda-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ ES UN CASO Y POR QUÉ NO ES "EL EXPEDIENTE DEL PACIENTE"
 *
 * Un caso es: este paciente, con este alumno, en esta especialidad. Un
 * paciente puede tener VARIOS a la vez — la señora que necesita endodoncia
 * y ortodoncia es una persona con dos casos, dos alumnos y dos docentes.
 * Meterlo todo en un solo "expediente del paciente" es exactamente lo que
 * hace que en una escuela nadie sepa de quién era la responsabilidad.
 *
 * 🔴 CAJA NO VE CASOS. No es un permiso que se nos olvidó dar: es la línea
 * del contrato ("CAJA → todos los pacientes y toda la agenda. SIN
 * expediente clínico") y está cerrada en dos sitios — en el default de
 * permisos (CAJA no trae casos.view) y en el helper de visibilidad, que
 * para el recurso "cases" le devuelve "none" aunque alguien le encienda el
 * interruptor por error.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCurrentAssignmentWhere, eduSearchTokens } from "@/lib/edu/padron-core";
import {
  EDU_CLINICA_MAX_ROWS,
  eduCleanId,
  eduDayRange,
  eduFormatDayShort,
  eduOptionalText,
  eduSafeTimeZone,
  eduUtcToZoned,
  parseEduCaseStatus,
  type EduCaseRow,
} from "@/lib/edu/agenda-core";
// Ola de Casos · la pantalla global. Lo puro (filtros, la columna
// "esperando", el CSV) vive en casos-core.ts; aquí solo la consulta.
import { eduPhoneSearchToken } from "@/lib/edu/pacientes-core";
import {
  EDU_CASOS_EXPORT_BATCH,
  EDU_CASOS_EXPORT_MAX_ROWS,
  eduCasoEsperando,
  type EduCasosPanelFilters,
  type EduCasosPanelPage,
  type EduCasosPanelRow,
} from "@/lib/edu/casos-core";
import {
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
// Ola 4 · el gate. Se importa aquí y no al revés: `autorizaciones.ts` no
// sabe nada de este archivo, así que no hay ciclo.
import { eduCaseGateCheck } from "@/lib/edu/autorizaciones";
import {
  EDU_CASE_CLOSED_STATUSES,
  EDU_CASE_STATUS_LABELS,
  type EduCaseStatus,
} from "@/lib/edu/types";

export type { EduCaseRow } from "@/lib/edu/agenda-core";

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

const CASE_SELECT = {
  id: true,
  status: true,
  openedAt: true,
  closedAt: true,
  notes: true,
  supervisorUserId: true,
  patient: { select: { id: true, folio: true, firstName: true, lastName: true } },
  student: {
    select: {
      id: true,
      matricula: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  program: { select: { id: true, name: true } },
  supervisor: { select: { firstName: true, lastName: true, email: true } },
  _count: { select: { appointments: true } },
  // Ola 6: el procedimiento principal (lo que hace contable un requisito)
  // y las dos columnas del traspaso.
  procedureId: true,
  procedure: { select: { id: true, name: true, category: true } },
  transferredFromCaseId: true,
  transferReason: true,
} satisfies Prisma.EduCaseSelect;

type CasePayload = Prisma.EduCaseGetPayload<{ select: typeof CASE_SELECT }>;

function toRow(c: CasePayload): EduCaseRow {
  return {
    id: c.id,
    status: c.status,
    openedAt: c.openedAt.toISOString(),
    closedAt: c.closedAt ? c.closedAt.toISOString() : null,
    notes: c.notes,

    patientId: c.patient.id,
    patientName:
      [c.patient.firstName, c.patient.lastName].filter(Boolean).join(" ").trim() || "Sin nombre",
    patientFolio: c.patient.folio,

    studentId: c.student.id,
    studentName: personName(c.student.user),
    studentMatricula: c.student.matricula,

    programId: c.program.id,
    programName: c.program.name,

    supervisorUserId: c.supervisorUserId,
    supervisorName: c.supervisor ? personName(c.supervisor) : null,

    appointments: c._count.appointments,

    procedureId: c.procedureId,
    procedureName: c.procedure?.name ?? null,
    procedureCategory: c.procedure?.category ?? null,

    transferredFromCaseId: c.transferredFromCaseId,
    transferReason: c.transferReason,
  };
}

export interface EduCaseFilters {
  status: EduCaseStatus | null;
  programId: string | null;
  studentId: string | null;
  patientId: string | null;
  /** true = solo los que siguen vivos (ni terminados ni cerrados). */
  onlyOpen: boolean;
}

export const EDU_CASE_EMPTY_FILTERS: EduCaseFilters = {
  status: null,
  programId: null,
  studentId: null,
  patientId: null,
  onlyOpen: false,
};

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

export async function listEduCases(
  ctx: EduClinicaContext,
  filters: EduCaseFilters = EDU_CASE_EMPTY_FILTERS,
  now: Date = new Date(),
): Promise<{ rows: EduCaseRow[]; truncated: boolean }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const where: Prisma.EduCaseWhereInput = {
    ...eduCaseScopeWhere({
      institutionId,
      scope,
      now,
      studentExtra: filters.studentId ? { id: filters.studentId } : undefined,
    }),
  };
  if (filters.status) where.status = filters.status;
  else if (filters.onlyOpen) where.status = { notIn: EDU_CASE_CLOSED_STATUSES };
  if (filters.programId) where.programId = filters.programId;
  if (filters.patientId) where.patientId = filters.patientId;

  const rows = await prisma.eduCase.findMany({
    where,
    orderBy: [{ openedAt: "desc" }],
    take: EDU_CLINICA_MAX_ROWS + 1,
    select: CASE_SELECT,
  });

  return {
    truncated: rows.length > EDU_CLINICA_MAX_ROWS,
    rows: rows.slice(0, EDU_CLINICA_MAX_ROWS).map(toRow),
  };
}

/** Los casos de un paciente. Mismo recorte: un alumno ve los suyos aunque
 *  el paciente tenga otros con otro alumno y otra especialidad. */
export async function listEduPatientCases(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<EduCaseRow[]> {
  const id = eduCleanId(patientId);
  if (!id) return [];
  const page = await listEduCases(ctx, { ...EDU_CASE_EMPTY_FILTERS, patientId: id }, now);
  return page.rows;
}

export async function getEduCase(
  ctx: EduClinicaContext,
  caseId: string,
  now: Date = new Date(),
): Promise<EduCaseRow | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(caseId);
  if (!id) return null;

  const c = await prisma.eduCase.findFirst({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id },
    select: CASE_SELECT,
  });
  return c ? toRow(c) : null;
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Engancha a UN caso las citas SUELTAS (`caseId: null`) de ese paciente con
 * ese alumno. Devuelve cuántas enganchó.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 CIERRE · ES LA MISMA REGLA EN LOS DOS MOMENTOS EN QUE UN CASO "RECOGE"
 * SUS CITAS, Y POR ESO ES UNA SOLA FUNCIÓN:
 *
 *   · al ABRIR el caso (createEduCase, abajo) — el orden NORMAL del
 *     producto es agendar primero y abrir el caso cuando el paciente llega,
 *     así que la cita casi siempre es ANTERIOR al caso. El arreglo del P0-2
 *     enganchaba al agendar, al reagendar y al traspasar… y ninguna de esas
 *     tres corre cuando el caso nace DESPUÉS de la cita: la fila se quedaba
 *     con `caseId: null` para siempre, no contaba para la etapa SESSION del
 *     gate de la Ola 4, y en el traspaso no se iba con el alumno entrante.
 *
 *   · al TRASPASAR (traspasos.ts) — las citas sueltas del alumno saliente
 *     con ese paciente se cuelgan del caso que entrega (que en ese instante
 *     ya quedó TRANSFERRED), para que una cita huérfana no le conserve la
 *     ficha del paciente que acaba de entregar.
 *
 * Si esto fuera un `updateMany` copiado en los dos sitios, tarde o temprano
 * uno de los dos filtraría distinto — y el que filtrara mal funcionaría
 * perfectamente, para todo el mundo.
 *
 * ⚠️ `includeTamizaje` distingue los dos momentos y no es decorativo:
 *   · al ABRIR, el TAMIZAJE se queda fuera — es la valoración ANTERIOR al
 *     caso y el caso engancha LA SUYA por su lado (`screeningAppointmentId`);
 *     otra cita de tamizaje suelta del par es una valoración pendiente que
 *     no pertenece a este caso.
 *   · al TRASPASAR entra todo: una cita suelta —del tipo que sea— es una
 *     llave suelta igual. (Es la misma pareja de reglas que las secciones
 *     1 y 2 de sql/edu-fix-auditoria.sql, que repara lo histórico.)
 *
 * ⚠️ QUIEN LLAMA DECIDE SI EL CASO ES INEQUÍVOCO. Esta función engancha lo
 * que le digan; la regla de "solo si este caso es el ÚNICO vivo del par"
 * (adivinar entre dos casos mueve una sesión al expediente equivocado) vive
 * en `createEduCase`, porque en el traspaso la pregunta ni se plantea: las
 * sueltas del saliente se cuelgan del caso que entrega, haya o no otro vivo
 * — quitar la llave manda sobre clasificar perfecto, y así quedó decidido
 * en el arreglo del P0-2.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function eduAttachLooseAppointments(
  tx: Prisma.TransactionClient,
  args: {
    institutionId: string;
    patientId: string;
    studentId: string;
    caseId: string;
    /** true = también las de TAMIZAJE (solo el traspaso). */
    includeTamizaje: boolean;
  },
): Promise<number> {
  const res = await tx.eduAppointment.updateMany({
    where: {
      institutionId: args.institutionId,
      patientId: args.patientId,
      studentId: args.studentId,
      caseId: null,
      ...(args.includeTamizaje ? {} : { type: { not: "TAMIZAJE" } }),
    },
    data: { caseId: args.caseId },
  });
  return res.count;
}

/**
 * El titular VIGENTE de un alumno, o null.
 *
 * Se usa para rellenar solo el supervisor del caso al abrirlo. Si hubiera
 * que elegirlo a mano en cada tamizaje, la mitad de los casos acabarían sin
 * responsable — y el responsable es justo lo que hay que poder contestar
 * dentro de un año.
 */
async function currentSupervisorOf(
  institutionId: string,
  studentId: string,
  now: Date,
): Promise<string | null> {
  const a = await prisma.eduSupervisorAssignment.findFirst({
    where: { institutionId, studentId, ...eduCurrentAssignmentWhere(now) },
    orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
    select: { supervisorUserId: true },
  });
  return a?.supervisorUserId ?? null;
}

/** Paciente, alumno y programa de ESTE instituto, y la generación del
 *  alumno coherente con lo que se pide. */
async function resolveCaseParties(
  institutionId: string,
  input: { patientId?: unknown; studentId?: unknown; programId?: unknown },
): Promise<{ patientId: string; studentId: string; programId: string }> {
  const patientId = eduCleanId(input.patientId);
  const studentId = eduCleanId(input.studentId);
  const programId = eduCleanId(input.programId);

  const patient = patientId
    ? await prisma.eduPatient.findFirst({ where: { id: patientId, institutionId }, select: { id: true } })
    : null;
  if (!patient) throw new EduPadronError("Elige un paciente de este instituto.", 400);

  const student = studentId
    ? await prisma.eduStudent.findFirst({
        where: { id: studentId, institutionId },
        select: { id: true, status: true, programId: true },
      })
    : null;
  if (!student) throw new EduPadronError("Elige un estudiante de este instituto.", 400);
  if (student.status !== "ACTIVE") {
    throw new EduPadronError("Ese estudiante no está activo en el padrón. No se le puede asignar un paciente.");
  }

  const program = programId
    ? await prisma.eduProgram.findFirst({ where: { id: programId, institutionId }, select: { id: true } })
    : null;
  if (!program) throw new EduPadronError("Elige una especialidad de este instituto.", 400);

  return { patientId: patient.id, studentId: student.id, programId: program.id };
}

export interface EduCaseInput {
  patientId?: unknown;
  studentId?: unknown;
  programId?: unknown;
  supervisorUserId?: unknown;
  notes?: unknown;
  /** La cita de tamizaje que lo abrió, si viene del tamizaje. */
  screeningAppointmentId?: unknown;
  /** Ola 6: el procedimiento principal. Opcional — en el tamizaje todavía
   *  no se sabe qué se le va a hacer al paciente. */
  procedureId?: unknown;
}

/**
 * El procedimiento del catálogo, comprobado contra ESTE instituto.
 *
 * `undefined` = no lo mandaron (no se toca). `null` = lo están borrando.
 * Un id que no es de este instituto REBOTA en vez de quedarse en null: un
 * caso clasificado en silencio como "sin procedimiento" es un requisito
 * que deja de contar sin que nadie se entere.
 */
async function resolveProcedureId(
  institutionId: string,
  raw: unknown,
): Promise<string | null | undefined> {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const id = eduCleanId(raw);
  const proc = id
    ? await prisma.eduProcedure.findFirst({
        where: { id, institutionId },
        select: { id: true },
      })
    : null;
  if (!proc) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);
  return proc.id;
}

/**
 * Abre un caso.
 *
 * ⚠️ Se rebota un caso ABIERTO repetido del mismo paciente en la misma
 * especialidad: dos casos vivos de endodoncia para la misma persona son un
 * error de captura, y cuando pasa, las citas se reparten entre los dos y
 * el avance deja de leerse. Un caso CERRADO no estorba: el paciente puede
 * volver años después.
 */
export async function createEduCase(
  ctx: EduClinicaContext,
  input: EduCaseInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const partes = await resolveCaseParties(institutionId, input);

  const abierto = await prisma.eduCase.findFirst({
    where: {
      institutionId,
      patientId: partes.patientId,
      programId: partes.programId,
      status: { notIn: EDU_CASE_CLOSED_STATUSES },
    },
    select: { id: true },
  });
  if (abierto) {
    throw new EduPadronError(
      "Ese paciente ya tiene un caso abierto en esa especialidad. Ciérralo o transfiérelo antes de abrir otro.",
      409,
    );
  }

  // El supervisor: el que venga, y si no, el titular VIGENTE del alumno.
  let supervisorUserId: string | null = null;
  if (input.supervisorUserId !== undefined && input.supervisorUserId !== null && input.supervisorUserId !== "") {
    const id = eduCleanId(input.supervisorUserId);
    const sup = id
      ? await prisma.eduUser.findFirst({
          where: { id, institutionId, role: "DOCENTE" },
          select: { id: true, isActive: true },
        })
      : null;
    if (!sup) throw new EduPadronError("Ese docente no es de este instituto.", 404);
    if (!sup.isActive) throw new EduPadronError("Ese docente está dado de baja.");
    supervisorUserId = sup.id;
  } else {
    supervisorUserId = await currentSupervisorOf(institutionId, partes.studentId, now);
  }

  let screeningAppointmentId: string | null = null;
  if (
    input.screeningAppointmentId !== undefined &&
    input.screeningAppointmentId !== null &&
    input.screeningAppointmentId !== ""
  ) {
    const id = eduCleanId(input.screeningAppointmentId);
    const cita = id
      ? await prisma.eduAppointment.findFirst({
          where: { id, institutionId },
          select: { id: true, patientId: true, type: true },
        })
      : null;
    if (!cita) throw new EduPadronError("Esa cita no es de este instituto.", 404);
    if (cita.patientId !== partes.patientId) {
      throw new EduPadronError("Esa cita de tamizaje es de otro paciente.");
    }
    screeningAppointmentId = cita.id;
  }

  const procedureId = (await resolveProcedureId(institutionId, input.procedureId)) ?? null;

  // Abrir un caso significa que a este paciente lo está atendiendo alguien:
  // deja de estar "Nuevo". Se hace en la MISMA transacción — si el caso se
  // crea y el estado no se mueve, el paciente se queda listado como "sin
  // tamizar" para siempre y recepción lo vuelve a mandar a valoración.
  const created = await prisma.$transaction(async (tx) => {
    const caso = await tx.eduCase.create({
      data: {
        institutionId,
        patientId: partes.patientId,
        studentId: partes.studentId,
        programId: partes.programId,
        supervisorUserId,
        screeningAppointmentId,
        procedureId,
        status: "ASSIGNED",
        openedAt: now,
        notes: eduOptionalText(input.notes, 1000) ?? null,
      },
      select: { id: true },
    });

    // 🔴 OLA 6 — LA CITA DE TAMIZAJE SE ENGANCHA AL CASO QUE ABRIÓ.
    //
    // Hasta ahora el enlace existía en UNA sola dirección (el caso sabía
    // de qué cita nació, la cita no sabía de qué caso). Eso dejaba un
    // agujero justo en el traspaso: la visibilidad del alumno mira sus
    // citas además de sus casos, y una cita HUÉRFANA de caso le seguiría
    // dando acceso al paciente después de entregarlo. Con el enlace
    // puesto, esa cita cuelga del caso TRANSFERRED y deja de abrir la
    // puerta (ver src/lib/edu/visibility.ts).
    //
    // `updateMany` con el caseId todavía nulo: si la cita ya colgaba de
    // otro caso, no se le toca — un enlace existente vale más que éste.
    if (screeningAppointmentId) {
      await tx.eduAppointment.updateMany({
        where: { id: screeningAppointmentId, institutionId, caseId: null },
        data: { caseId: caso.id },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🔴 CIERRE · LAS CITAS AGENDADAS ANTES DE ABRIR EL CASO SE ENGANCHAN
    // AL ABRIRLO.
    //
    // El orden NORMAL del producto es exactamente ése: recepción agenda,
    // el paciente llega y ENTONCES el tamizaje abre el caso. El arreglo del
    // P0-2 enganchaba al agendar (el caso ya existía), al reagendar y al
    // traspasar — pero cuando el caso nace DESPUÉS de la cita, ninguno de
    // esos tres momentos vuelve a mirarla: la fila se quedaba con
    // `caseId: null` para siempre. Ese hueco se vio en producción: la cita
    // no contaba para la etapa SESSION del gate y, al traspasar, no se iba
    // con el alumno entrante.
    //
    // Solo si este caso queda como el ÚNICO vivo del par (paciente,
    // alumno): con dos casos vivos —dos especialidades— no hay forma de
    // saber de cuál es cada cita suelta, y adivinar mueve una sesión al
    // expediente equivocado. Es la MISMA regla que resolveAppointmentCaseId
    // (agenda.ts) aplica al agendar, y la del paso 1 del .sql que repara
    // las filas históricas (sql/edu-cierre.sql).
    //
    // El conteo va DENTRO de la transacción y después del create: se
    // pregunta por "otros" casos vivos con el recién nacido ya visible,
    // así que la respuesta no puede cambiar entre la cuenta y el enganche.
    // ═══════════════════════════════════════════════════════════════════
    const otrosVivos = await tx.eduCase.count({
      where: {
        institutionId,
        patientId: partes.patientId,
        studentId: partes.studentId,
        status: { notIn: EDU_CASE_CLOSED_STATUSES },
        NOT: { id: caso.id },
      },
    });
    if (otrosVivos === 0) {
      await eduAttachLooseAppointments(tx, {
        institutionId,
        patientId: partes.patientId,
        studentId: partes.studentId,
        caseId: caso.id,
        // El tamizaje se queda fuera: es la valoración ANTERIOR al caso, y
        // la que abrió ESTE caso ya se enganchó arriba por su id.
        includeTamizaje: false,
      });
    }

    await tx.eduPatient.updateMany({
      where: { id: partes.patientId, institutionId, status: { in: ["NEW", "INACTIVE", "DISCHARGED"] } },
      data: { status: "ACTIVE" },
    });

    return caso;
  });

  return created;
}

/**
 * Cambia el estado, el supervisor o las notas de un caso.
 *
 * 🔴 `closedAt` se DERIVA del estado y no se captura: así no puede existir
 * un caso "terminado" sin fecha de cierre ni una fecha de cierre en un caso
 * que sigue vivo. Reabrir (el paciente volvió) limpia la fecha — no se
 * borra nada, y el caso vuelve a contar como abierto.
 *
 * 🔴 El ALUMNO del caso NO se cambia aquí. Cambiar de alumno es
 * TRANSFERRED + un caso nuevo: si se pudiera reescribir el `studentId`, se
 * borraría la respuesta a "¿quién lo atendía en marzo?", que es
 * exactamente la pregunta que se hace cuando algo sale mal. Es la misma
 * regla que la supervisión de la Ola 1A, que se cierra en vez de editarse.
 *
 * 🔴 OLA 4 — AQUÍ VIVE EL GATE. Pasar a "en tratamiento" exige el PLAN
 * autorizado y pasar a "terminado" exige el ALTA autorizada; los dos se
 * comprueban DENTRO de la transacción (ver el bloque marcado más abajo).
 * Un caso trabado no impide escribir el expediente: lo que no avanza es el
 * TRATAMIENTO.
 */
export async function updateEduCase(
  ctx: EduClinicaContext,
  caseId: string,
  input: {
    status?: unknown;
    supervisorUserId?: unknown;
    notes?: unknown;
    /** Ola 6: el procedimiento principal, que es lo que hace contable un
     *  requisito del plan de estudios. SÍ se puede corregir —a diferencia
     *  del alumno— porque en el tamizaje todavía no se sabía. */
    procedureId?: unknown;
  },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) throw new EduPadronError("Ese caso no es de este instituto.", 404);

  const id = eduCleanId(caseId);
  if (!id) throw new EduPadronError("Ese caso no es de este instituto.", 404);

  // Se busca DENTRO del alcance: un caso que no le toca a quien pregunta se
  // ve igual que uno que no existe.
  const current = await prisma.eduCase.findFirst({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, status: true, patientId: true, closedAt: true },
  });
  if (!current) throw new EduPadronError("Ese caso no es de este instituto.", 404);

  const data: {
    status?: EduCaseStatus;
    closedAt?: Date | null;
    supervisorUserId?: string | null;
    notes?: string | null;
    procedureId?: string | null;
  } = {};

  if (input.status !== undefined) {
    const st = parseEduCaseStatus(input.status);
    if (!st) throw new EduPadronError("Ese estado de caso no existe.");
    if (st === current.status) throw new EduPadronError("El caso ya estaba en ese estado.");
    data.status = st;
    data.closedAt = (EDU_CASE_CLOSED_STATUSES as string[]).includes(st)
      ? (current.closedAt ?? now)
      : null;
  }

  if (input.supervisorUserId !== undefined) {
    if (input.supervisorUserId === null || input.supervisorUserId === "") {
      data.supervisorUserId = null;
    } else {
      const supId = eduCleanId(input.supervisorUserId);
      const sup = supId
        ? await prisma.eduUser.findFirst({
            where: { id: supId, institutionId, role: "DOCENTE" },
            select: { id: true, isActive: true },
          })
        : null;
      if (!sup) throw new EduPadronError("Ese docente no es de este instituto.", 404);
      if (!sup.isActive) throw new EduPadronError("Ese docente está dado de baja.");
      data.supervisorUserId = sup.id;
    }
  }

  if (input.notes !== undefined) {
    data.notes = eduOptionalText(input.notes, 1000) ?? null;
  }

  if (input.procedureId !== undefined) {
    data.procedureId = (await resolveProcedureId(institutionId, input.procedureId)) ?? null;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.$transaction(async (tx) => {
    // ═══════════════════════════════════════════════════════════════════
    // 🔴 OLA 4 — EL GATE. Aquí es donde el vertical deja de ser una
    // clínica y pasa a ser una escuela.
    //
    // Va DENTRO de la transacción y en ESTA función, no en el endpoint,
    // por dos razones que se pagan caras al revés:
    //   · TODO camino que mueva un caso pasa por `updateEduCase`. Si el
    //     gate viviera en /api/instituto/casos/[id], el segundo endpoint
    //     que mueva un caso —el de una ola futura— nacería sin él y
    //     funcionaría perfectamente. Para todo el mundo.
    //   · Comprobarlo fuera de la transacción dejaría una ventana entre
    //     "sí puede avanzar" y el UPDATE.
    //
    // Solo se gatean DOS avances (a "en tratamiento" y a "terminado");
    // pausar, transferir y dar por abandonado pasan sin firma, porque
    // pedir permiso para PARAR es cómo se consigue que nadie registre que
    // paró. La lista vive en autorizaciones-core.ts.
    //
    // ⚠️ Y lo que este gate NO toca: el expediente. El alumno sigue
    // pudiendo escribir y firmar notas de todo lo que hizo aunque el caso
    // esté trabado — la NOM-004 pide nota por cada acto, y un expediente
    // incompleto es peor que un caso sin autorizar.
    // ═══════════════════════════════════════════════════════════════════
    if (data.status) {
      const verdict = await eduCaseGateCheck(tx, institutionId, current.id, data.status);
      if (!verdict.ok) throw new EduPadronError(verdict.detail, 409);
    }

    await tx.eduCase.update({ where: { id: current.id }, data });

    // Si al paciente no le queda ningún caso abierto, deja de estar "en
    // tratamiento". Se recalcula DENTRO de la transacción y contando de
    // verdad, no restando uno: un paciente con tres casos que cierra uno
    // sigue en tratamiento.
    if (data.status) {
      const abiertos = await tx.eduCase.count({
        where: {
          institutionId,
          patientId: current.patientId,
          status: { notIn: EDU_CASE_CLOSED_STATUSES },
        },
      });
      await tx.eduPatient.updateMany({
        where: { id: current.patientId, institutionId, status: { not: "INACTIVE" } },
        data: { status: abiertos > 0 ? "ACTIVE" : "DISCHARGED" },
      });
    }
  });

  return { id: current.id };
}

// ═══════════════════════════════════════════════════════════════════════
// EL TAMIZAJE
// ═══════════════════════════════════════════════════════════════════════

export interface EduTamizajeInput {
  /** La cita de tamizaje. Si viene, de ella sale el paciente. */
  appointmentId?: unknown;
  /** …o el paciente directo, cuando la valoración no pasó por la agenda. */
  patientId?: unknown;
  studentId?: unknown;
  programId?: unknown;
  supervisorUserId?: unknown;
  notes?: unknown;
  /** Ola 6: si en la valoración ya se sabe qué se le va a hacer. */
  procedureId?: unknown;
}

/**
 * LA VALORACIÓN INICIAL: asigna el paciente a un alumno y abre su caso.
 *
 * Es la puerta de entrada de la clínica de la escuela. Se puede llegar
 * desde una cita de tamizaje (lo normal: el paciente ya está sentado) o
 * directamente desde un paciente registrado, porque la valoración a veces
 * ocurre en el pasillo y obligar a agendarla primero haría que nadie la
 * registrara.
 *
 * 🔴 El paciente sale de la CITA cuando hay cita, no del body. Si se
 * aceptaran los dos y no coincidieran, se abriría el caso de una persona
 * con la valoración de otra.
 */
export async function runEduTamizaje(
  ctx: EduClinicaContext,
  input: EduTamizajeInput,
  now: Date = new Date(),
): Promise<{ id: string; patientId: string }> {
  const institutionId = requireInstitution(ctx);

  let patientId: string | null = null;
  let screeningAppointmentId: string | null = null;

  if (input.appointmentId !== undefined && input.appointmentId !== null && input.appointmentId !== "") {
    const id = eduCleanId(input.appointmentId);
    const cita = id
      ? await prisma.eduAppointment.findFirst({
          where: { id, institutionId },
          select: { id: true, patientId: true, type: true, status: true },
        })
      : null;
    if (!cita) throw new EduPadronError("Esa cita no es de este instituto.", 404);
    if (cita.type !== "TAMIZAJE") {
      throw new EduPadronError("Esa cita no es de tamizaje. El tamizaje se hace sobre una valoración inicial.");
    }
    if (cita.status === "CANCELLED" || cita.status === "NO_SHOW") {
      throw new EduPadronError("Esa valoración se canceló o el paciente no llegó. Agenda otra.", 409);
    }
    patientId = cita.patientId;
    screeningAppointmentId = cita.id;
  } else {
    patientId = eduCleanId(input.patientId);
  }

  if (!patientId) {
    throw new EduPadronError("Elige el paciente al que le hiciste la valoración.", 400);
  }

  // Sin envolver esto en otra transacción: `createEduCase` ya abre la suya
  // (el caso y el estado del paciente se escriben juntos o no se escriben).
  // Una transacción de fuera que llamara con el cliente global no metería
  // nada dentro y solo dejaría una conexión abierta de más.
  const caso = await createEduCase(
    ctx,
    {
      patientId,
      studentId: input.studentId,
      programId: input.programId,
      supervisorUserId: input.supervisorUserId,
      notes: input.notes,
      screeningAppointmentId,
      procedureId: input.procedureId,
    },
    now,
  );
  return { id: caso.id, patientId };
}

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA GLOBAL DE CASOS (ola de Casos)
// ═══════════════════════════════════════════════════════════════════════

export type {
  EduCasosPanelFilters,
  EduCasosPanelPage,
  EduCasosPanelRow,
} from "@/lib/edu/casos-core";

/**
 * TODOS los casos que le tocan a quien pregunta, con lo que la lista
 * global necesita y `EduCaseRow` no trae: la GENERACIÓN del alumno y QUÉ
 * ESTÁ ESPERANDO el caso (derivado de sus autorizaciones).
 *
 * Es una función APARTE de `listEduCases` a propósito: aquélla alimenta la
 * ficha y la agenda con una fila más ligera, y ensancharla habría hecho
 * viajar las autorizaciones de cada caso a pantallas que no las piden.
 *
 * 🔴 El recorte es el de SIEMPRE (`eduCaseScopeWhere`): el ALUMNO ve los
 * suyos —incluidos los TRANSFERRED, que son su historia académica—, el
 * DOCENTE los de sus alumnos vigentes, DIRECCIÓN todos y CAJA ninguno
 * (alcance "none", aunque alguien le encienda "casos.view" por error).
 *
 * 🔴 El buscador solo mira los DOS searchIndex de la Ola 1B (el del
 * paciente: folio+nombre+teléfono+correo; el del alumno: la matrícula) —
 * ya en minúsculas, sin acentos y con los comodines de LIKE quitados por
 * eduSearchTokens. Buscar "Rodriguez" encuentra a "Rodríguez".
 */
export async function listEduCasosPanel(
  ctx: EduClinicaContext,
  filters: EduCasosPanelFilters,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduCasosPanelPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const where = eduCasosPanelWhere(institutionId, scope, filters, timeZone, now);
  const tz = eduSafeTimeZone(timeZone);

  const rows = await prisma.eduCase.findMany({
    where,
    orderBy: CASOS_PANEL_ORDER,
    take: EDU_CLINICA_MAX_ROWS + 1,
    select: CASOS_PANEL_SELECT,
  });

  return {
    truncated: rows.length > EDU_CLINICA_MAX_ROWS,
    rows: rows.slice(0, EDU_CLINICA_MAX_ROWS).map((c) => toCasoPanelRow(c, tz)),
  };
}

/**
 * LOS MISMOS casos, para un CSV, con el tope del EXPORT.
 *
 * 🔴 NO ES UNA SEGUNDA CONSULTA: comparte `where`, `orderBy` y `select`
 * con la pantalla, línea por línea. Un endpoint de descarga con su propia
 * consulta es la puerta de atrás clásica — se audita la pantalla, se
 * arregla el alcance de la pantalla, y el CSV sigue entregando lo de
 * antes. Lo único que cambia es CUÁNTO cabe y cómo se lee.
 *
 * Se lee EN LOTES con cursor (`EDU_CASOS_EXPORT_BATCH`), no con un `take`
 * de diez mil: ver EDU_CASOS_EXPORT_MAX_ROWS en casos-core.ts.
 *
 * ⚠️ EL CURSOR NECESITA UN ORDEN TOTAL. `openedAt` empata — dos casos
 * abiertos el mismo instante existen — y con un orden que empata, Postgres
 * puede devolver el mismo caso en dos lotes y saltarse otro. Por eso
 * `CASOS_PANEL_ORDER` lleva el `id` de desempate: es único, así que el
 * orden es total y la paginación no puede duplicar ni perder una fila. La
 * pantalla usa el MISMO orden, para que el CSV y la lista no salgan
 * barajados distinto.
 */
export async function listEduCasosParaExport(
  ctx: EduClinicaContext,
  filters: EduCasosPanelFilters,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduCasosPanelPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const where = eduCasosPanelWhere(institutionId, scope, filters, timeZone, now);
  const tz = eduSafeTimeZone(timeZone);

  const acumulado: EduCasosPanelRow[] = [];
  let cursor: string | null = null;

  // Se pide UNA de más que el tope (igual que en la pantalla) para poder
  // distinguir "caben justo" de "hay más".
  while (acumulado.length <= EDU_CASOS_EXPORT_MAX_ROWS) {
    const falta = EDU_CASOS_EXPORT_MAX_ROWS + 1 - acumulado.length;
    const lote: CasoPanelPayload[] = await prisma.eduCase.findMany({
      where,
      orderBy: CASOS_PANEL_ORDER,
      take: Math.min(EDU_CASOS_EXPORT_BATCH, falta),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: CASOS_PANEL_SELECT,
    });
    if (lote.length === 0) break;
    for (const c of lote) acumulado.push(toCasoPanelRow(c, tz));
    cursor = lote[lote.length - 1].id;
    // Un lote corto significa que ya no hay más: pedir otro sería un viaje
    // garantizado a vacío en el caso normal (menos de 500 casos).
    if (lote.length < Math.min(EDU_CASOS_EXPORT_BATCH, falta)) break;
  }

  return {
    truncated: acumulado.length > EDU_CASOS_EXPORT_MAX_ROWS,
    rows: acumulado.slice(0, EDU_CASOS_EXPORT_MAX_ROWS),
  };
}

/**
 * El `where` de la pantalla de casos. Vive aparte porque lo comparten la
 * lista y el export, y dos copias es como se acaba con un CSV que entrega
 * filas que la pantalla no enseña.
 */
function eduCasosPanelWhere(
  institutionId: string,
  scope: ReturnType<typeof eduVisibility>,
  filters: EduCasosPanelFilters,
  timeZone: string,
  now: Date,
): Prisma.EduCaseWhereInput {
  const where: Prisma.EduCaseWhereInput = {
    ...eduCaseScopeWhere({
      institutionId,
      scope,
      now,
      studentExtra: filters.studentId ? { id: filters.studentId } : undefined,
    }),
  };

  if (filters.status) where.status = filters.status;
  else if (!filters.incluirCerrados) where.status = { notIn: EDU_CASE_CLOSED_STATUSES };
  if (filters.programId) where.programId = filters.programId;
  if (filters.supervisorUserId) where.supervisorUserId = filters.supervisorUserId;

  const tz = eduSafeTimeZone(timeZone);
  const and: Prisma.EduCaseWhereInput[] = [];

  // Las fechas son días de CALENDARIO del instituto: se convierten a
  // instantes con eduDayRange (extremo derecho EXCLUSIVO — un caso abierto
  // a las 23:59 del "hasta" cuenta; uno de las 00:00 del día siguiente no).
  if (filters.desdeISO) {
    const r = eduDayRange(filters.desdeISO, tz);
    if (r) and.push({ openedAt: { gte: r.from } });
  }
  if (filters.hastaISO) {
    const r = eduDayRange(filters.hastaISO, tz);
    if (r) and.push({ openedAt: { lt: r.to } });
  }

  // El buscador: cada palabra tiene que aparecer en el índice del paciente
  // O en el del alumno (la matrícula). El AND entre palabras es lo que hace
  // que "maria lopez" no traiga a todas las Marías.
  for (const token of eduSearchTokens(filters.q)) {
    const or: Prisma.EduCaseWhereInput[] = [
      { patient: { searchIndex: { contains: token } } },
      { student: { searchIndex: { contains: token } } },
    ];
    const digits = eduPhoneSearchToken(token);
    if (digits && digits !== token) {
      or.push({ patient: { searchIndex: { contains: digits } } });
    }
    and.push({ OR: or });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

/** El orden de la lista de casos. Lo comparten pantalla y export, y lleva
 *  desempate por `id` para que el cursor del export sea total. */
const CASOS_PANEL_ORDER: Prisma.EduCaseOrderByWithRelationInput[] = [
  { openedAt: "desc" },
  { id: "desc" },
];

const CASOS_PANEL_SELECT = {
  id: true,
  status: true,
  openedAt: true,
  closedAt: true,
  supervisorUserId: true,
  patient: { select: { id: true, folio: true, firstName: true, lastName: true } },
  student: {
    select: {
      id: true,
      matricula: true,
      semester: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      cohort: { select: { name: true } },
    },
  },
  program: { select: { name: true } },
  supervisor: { select: { firstName: true, lastName: true, email: true } },
  // Solo lo que la columna "esperando" necesita: PENDING y APPROVED.
  // Las CHANGES_REQUESTED/REJECTED/EXPIRED no cambian la espera y
  // engordarían el payload de cada fila.
  approvals: {
    where: { status: { in: ["PENDING", "APPROVED"] } },
    select: { stage: true, status: true },
  },
} satisfies Prisma.EduCaseSelect;

type CasoPanelPayload = Prisma.EduCaseGetPayload<{ select: typeof CASOS_PANEL_SELECT }>;

function toCasoPanelRow(c: CasoPanelPayload, tz: string): EduCasosPanelRow {
  const abierto = eduUtcToZoned(c.openedAt, tz).dayISO;
  return {
    id: c.id,
    status: c.status,
    statusLabel: EDU_CASE_STATUS_LABELS[c.status] ?? c.status,
    patientId: c.patient.id,
    patientName:
      [c.patient.firstName, c.patient.lastName].filter(Boolean).join(" ").trim() || "Sin nombre",
    patientFolio: c.patient.folio,
    studentId: c.student.id,
    studentName: personName(c.student.user),
    studentMatricula: c.student.matricula,
    supervisorName: c.supervisor ? personName(c.supervisor) : null,
    programName: c.program.name,
    cohortName: c.student.cohort?.name ?? null,
    semester: c.student.semester,
    openedISO: abierto,
    openedLabel: eduFormatDayShort(abierto),
    closedLabel: c.closedAt ? eduFormatDayShort(eduUtcToZoned(c.closedAt, tz).dayISO) : null,
    espera: eduCasoEsperando(c.status, c.approvals),
  };
}
