/**
 * DaleControl INSTITUCIONAL — el padrón contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client" (se
 * arrastraría el runtime de Prisma al navegador). Lo puro y compartible
 * vive en padron-core.ts; aquí solo hay consultas.
 *
 * 🔴 REGLA DE ORO DE ESTE ARCHIVO: TODA función recibe el contexto de
 * sesión y saca de ahí el institutionId. Ninguna lo acepta como parámetro
 * suelto, ninguna lo lee de un body. Si alguna vez ves un `institutionId`
 * en la firma de una función nueva de aquí, es un bug de tenant esperando
 * a que lo llamen con el id equivocado.
 *
 * Las escrituras NO comprueban permisos: eso lo hace el endpoint con
 * assertEduPermission antes de llamar. Aquí se comprueba la PERTENENCIA
 * (que el alumno, el programa y la generación sean de ESTE instituto), que
 * es lo que un permiso no puede saber.
 */
import { prisma } from "@/lib/prisma";
import type { EduRole, EduStudentStatus } from "@/lib/edu/types";
import {
  EDU_PADRON_MAX_ROWS,
  eduCurrentAssignmentWhere,
  eduPadronPagina,
  eduPadronScope,
  eduRequiredText,
  eduStudentWhere,
  normalizeEduMatricula,
  normalizeEduProgramCode,
  parseEduBoolean,
  parseEduCalendarDate,
  parseEduDurationSemesters,
  parseEduSemester,
  parseEduStudentStatus,
  // Ola 1B — el índice sin acentos del alumno. Se reexporta desde
  // padron-core (vive en src/lib/edu/search.ts) para que el alta y la
  // edición no puedan escribir dos índices distintos.
  eduStudentSearchIndex,
  type EduAssignmentRow,
  type EduCohortRow,
  type EduEnrollableUser,
  type EduPadronFilters,
  type EduPadronPage,
  type EduProgramRow,
  type EduStudentRow,
  type EduTeacherRow,
} from "@/lib/edu/padron-core";

/**
 * Las formas que viajan a la pantalla se DEFINEN en padron-core.ts (puro) y
 * se reexportan aquí por comodidad de quien ya importa de este archivo. Un
 * componente cliente tiene que importarlas del core, no de aquí.
 */
export type {
  EduAssignmentRow,
  EduCohortRow,
  EduEnrollableUser,
  EduPadronPage,
  EduProgramRow,
  EduStudentRow,
  EduSupervisorRow,
  EduTeacherRow,
} from "@/lib/edu/padron-core";

/** Lo mínimo de la sesión que necesita este archivo (subconjunto de
 *  EduContext, para poder llamarlo desde una prueba sin fabricar el resto). */
export interface EduPadronContext {
  institutionId: string;
  eduUserId: string;
  role: EduRole;
}

/**
 * Error con código HTTP. Los endpoints lo mapean tal cual, así que el
 * mensaje se le enseña a una persona: se escribe en español y dice qué
 * hacer, no qué falló por dentro.
 */
export class EduPadronError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EduPadronError";
    this.status = status;
  }
}

function requireInstitution(ctx: EduPadronContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    // No debería pasar nunca (el layout ya exigió sesión), pero un throw
    // aquí es infinitamente mejor que un where sin tenant.
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function fullName(u: { firstName: string; lastName: string; email?: string }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email || "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * El padrón que le toca a QUIEN pregunta.
 *
 * El alcance se resuelve aquí dentro (eduPadronScope) y no se acepta como
 * parámetro: si se pudiera pasar, alguien acabaría pasando `{kind:"all"}`
 * desde un endpoint y el recorte del docente dejaría de existir.
 */
export async function listEduStudents(
  ctx: EduPadronContext,
  filters: EduPadronFilters,
  now: Date = new Date(),
): Promise<EduPadronPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduPadronScope(ctx);

  // 🔴 H-106 · LA PÁGINA. El padrón se cortaba en 300 filas sin salida: los
  // alumnos a partir del 301 —los de matrícula más alta, es decir los de la
  // generación más nueva— no se podían alcanzar más que adivinando un filtro.
  // El orden es por matrícula ASCENDENTE y es único por instituto, así que el
  // OFFSET es estable: no hay filas que se repitan ni que se salten entre una
  // página y la siguiente.
  const page = eduPadronPagina(filters.page);

  // Sin alcance no se consulta nada. La pantalla explica por qué.
  if (scope.kind === "none") return { rows: [], scope, truncated: false, page };

  const rows = await prisma.eduStudent.findMany({
    where: eduStudentWhere({ institutionId, scope, filters, now }),
    orderBy: [{ matricula: "asc" }],
    skip: (page - 1) * EDU_PADRON_MAX_ROWS,
    take: EDU_PADRON_MAX_ROWS + 1,
    select: {
      id: true,
      matricula: true,
      semester: true,
      status: true,
      enrolledAt: true,
      graduatedAt: true,
      userId: true,
      programId: true,
      cohortId: true,
      user: { select: { firstName: true, lastName: true, email: true, isActive: true } },
      program: { select: { name: true, code: true } },
      cohort: { select: { name: true } },
      supervisors: {
        where: { institutionId, ...eduCurrentAssignmentWhere(now) },
        orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
        select: {
          id: true,
          supervisorUserId: true,
          isPrimary: true,
          startsAt: true,
          supervisor: { select: { firstName: true, lastName: true, email: true } },
        },
      },
      // H-101 · Lo que queda colgando si se le da de baja. Viaja con la
      // fila y no en una consulta aparte por alumno: la pantalla necesita
      // el número en el momento en que se abre el modal, y 300 consultas
      // sueltas para pintar una tabla saturarían el pooler.
      _count: {
        select: {
          cases: { where: { status: { in: ["SCREENING", "ASSIGNED", "IN_TREATMENT", "ON_HOLD"] } } },
          appointments: {
            where: { startsAt: { gte: now }, status: { in: ["SCHEDULED", "CHECKED_IN"] } },
          },
        },
      },
    },
  });

  const truncated = rows.length > EDU_PADRON_MAX_ROWS;

  return {
    scope,
    truncated,
    page,
    rows: rows.slice(0, EDU_PADRON_MAX_ROWS).map((s) => ({
      id: s.id,
      matricula: s.matricula,
      semester: s.semester,
      status: s.status as EduStudentStatus,
      enrolledAt: s.enrolledAt.toISOString(),
      graduatedAt: iso(s.graduatedAt),
      userId: s.userId,
      name: fullName(s.user),
      email: s.user.email,
      userIsActive: s.user.isActive,
      programId: s.programId,
      programName: s.program.name,
      programCode: s.program.code,
      cohortId: s.cohortId,
      cohortName: s.cohort.name,
      casosAbiertos: s._count.cases,
      citasFuturas: s._count.appointments,
      supervisors: s.supervisors.map((a) => ({
        assignmentId: a.id,
        supervisorUserId: a.supervisorUserId,
        name: fullName(a.supervisor),
        isPrimary: a.isPrimary,
        startsAt: a.startsAt.toISOString(),
      })),
    })),
  };
}

/** Programas del instituto, con cuántas generaciones y alumnos tienen. */
export async function listEduPrograms(ctx: EduPadronContext): Promise<EduProgramRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduProgram.findMany({
    where: { institutionId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      durationSemesters: true,
      isActive: true,
      _count: { select: { cohorts: true, students: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    durationSemesters: p.durationSemesters,
    isActive: p.isActive,
    cohorts: p._count.cohorts,
    students: p._count.students,
  }));
}

/** Generaciones del instituto, con su programa y cuántos alumnos tienen. */
export async function listEduCohorts(ctx: EduPadronContext): Promise<EduCohortRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduCohort.findMany({
    where: { institutionId },
    // La más reciente primero: es la que se está usando.
    orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      isActive: true,
      programId: true,
      program: { select: { name: true, code: true } },
      _count: { select: { students: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    programId: c.programId,
    programName: c.program.name,
    programCode: c.program.code,
    startDate: c.startDate.toISOString(),
    endDate: iso(c.endDate),
    isActive: c.isActive,
    students: c._count.students,
  }));
}

/**
 * Docentes del instituto y cuántos alumnos lleva cada uno HOY.
 *
 * El conteo va filtrado por vigencia: sin ese `where`, un docente que
 * entregó su generación hace dos años seguiría apareciendo con 12 alumnos
 * y la dirección repartiría mal la carga.
 */
export async function listEduTeachers(
  ctx: EduPadronContext,
  now: Date = new Date(),
): Promise<EduTeacherRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduUser.findMany({
    where: { institutionId, role: "DOCENTE" },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      isActive: true,
      _count: {
        select: {
          supervisees: { where: { institutionId, ...eduCurrentAssignmentWhere(now) } },
        },
      },
    },
  });
  return rows.map((u) => ({
    id: u.id,
    name: fullName(u),
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    currentStudents: u._count.supervisees,
  }));
}

/**
 * TODAS las asignaciones vigentes del instituto, de una sola consulta.
 *
 * La pantalla de docentes las agrupa en memoria en vez de pedir una
 * consulta por docente: veinte docentes son veinte viajes a la base para
 * pintar una lista que cabe en una pantalla.
 *
 * `supervisorUserId` opcional acota a un solo docente.
 */
export async function listEduCurrentAssignments(
  ctx: EduPadronContext,
  now: Date = new Date(),
  supervisorUserId?: string,
): Promise<EduAssignmentRow[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduSupervisorAssignment.findMany({
    where: {
      institutionId,
      ...(supervisorUserId ? { supervisorUserId } : {}),
      ...eduCurrentAssignmentWhere(now),
    },
    orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
    take: EDU_PADRON_MAX_ROWS,
    select: {
      id: true,
      isPrimary: true,
      supervisorUserId: true,
      student: {
        select: {
          id: true,
          matricula: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  return rows.map((a) => ({
    assignmentId: a.id,
    supervisorUserId: a.supervisorUserId,
    studentId: a.student.id,
    matricula: a.student.matricula,
    name: fullName(a.student.user),
    isPrimary: a.isPrimary,
  }));
}

/**
 * Personas con rol ALUMNO que todavía NO tienen ficha académica.
 *
 * Inscribir es colgarle matrícula, especialidad y generación a una persona
 * que YA tiene cuenta. Si esta lista sale vacía, lo que falta es dar de
 * alta a la persona — y desde la Ola 1B eso sí se puede hacer desde el
 * panel, en /instituto/equipo (el diálogo de inscripción manda ahí en vez
 * de dejar a quien lo abrió en un callejón sin salida).
 */
export async function listEduEnrollableUsers(ctx: EduPadronContext): Promise<EduEnrollableUser[]> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduUser.findMany({
    where: { institutionId, role: "ALUMNO", isActive: true, studentProfile: { is: null } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: EDU_PADRON_MAX_ROWS,
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return rows.map((u) => ({ id: u.id, name: fullName(u), email: u.email }));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS · PROGRAMAS
// ═══════════════════════════════════════════════════════════════════════

export async function createEduProgram(
  ctx: EduPadronContext,
  input: { name?: unknown; code?: unknown; durationSemesters?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const name = eduRequiredText(input.name, 120);
  if (!name) throw new EduPadronError("El nombre de la especialidad es obligatorio (máximo 120 caracteres).");

  const code = normalizeEduProgramCode(input.code);
  if (!code) throw new EduPadronError("La clave de la especialidad es obligatoria (máximo 20 caracteres, sin espacios).");

  const durationSemesters =
    input.durationSemesters === undefined || input.durationSemesters === null || input.durationSemesters === ""
      ? 6
      : parseEduDurationSemesters(input.durationSemesters);
  if (!durationSemesters) throw new EduPadronError("La duración tiene que ser un número de semestres entre 1 y 20.");

  const dup = await prisma.eduProgram.findFirst({
    where: { institutionId, code },
    select: { id: true, name: true },
  });
  if (dup) throw new EduPadronError(`La clave ${code} ya la usa la especialidad "${dup.name}".`, 409);

  const created = await prisma.eduProgram.create({
    data: { institutionId, name, code, durationSemesters },
    select: { id: true },
  });
  return created;
}

export async function updateEduProgram(
  ctx: EduPadronContext,
  programId: string,
  input: { name?: unknown; code?: unknown; durationSemesters?: unknown; isActive?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const current = await prisma.eduProgram.findFirst({
    where: { id: programId, institutionId },
    select: { id: true },
  });
  if (!current) throw new EduPadronError("Esa especialidad no es de este instituto.", 404);

  const data: {
    name?: string;
    code?: string;
    durationSemesters?: number;
    isActive?: boolean;
  } = {};

  if (input.name !== undefined) {
    const name = eduRequiredText(input.name, 120);
    if (!name) throw new EduPadronError("El nombre de la especialidad es obligatorio (máximo 120 caracteres).");
    data.name = name;
  }
  if (input.code !== undefined) {
    const code = normalizeEduProgramCode(input.code);
    if (!code) throw new EduPadronError("La clave de la especialidad es obligatoria (máximo 20 caracteres, sin espacios).");
    const dup = await prisma.eduProgram.findFirst({
      where: { institutionId, code, NOT: { id: programId } },
      select: { name: true },
    });
    if (dup) throw new EduPadronError(`La clave ${code} ya la usa la especialidad "${dup.name}".`, 409);
    data.code = code;
  }
  if (input.durationSemesters !== undefined) {
    const d = parseEduDurationSemesters(input.durationSemesters);
    if (!d) throw new EduPadronError("La duración tiene que ser un número de semestres entre 1 y 20.");
    data.durationSemesters = d;
  }
  if (input.isActive !== undefined) {
    const b = parseEduBoolean(input.isActive);
    if (b === null) throw new EduPadronError("El estado de la especialidad tiene que ser verdadero o falso.");
    data.isActive = b;
  }

  // 🔴 updateMany/update con data vacío no falla: escribe nada y devuelve
  // "ok". El endpoint parecería funcionar y no cambiaría absolutamente
  // nada, que es la clase de bug que se busca durante una tarde entera.
  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduProgram.update({ where: { id: programId }, data });
  return { id: programId };
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS · GENERACIONES
// ═══════════════════════════════════════════════════════════════════════

export async function createEduCohort(
  ctx: EduPadronContext,
  input: { programId?: unknown; name?: unknown; startDate?: unknown; endDate?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const programId = typeof input.programId === "string" ? input.programId : "";
  const program = programId
    ? await prisma.eduProgram.findFirst({ where: { id: programId, institutionId }, select: { id: true } })
    : null;
  if (!program) throw new EduPadronError("Elige una especialidad de este instituto.", 400);

  const name = eduRequiredText(input.name, 60);
  if (!name) throw new EduPadronError("El nombre de la generación es obligatorio (máximo 60 caracteres).");

  const startDate = parseEduCalendarDate(input.startDate);
  if (!startDate) throw new EduPadronError("La fecha de inicio es obligatoria (formato AAAA-MM-DD).");

  const endDate =
    input.endDate === undefined || input.endDate === null || input.endDate === ""
      ? null
      : parseEduCalendarDate(input.endDate);
  if (input.endDate && !endDate) throw new EduPadronError("La fecha de fin no es una fecha válida (AAAA-MM-DD).");
  if (endDate && endDate.getTime() < startDate.getTime()) {
    throw new EduPadronError("La generación no puede terminar antes de empezar.");
  }

  const dup = await prisma.eduCohort.findFirst({
    where: { institutionId, programId: program.id, name },
    select: { id: true },
  });
  if (dup) throw new EduPadronError(`Esa especialidad ya tiene una generación llamada "${name}".`, 409);

  return prisma.eduCohort.create({
    data: { institutionId, programId: program.id, name, startDate, endDate },
    select: { id: true },
  });
}

export async function updateEduCohort(
  ctx: EduPadronContext,
  cohortId: string,
  input: { name?: unknown; startDate?: unknown; endDate?: unknown; isActive?: unknown },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const current = await prisma.eduCohort.findFirst({
    where: { id: cohortId, institutionId },
    select: { id: true, programId: true, startDate: true, endDate: true },
  });
  if (!current) throw new EduPadronError("Esa generación no es de este instituto.", 404);

  const data: { name?: string; startDate?: Date; endDate?: Date | null; isActive?: boolean } = {};

  if (input.name !== undefined) {
    const name = eduRequiredText(input.name, 60);
    if (!name) throw new EduPadronError("El nombre de la generación es obligatorio (máximo 60 caracteres).");
    const dup = await prisma.eduCohort.findFirst({
      where: { institutionId, programId: current.programId, name, NOT: { id: cohortId } },
      select: { id: true },
    });
    if (dup) throw new EduPadronError(`Esa especialidad ya tiene una generación llamada "${name}".`, 409);
    data.name = name;
  }
  if (input.startDate !== undefined) {
    const d = parseEduCalendarDate(input.startDate);
    if (!d) throw new EduPadronError("La fecha de inicio no es una fecha válida (AAAA-MM-DD).");
    data.startDate = d;
  }
  if (input.endDate !== undefined) {
    if (input.endDate === null || input.endDate === "") data.endDate = null;
    else {
      const d = parseEduCalendarDate(input.endDate);
      if (!d) throw new EduPadronError("La fecha de fin no es una fecha válida (AAAA-MM-DD).");
      data.endDate = d;
    }
  }
  if (input.isActive !== undefined) {
    const b = parseEduBoolean(input.isActive);
    if (b === null) throw new EduPadronError("El estado de la generación tiene que ser verdadero o falso.");
    data.isActive = b;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  const start = data.startDate ?? current.startDate;
  const end = data.endDate !== undefined ? data.endDate : current.endDate;
  if (end && end.getTime() < start.getTime()) {
    throw new EduPadronError("La generación no puede terminar antes de empezar.");
  }

  await prisma.eduCohort.update({ where: { id: cohortId }, data });
  return { id: cohortId };
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS · ALUMNOS
// ═══════════════════════════════════════════════════════════════════════

/** Comprueba que el programa y la generación sean de este instituto Y que
 *  la generación sea DE ese programa. Sin lo segundo, un alumno acabaría en
 *  la "2026-A" de Ortodoncia estando inscrito en Endodoncia. */
async function resolvePair(
  institutionId: string,
  programId: string,
  cohortId: string,
  // H-109 · Solo se exige "activa" cuando el par CAMBIA. Un alumno que ya
  // está inscrito en una especialidad que después se cerró tiene que poder
  // seguir editándose (su semestre, su matrícula, su estado): la regla es
  // "no se inscribe en lo cerrado", no "lo cerrado se congela".
  exigirActiva = true,
): Promise<void> {
  // El programa se comprueba PRIMERO: si faltan los dos, el mensaje útil
  // es "elige un programa", que es el primer campo del formulario.
  const program = await prisma.eduProgram.findFirst({
    where: { id: programId, institutionId },
    select: { id: true, isActive: true, name: true },
  });
  if (!program) throw new EduPadronError("Elige una especialidad de este instituto.", 400);
  // 🔴 H-109 · La pantalla solo ofrece las ACTIVAS (padron-screen.tsx:413) y
  // el servidor las aceptaba todas: una regla que existía en un solo lado, y
  // el lado que no es el candado. Un id copiado de un enlace viejo inscribía
  // en una especialidad cerrada.
  if (exigirActiva && !program.isActive) {
    throw new EduPadronError(
      `La especialidad ${program.name} está desactivada: no se puede inscribir a nadie en ella. Actívala primero en Estructura.`,
    );
  }
  const cohort = await prisma.eduCohort.findFirst({
    where: { id: cohortId, institutionId },
    select: { programId: true, isActive: true, name: true },
  });
  if (!cohort) throw new EduPadronError("Elige una generación de este instituto.", 400);
  if (cohort.programId !== programId) {
    throw new EduPadronError("Esa generación no pertenece a la especialidad que elegiste.");
  }
  if (exigirActiva && !cohort.isActive) {
    throw new EduPadronError(
      `La generación ${cohort.name} está cerrada: no se puede inscribir a nadie en ella. Ábrela primero en Estructura.`,
    );
  }
}

export async function createEduStudent(
  ctx: EduPadronContext,
  input: {
    userId?: unknown;
    programId?: unknown;
    cohortId?: unknown;
    matricula?: unknown;
    semester?: unknown;
  },
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const userId = typeof input.userId === "string" ? input.userId : "";
  const programId = typeof input.programId === "string" ? input.programId : "";
  const cohortId = typeof input.cohortId === "string" ? input.cohortId : "";

  const matricula = normalizeEduMatricula(input.matricula);
  if (!matricula) throw new EduPadronError("La matrícula es obligatoria (máximo 30 caracteres).");

  const semester =
    input.semester === undefined || input.semester === null || input.semester === ""
      ? 1
      : parseEduSemester(input.semester);
  if (!semester) throw new EduPadronError("El semestre tiene que ser un número entre 1 y 20.");

  // La persona: de ESTE instituto, con rol ALUMNO y sin ficha previa.
  const user = userId
    ? await prisma.eduUser.findFirst({
        where: { id: userId, institutionId },
        select: { id: true, role: true, studentProfile: { select: { id: true } } },
      })
    : null;
  if (!user) throw new EduPadronError("Esa persona no es de este instituto.", 404);
  if (user.role !== "ALUMNO") {
    throw new EduPadronError("Solo se puede inscribir a una persona con rol Estudiante.");
  }
  if (user.studentProfile) {
    throw new EduPadronError("Esa persona ya está inscrita en el padrón.", 409);
  }

  await resolvePair(institutionId, programId, cohortId);

  const dup = await prisma.eduStudent.findFirst({
    where: { institutionId, matricula },
    select: { id: true },
  });
  if (dup) throw new EduPadronError(`La matrícula ${matricula} ya está en uso.`, 409);

  return prisma.eduStudent.create({
    data: {
      institutionId,
      userId: user.id,
      programId,
      cohortId,
      matricula,
      semester,
      // Ola 1B: el índice sin acentos se escribe AQUÍ, en el mismo create.
      // Si se dejara para después, el alumno existiría y no se podría
      // buscar — y nadie relacionaría las dos cosas.
      searchIndex: eduStudentSearchIndex({ matricula }),
    },
    select: { id: true },
  });
}

/**
 * Los estados de baja del padrón. Los dos significan "ya no está en la
 * generación", y los dos son el momento en el que hay que decidir qué pasa
 * con su ACCESO (H-02).
 */
const EDU_STATUS_DE_BAJA: EduStudentStatus[] = ["GRADUATED", "WITHDRAWN"];

export async function updateEduStudent(
  ctx: EduPadronContext,
  studentId: string,
  input: {
    matricula?: unknown;
    semester?: unknown;
    status?: unknown;
    programId?: unknown;
    cohortId?: unknown;
    /**
     * 🔴 H-02 · ¿Se apaga también la CUENTA al darlo de baja del padrón?
     *
     * Hasta esta ola, marcar «Baja definitiva» escribía `status` y
     * `graduatedAt` y nada más: `EduUser.isActive` no se tocaba y la sesión
     * solo mira eso. Al día siguiente ese exalumno entraba con su misma
     * contraseña. Desde la Ola A el ALCANCE ya no le devuelve pacientes
     * —entra a un panel vacío— pero seguía entrando, y "entra a un panel
     * vacío" no es lo mismo que "no entra".
     *
     * Se manda EXPLÍCITO y la pantalla lo trae marcado por defecto, con
     * aviso en rojo si se desmarca. No se hace en automático a espaldas de
     * quien guarda: dar de baja una cuenta es quitarle a alguien el acceso
     * a su propio historial académico, y eso lo decide la dirección — lo que
     * cambió es que ahora lo decide AQUÍ, en el mismo modal y en la misma
     * transacción, en vez de tener que acordarse de ir a otra pantalla.
     */
    deactivateAccount?: unknown;
  },
  now: Date = new Date(),
): Promise<{ id: string; cuentaDesactivada: boolean }> {
  const institutionId = requireInstitution(ctx);
  const current = await prisma.eduStudent.findFirst({
    where: { id: studentId, institutionId },
    select: {
      id: true,
      programId: true,
      cohortId: true,
      status: true,
      graduatedAt: true,
      userId: true,
      user: { select: { isActive: true, role: true } },
    },
  });
  if (!current) throw new EduPadronError("Ese estudiante no es de este instituto.", 404);

  const data: {
    matricula?: string;
    searchIndex?: string;
    semester?: number;
    status?: EduStudentStatus;
    programId?: string;
    cohortId?: string;
    graduatedAt?: Date | null;
  } = {};

  if (input.matricula !== undefined) {
    const matricula = normalizeEduMatricula(input.matricula);
    if (!matricula) throw new EduPadronError("La matrícula es obligatoria (máximo 30 caracteres).");
    const dup = await prisma.eduStudent.findFirst({
      where: { institutionId, matricula, NOT: { id: studentId } },
      select: { id: true },
    });
    if (dup) throw new EduPadronError(`La matrícula ${matricula} ya está en uso.`, 409);
    data.matricula = matricula;
    // El índice se REESCRIBE con la matrícula nueva. Sin esto, corregir una
    // matrícula la dejaría buscable por la vieja y no por la nueva.
    data.searchIndex = eduStudentSearchIndex({ matricula });
  }
  if (input.semester !== undefined) {
    const s = parseEduSemester(input.semester);
    if (!s) throw new EduPadronError("El semestre tiene que ser un número entre 1 y 20.");
    data.semester = s;
  }
  if (input.status !== undefined) {
    const st = parseEduStudentStatus(input.status);
    if (!st) throw new EduPadronError("Ese estado no existe.");
    data.status = st;
    // graduatedAt se deriva del estado, no se captura: así no puede quedar
    // un "Egresado" sin fecha ni una fecha de egreso en un alumno activo.
    if (st === "GRADUATED") data.graduatedAt = current.graduatedAt ?? now;
    else data.graduatedAt = null;
  }
  if (input.programId !== undefined || input.cohortId !== undefined) {
    const programId = typeof input.programId === "string" ? input.programId : current.programId;
    const cohortId = typeof input.cohortId === "string" ? input.cohortId : current.cohortId;
    // Solo se exige "activa" si el par CAMBIA: reenviar el mismo par (el
    // modal manda el formulario completo) no puede rebotar por una
    // especialidad que se cerró después de inscribirlo.
    const cambiaPar = programId !== current.programId || cohortId !== current.cohortId;
    await resolvePair(institutionId, programId, cohortId, cambiaPar);
    data.programId = programId;
    data.cohortId = cohortId;
  }

  // ── 🔴 H-02 · LA BAJA DEL PADRÓN Y LA BAJA DE LA CUENTA, JUNTAS ───────
  const bajaAhora =
    data.status !== undefined &&
    EDU_STATUS_DE_BAJA.includes(data.status) &&
    !EDU_STATUS_DE_BAJA.includes(current.status as EduStudentStatus);
  const quiereDesactivar = parseEduBoolean(input.deactivateAccount) === true;
  const desactivarCuenta = bajaAhora && quiereDesactivar && current.user.isActive;

  if (quiereDesactivar && !bajaAhora) {
    // Apagar la cuenta sin dar de baja al alumno no es lo que esta pantalla
    // hace: para eso está Equipo, que además protege a la última dirección.
    throw new EduPadronError(
      "Solo se puede desactivar la cuenta junto con la baja del padrón. Para dar de baja una cuenta sin tocar el padrón, hazlo desde Equipo.",
    );
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  // Una transacción, dos filas. El estado leído va en el `where` de las dos:
  // entre el findFirst de arriba y esto caben otra pestaña y otra persona de
  // dirección, y una baja que se pisa con una reinscripción dejaría al
  // alumno activo en el padrón y con la cuenta apagada — o al revés.
  await prisma.$transaction(async (tx) => {
    const escrito = await tx.eduStudent.updateMany({
      where: { id: studentId, institutionId, status: current.status },
      data,
    });
    if (escrito.count === 0) {
      throw new EduPadronError(
        "Alguien más cambió la ficha de este estudiante mientras la editabas. Actualiza la pantalla y vuelve a mirarla.",
        409,
      );
    }

    if (desactivarCuenta) {
      const apagada = await tx.eduUser.updateMany({
        where: { id: current.userId, institutionId, isActive: true, role: "ALUMNO" },
        data: { isActive: false },
      });
      if (apagada.count === 0) {
        throw new EduPadronError(
          "Alguien más cambió esa cuenta mientras guardabas. Actualiza la pantalla: la baja del padrón no se guardó.",
          409,
        );
      }
    }
  });

  return { id: studentId, cuentaDesactivada: desactivarCuenta };
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS · SUPERVISIÓN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Asigna un docente a un alumno.
 *
 * 🔴 Asignar un TITULAR cierra al titular anterior (endsAt = ahora) en vez
 * de borrarlo o editarlo. Ésa es toda la razón de que la tabla tenga
 * vigencia: dentro de un año, cuando haya que saber quién supervisaba a
 * este alumno el 3 de marzo, la fila del docente anterior sigue ahí con sus
 * fechas. Un UPDATE del supervisorUserId habría borrado esa respuesta para
 * siempre.
 */
export async function assignEduSupervisor(
  ctx: EduPadronContext,
  input: { studentId?: unknown; supervisorUserId?: unknown; isPrimary?: unknown },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const studentId = typeof input.studentId === "string" ? input.studentId : "";
  const supervisorUserId = typeof input.supervisorUserId === "string" ? input.supervisorUserId : "";
  const isPrimary = input.isPrimary === undefined ? true : parseEduBoolean(input.isPrimary);
  if (isPrimary === null) throw new EduPadronError("El tipo de asignación no es válido.");

  const student = studentId
    ? await prisma.eduStudent.findFirst({
        where: { id: studentId, institutionId },
        select: { id: true, status: true, user: { select: { isActive: true } } },
      })
    : null;
  if (!student) throw new EduPadronError("Ese estudiante no es de este instituto.", 404);
  // 🔴 H-111 · Al alumno se le miraba solo `{id, institutionId}`, nunca su
  // `status`, mientras que al docente sí se le validaba el rol y el estado.
  // Asignarle un docente a un egresado o a un dado de baja le metía ese
  // alumno en la carga «de hoy» del docente y le daba visibilidad clínica
  // sobre sus pacientes históricos.
  if (student.status !== "ACTIVE") {
    throw new EduPadronError(
      "Ese estudiante ya no está activo en el padrón: no se le puede asignar un docente. Si volvió, ponlo en Activo primero.",
    );
  }

  const supervisor = supervisorUserId
    ? await prisma.eduUser.findFirst({
        where: { id: supervisorUserId, institutionId },
        select: { id: true, role: true, isActive: true },
      })
    : null;
  if (!supervisor) throw new EduPadronError("Ese docente no es de este instituto.", 404);
  if (supervisor.role !== "DOCENTE") {
    throw new EduPadronError("Solo se puede asignar como supervisor a alguien con rol Docente.");
  }
  if (!supervisor.isActive) {
    throw new EduPadronError("Ese docente está dado de baja. Reactívalo antes de asignarle estudiantes.");
  }
  // 🔴 H-16 (tercera llave) · NADIE SE ASIGNA A SÍ MISMO. El comentario de
  // la propia ruta describía este riesgo (src/app/api/instituto/supervision
  // /route.ts:10-13) y la función nunca comparaba supervisorUserId con
  // ctx.eduUserId: con `supervision.assign` prestado, un docente se asignaba
  // a cualquier alumno, ganaba su expediente, su odontograma y sus
  // radiografías, y de paso CERRABA al titular anterior, que perdía el
  // acceso sin enterarse.
  //
  // La regla no le quita nada a la dirección: un supervisor tiene que ser
  // DOCENTE (arriba), así que una cuenta de DIRECCION nunca puede ser el
  // supervisor de esta comprobación.
  if (supervisor.id === ctx.eduUserId) {
    throw new EduPadronError(
      "No puedes asignarte estudiantes a ti mismo. Las asignaciones las hace la dirección.",
      403,
    );
  }

  const yaLoLleva = await prisma.eduSupervisorAssignment.findFirst({
    where: {
      institutionId,
      studentId: student.id,
      supervisorUserId: supervisor.id,
      ...eduCurrentAssignmentWhere(now),
    },
    select: { id: true },
  });
  if (yaLoLleva) throw new EduPadronError("Ese docente ya supervisa a este estudiante.", 409);

  const created = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      // El titular saliente se CIERRA, no se borra.
      await tx.eduSupervisorAssignment.updateMany({
        where: {
          institutionId,
          studentId: student.id,
          isPrimary: true,
          ...eduCurrentAssignmentWhere(now),
        },
        data: { endsAt: now },
      });
    }
    return tx.eduSupervisorAssignment.create({
      data: {
        institutionId,
        studentId: student.id,
        supervisorUserId: supervisor.id,
        isPrimary,
        startsAt: now,
      },
      select: { id: true },
    });
  });

  return created;
}

/** Cierra una asignación (endsAt = ahora). Nunca borra la fila. */
export async function endEduSupervisorAssignment(
  ctx: EduPadronContext,
  assignmentId: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const current = await prisma.eduSupervisorAssignment.findFirst({
    where: { id: assignmentId, institutionId },
    select: { id: true, endsAt: true },
  });
  if (!current) throw new EduPadronError("Esa asignación no es de este instituto.", 404);
  if (current.endsAt && current.endsAt.getTime() <= now.getTime()) {
    throw new EduPadronError("Esa asignación ya estaba cerrada.", 409);
  }
  await prisma.eduSupervisorAssignment.update({
    where: { id: assignmentId },
    data: { endsAt: now },
  });
  return { id: assignmentId };
}
