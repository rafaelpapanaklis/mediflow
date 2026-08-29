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

  // Sin alcance no se consulta nada. La pantalla explica por qué.
  if (scope.kind === "none") return { rows: [], scope, truncated: false };

  const rows = await prisma.eduStudent.findMany({
    where: eduStudentWhere({ institutionId, scope, filters, now }),
    orderBy: [{ matricula: "asc" }],
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
    },
  });

  const truncated = rows.length > EDU_PADRON_MAX_ROWS;

  return {
    scope,
    truncated,
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
 * Esta ola no crea logins (eso es la ola de Equipo, que necesita Supabase
 * Auth): inscribir es colgarle matrícula, programa y generación a una
 * persona que ya existe. Si esta lista sale vacía, lo que falta es dar de
 * alta a la persona, no un botón aquí.
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
  if (!name) throw new EduPadronError("El nombre del programa es obligatorio (máximo 120 caracteres).");

  const code = normalizeEduProgramCode(input.code);
  if (!code) throw new EduPadronError("La clave del programa es obligatoria (máximo 20 caracteres, sin espacios).");

  const durationSemesters =
    input.durationSemesters === undefined || input.durationSemesters === null || input.durationSemesters === ""
      ? 6
      : parseEduDurationSemesters(input.durationSemesters);
  if (!durationSemesters) throw new EduPadronError("La duración tiene que ser un número de semestres entre 1 y 20.");

  const dup = await prisma.eduProgram.findFirst({
    where: { institutionId, code },
    select: { id: true, name: true },
  });
  if (dup) throw new EduPadronError(`La clave ${code} ya la usa el programa "${dup.name}".`, 409);

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
  if (!current) throw new EduPadronError("Ese programa no es de este instituto.", 404);

  const data: {
    name?: string;
    code?: string;
    durationSemesters?: number;
    isActive?: boolean;
  } = {};

  if (input.name !== undefined) {
    const name = eduRequiredText(input.name, 120);
    if (!name) throw new EduPadronError("El nombre del programa es obligatorio (máximo 120 caracteres).");
    data.name = name;
  }
  if (input.code !== undefined) {
    const code = normalizeEduProgramCode(input.code);
    if (!code) throw new EduPadronError("La clave del programa es obligatoria (máximo 20 caracteres, sin espacios).");
    const dup = await prisma.eduProgram.findFirst({
      where: { institutionId, code, NOT: { id: programId } },
      select: { name: true },
    });
    if (dup) throw new EduPadronError(`La clave ${code} ya la usa el programa "${dup.name}".`, 409);
    data.code = code;
  }
  if (input.durationSemesters !== undefined) {
    const d = parseEduDurationSemesters(input.durationSemesters);
    if (!d) throw new EduPadronError("La duración tiene que ser un número de semestres entre 1 y 20.");
    data.durationSemesters = d;
  }
  if (input.isActive !== undefined) {
    const b = parseEduBoolean(input.isActive);
    if (b === null) throw new EduPadronError("El estado del programa tiene que ser verdadero o falso.");
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
  if (!program) throw new EduPadronError("Elige un programa de este instituto.", 400);

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
  if (dup) throw new EduPadronError(`Ese programa ya tiene una generación llamada "${name}".`, 409);

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
    if (dup) throw new EduPadronError(`Ese programa ya tiene una generación llamada "${name}".`, 409);
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
): Promise<void> {
  // El programa se comprueba PRIMERO: si faltan los dos, el mensaje útil
  // es "elige un programa", que es el primer campo del formulario.
  const program = await prisma.eduProgram.findFirst({
    where: { id: programId, institutionId },
    select: { id: true },
  });
  if (!program) throw new EduPadronError("Elige un programa de este instituto.", 400);
  const cohort = await prisma.eduCohort.findFirst({
    where: { id: cohortId, institutionId },
    select: { programId: true },
  });
  if (!cohort) throw new EduPadronError("Elige una generación de este instituto.", 400);
  if (cohort.programId !== programId) {
    throw new EduPadronError("Esa generación no pertenece al programa que elegiste.");
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
    throw new EduPadronError("Solo se puede inscribir a una persona con rol Alumno.");
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
    data: { institutionId, userId: user.id, programId, cohortId, matricula, semester },
    select: { id: true },
  });
}

export async function updateEduStudent(
  ctx: EduPadronContext,
  studentId: string,
  input: {
    matricula?: unknown;
    semester?: unknown;
    status?: unknown;
    programId?: unknown;
    cohortId?: unknown;
  },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const current = await prisma.eduStudent.findFirst({
    where: { id: studentId, institutionId },
    select: { id: true, programId: true, cohortId: true, status: true, graduatedAt: true },
  });
  if (!current) throw new EduPadronError("Ese alumno no es de este instituto.", 404);

  const data: {
    matricula?: string;
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
    await resolvePair(institutionId, programId, cohortId);
    data.programId = programId;
    data.cohortId = cohortId;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduStudent.update({ where: { id: studentId }, data });
  return { id: studentId };
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
    ? await prisma.eduStudent.findFirst({ where: { id: studentId, institutionId }, select: { id: true } })
    : null;
  if (!student) throw new EduPadronError("Ese alumno no es de este instituto.", 404);

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
    throw new EduPadronError("Ese docente está dado de baja. Reactívalo antes de asignarle alumnos.");
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
  if (yaLoLleva) throw new EduPadronError("Ese docente ya supervisa a este alumno.", 409);

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
