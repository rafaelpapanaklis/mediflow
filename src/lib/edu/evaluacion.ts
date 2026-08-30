/**
 * DaleControl INSTITUCIONAL — EL AVANCE ACADÉMICO contra la base.
 *
 * SERVIDOR: importa prisma. Las cuentas (avance, horas, atraso, CSV) viven
 * en evaluacion-core.ts, que es puro; el recorte de filas, en
 * visibility.ts. Aquí solo se leen datos y se le pasan a las dos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL AVANCE SE CUENTA, NO SE GUARDA.
 *
 * No hay en todo el vertical una columna "requisitos cumplidos". Cada vez
 * que alguien abre esta pantalla se cuentan los casos que encajan. Es más
 * caro que leer un contador y es la única forma de que el número sea
 * verdad: un contador guardado se desincroniza el día que una escritura
 * falle a la mitad o que alguien cierre un caso por SQL, y entonces un
 * alumno se gradúa sin cumplir — con el sistema diciendo que cumplió.
 *
 * El costo real: una consulta de casos por pantalla y una de citas. Con
 * ciento veinte alumnos y unos cientos de casos por generación, eso es una
 * consulta indexada; el día que una escuela tenga diez años de historia
 * dentro, lo que hay que poner es un filtro por generación, no un
 * contador.
 *
 * 🔴 LAS HORAS TAMPOCO SE CAPTURAN. Salen de las citas COMPLETADAS del
 * alumno. Unas horas que se teclean son unas horas que se pueden teclear
 * mal, y son exactamente las que una acreditación mira con lupa.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { formatEduContractDate } from "@/lib/edu/contract";
import {
  EDU_STUDENT_STATUS_LABELS,
  type EduCaseStatus,
  type EduStudentStatus,
} from "@/lib/edu/types";
import {
  eduScopeIsEmpty,
  eduStudentScopeWhere,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_EVALUACION_MAX_ROWS,
  EDU_REQUIREMENT_CATEGORY_MAX,
  EDU_REQUIREMENT_MAX_COUNT,
  EDU_REQUIREMENT_NAME_MAX,
  EDU_REQUIREMENT_NOTES_MAX,
  eduAtrasoVerdict,
  eduAverageScore,
  eduClinicalHours,
  eduCsvFile,
  eduCsvRow,
  eduCurrentGrade,
  eduCycleFraction,
  eduEvalBoolean,
  eduEvalInt,
  eduEvalOptionalText,
  eduEvalText,
  eduHoursLabel,
  eduRequirementProgress,
  eduScoreLabel,
  eduSemesterRangeCheck,
  type EduBitacoraCaseRow,
  type EduBitacoraPage,
  type EduCountableCase,
  type EduEvaluacionRow,
  type EduRequirementRow,
  type EduRequirementSpec,
  type EduTransferRow,
} from "@/lib/edu/evaluacion-core";
import { listEduStudentGrades } from "@/lib/edu/rubricas";
import { EDU_MAX_SEMESTER } from "@/lib/edu/padron-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: {
  firstName: string;
  lastName: string;
  email?: string | null;
}): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

function patientName(p: { firstName: string; lastName: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || "Sin nombre";
}

/** Fecha larga en la zona del INSTITUTO. Nunca la del navegador. */
function fechaLarga(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function fechaHora(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS REQUISITOS DEL PLAN DE ESTUDIOS
// ═══════════════════════════════════════════════════════════════════════

const REQUIREMENT_SELECT = {
  id: true,
  name: true,
  programId: true,
  semesterFrom: true,
  semesterTo: true,
  procedureId: true,
  category: true,
  requiredCount: true,
  onlyCompleted: true,
  isActive: true,
  orderIndex: true,
  notes: true,
  program: { select: { name: true } },
  procedure: { select: { name: true } },
} satisfies Prisma.EduRequirementSelect;

type RequirementPayload = Prisma.EduRequirementGetPayload<{ select: typeof REQUIREMENT_SELECT }>;

function toRequirementRow(r: RequirementPayload): EduRequirementRow {
  return {
    id: r.id,
    name: r.name,
    programId: r.programId,
    programName: r.program.name,
    semesterFrom: r.semesterFrom,
    semesterTo: r.semesterTo,
    procedureId: r.procedureId,
    procedureName: r.procedure?.name ?? null,
    category: r.category,
    requiredCount: r.requiredCount,
    onlyCompleted: r.onlyCompleted,
    isActive: r.isActive,
    orderIndex: r.orderIndex,
    notes: r.notes,
  };
}

/** El plan de estudios del instituto. Como las rúbricas, no se recorta por
 *  alumno: es el criterio compartido de la escuela. */
export async function listEduRequirements(
  ctx: EduClinicaContext,
  filters: { onlyActive?: boolean; programId?: string | null } = {},
): Promise<EduRequirementRow[]> {
  const institutionId = requireInstitution(ctx);
  const where: Prisma.EduRequirementWhereInput = { institutionId };
  if (filters.onlyActive) where.isActive = true;
  if (filters.programId) where.programId = filters.programId;

  const rows = await prisma.eduRequirement.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { name: "asc" }],
    take: EDU_EVALUACION_MAX_ROWS,
    select: REQUIREMENT_SELECT,
  });
  return rows.map(toRequirementRow);
}

export interface EduRequirementInput {
  name?: unknown;
  programId?: unknown;
  semesterFrom?: unknown;
  semesterTo?: unknown;
  procedureId?: unknown;
  category?: unknown;
  requiredCount?: unknown;
  onlyCompleted?: unknown;
  isActive?: unknown;
  orderIndex?: unknown;
  notes?: unknown;
}

/**
 * Qué CUENTA para el requisito, comprobado contra este instituto.
 *
 * ⚠️ Procedimiento Y categoría a la vez se rebota. Los dos juntos serían
 * dos filtros que casi siempre se contradicen ("endodoncia unirradicular"
 * de la categoría "Prótesis"), y el requisito contaría cero sin que nadie
 * supiera por qué.
 */
async function resolveRequirementTarget(
  institutionId: string,
  input: EduRequirementInput,
): Promise<{ procedureId: string | null; category: string | null }> {
  const category = eduEvalOptionalText(input.category, EDU_REQUIREMENT_CATEGORY_MAX) ?? null;

  let procedureId: string | null = null;
  if (input.procedureId !== undefined && input.procedureId !== null && input.procedureId !== "") {
    const id = eduCleanId(input.procedureId);
    const p = id
      ? await prisma.eduProcedure.findFirst({ where: { id, institutionId }, select: { id: true } })
      : null;
    if (!p) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);
    procedureId = p.id;
  }

  if (procedureId && category) {
    throw new EduPadronError(
      "Elige un procedimiento O una categoría, no las dos: juntas casi nunca coinciden y el requisito contaría cero.",
    );
  }

  return { procedureId, category };
}

export async function createEduRequirement(
  ctx: EduClinicaContext,
  input: EduRequirementInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const name = eduEvalText(input.name, EDU_REQUIREMENT_NAME_MAX);
  if (!name) throw new EduPadronError("Ponle nombre al requisito.");

  const programId = eduCleanId(input.programId);
  const program = programId
    ? await prisma.eduProgram.findFirst({
        where: { id: programId, institutionId },
        select: { id: true },
      })
    : null;
  if (!program) throw new EduPadronError("Elige la especialidad del requisito.", 400);

  const requiredCount = eduEvalInt(input.requiredCount, 1, EDU_REQUIREMENT_MAX_COUNT);
  if (requiredCount === null) {
    throw new EduPadronError(
      `Cuántos se necesitan tiene que ser un entero entre 1 y ${EDU_REQUIREMENT_MAX_COUNT}.`,
    );
  }

  const semesterFrom = eduEvalInt(input.semesterFrom, 1, EDU_MAX_SEMESTER);
  const semesterTo = eduEvalInt(input.semesterTo, 1, EDU_MAX_SEMESTER);
  const rangoMalo = eduSemesterRangeCheck(semesterFrom, semesterTo);
  if (rangoMalo) throw new EduPadronError(rangoMalo);

  const target = await resolveRequirementTarget(institutionId, input);

  const repetido = await prisma.eduRequirement.findFirst({
    where: { institutionId, programId: program.id, name },
    select: { id: true },
  });
  if (repetido) {
    throw new EduPadronError(`Esa especialidad ya tiene un requisito llamado "${name}".`, 409);
  }

  const created = await prisma.eduRequirement.create({
    data: {
      institutionId,
      name,
      programId: program.id,
      semesterFrom,
      semesterTo,
      procedureId: target.procedureId,
      category: target.category,
      requiredCount,
      onlyCompleted: eduEvalBoolean(input.onlyCompleted) ?? true,
      orderIndex: eduEvalInt(input.orderIndex, 0, 999) ?? 0,
      notes: eduEvalOptionalText(input.notes, EDU_REQUIREMENT_NOTES_MAX) ?? null,
    },
    select: { id: true },
  });
  return created;
}

export async function updateEduRequirement(
  ctx: EduClinicaContext,
  requirementId: string,
  input: EduRequirementInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(requirementId);
  const actual = id
    ? await prisma.eduRequirement.findFirst({
        where: { id, institutionId },
        select: {
          id: true,
          name: true,
          programId: true,
          semesterFrom: true,
          semesterTo: true,
        },
      })
    : null;
  if (!actual) throw new EduPadronError("Ese requisito no es de este instituto.", 404);

  const data: Prisma.EduRequirementUpdateInput = {};

  if (input.name !== undefined) {
    const name = eduEvalText(input.name, EDU_REQUIREMENT_NAME_MAX);
    if (!name) throw new EduPadronError("Ponle nombre al requisito.");
    if (name !== actual.name) {
      const repetido = await prisma.eduRequirement.findFirst({
        where: { institutionId, programId: actual.programId, name, id: { not: actual.id } },
        select: { id: true },
      });
      if (repetido) {
        throw new EduPadronError(`Esa especialidad ya tiene un requisito llamado "${name}".`, 409);
      }
    }
    data.name = name;
  }

  if (input.requiredCount !== undefined) {
    const n = eduEvalInt(input.requiredCount, 1, EDU_REQUIREMENT_MAX_COUNT);
    if (n === null) {
      throw new EduPadronError(
        `Cuántos se necesitan tiene que ser un entero entre 1 y ${EDU_REQUIREMENT_MAX_COUNT}.`,
      );
    }
    data.requiredCount = n;
  }

  if (input.semesterFrom !== undefined || input.semesterTo !== undefined) {
    const from =
      input.semesterFrom !== undefined
        ? eduEvalInt(input.semesterFrom, 1, EDU_MAX_SEMESTER)
        : actual.semesterFrom;
    const to =
      input.semesterTo !== undefined
        ? eduEvalInt(input.semesterTo, 1, EDU_MAX_SEMESTER)
        : actual.semesterTo;
    const malo = eduSemesterRangeCheck(from, to);
    if (malo) throw new EduPadronError(malo);
    data.semesterFrom = from;
    data.semesterTo = to;
  }

  if (input.procedureId !== undefined || input.category !== undefined) {
    const target = await resolveRequirementTarget(institutionId, input);
    data.procedure = target.procedureId
      ? { connect: { id: target.procedureId } }
      : { disconnect: true };
    data.category = target.category;
  }

  if (input.onlyCompleted !== undefined) {
    const v = eduEvalBoolean(input.onlyCompleted);
    if (v === null) throw new EduPadronError("El valor de «solo terminados» no es válido.");
    data.onlyCompleted = v;
  }
  if (input.isActive !== undefined) {
    const v = eduEvalBoolean(input.isActive);
    if (v === null) throw new EduPadronError("El estado del requisito no es válido.");
    data.isActive = v;
  }
  if (input.orderIndex !== undefined) data.orderIndex = eduEvalInt(input.orderIndex, 0, 999) ?? 0;
  if (input.notes !== undefined) {
    data.notes = eduEvalOptionalText(input.notes, EDU_REQUIREMENT_NOTES_MAX) ?? null;
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduRequirement.update({ where: { id: actual.id }, data });
  return { id: actual.id };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL AVANCE — lo que se cuenta cada vez
// ═══════════════════════════════════════════════════════════════════════

const CASE_FOR_COUNT_SELECT = {
  id: true,
  status: true,
  programId: true,
  procedureId: true,
  openedAt: true,
  closedAt: true,
  transferredFromCaseId: true,
  patientId: true,
  procedure: { select: { name: true, category: true } },
  patient: { select: { firstName: true, lastName: true, folio: true } },
  program: { select: { name: true } },
} satisfies Prisma.EduCaseSelect;

type CaseForCount = Prisma.EduCaseGetPayload<{ select: typeof CASE_FOR_COUNT_SELECT }>;

function toCountable(c: CaseForCount): EduCountableCase {
  return {
    id: c.id,
    programId: c.programId,
    status: c.status as EduCaseStatus,
    procedureId: c.procedureId,
    procedureCategory: c.procedure?.category ?? null,
  };
}

/** Lo mínimo de una cita para las horas. Sin `patient` ni nada más: son
 *  cientos de filas por alumno y no se pinta ninguna. */
const APPOINTMENT_FOR_HOURS_SELECT = {
  status: true,
  startsAt: true,
  endsAt: true,
  checkedInAt: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.EduAppointmentSelect;

/**
 * Los alumnos que le tocan a quien pregunta, con su avance y su semáforo.
 *
 * 🔴 UNA SOLA CONSULTA POR TABLA, no una por alumno. Con ciento veinte
 * alumnos, "un `count` por requisito por alumno" son mil consultas para
 * pintar una lista — y esa es la versión de esta pantalla que la escuela
 * deja de abrir.
 */
export async function listEduEvaluacion(
  ctx: EduClinicaContext,
  filters: {
    programId?: string | null;
    cohortId?: string | null;
    status?: EduStudentStatus | null;
    estado?: string | null;
  } = {},
  now: Date = new Date(),
): Promise<{ rows: EduEvaluacionRow[]; truncated: boolean }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const where: Prisma.EduStudentWhereInput = {
    ...eduStudentScopeWhere({ institutionId, scope, now }),
  };
  if (filters.programId) where.programId = filters.programId;
  if (filters.cohortId) where.cohortId = filters.cohortId;
  if (filters.status) where.status = filters.status;

  const alumnos = await prisma.eduStudent.findMany({
    where,
    orderBy: [{ status: "asc" }, { semester: "desc" }, { matricula: "asc" }],
    take: EDU_EVALUACION_MAX_ROWS + 1,
    select: {
      id: true,
      matricula: true,
      semester: true,
      status: true,
      programId: true,
      cohortId: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      program: { select: { name: true } },
      cohort: { select: { name: true, startDate: true, endDate: true } },
    },
  });

  const truncated = alumnos.length > EDU_EVALUACION_MAX_ROWS;
  const visibles = alumnos.slice(0, EDU_EVALUACION_MAX_ROWS);
  if (visibles.length === 0) return { rows: [], truncated };

  const studentIds = visibles.map((a) => a.id);
  const programIds = Array.from(new Set(visibles.map((a) => a.programId)));

  const [requisitos, casos, citas, calificaciones] = await Promise.all([
    prisma.eduRequirement.findMany({
      where: { institutionId, isActive: true, programId: { in: programIds } },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      select: REQUIREMENT_SELECT,
    }),
    prisma.eduCase.findMany({
      where: { institutionId, studentId: { in: studentIds } },
      select: { ...CASE_FOR_COUNT_SELECT, studentId: true },
    }),
    prisma.eduAppointment.findMany({
      where: { institutionId, studentId: { in: studentIds }, status: "COMPLETED" },
      select: { ...APPOINTMENT_FOR_HOURS_SELECT, studentId: true },
    }),
    prisma.eduCaseGrade.findMany({
      where: { institutionId, studentId: { in: studentIds } },
      orderBy: [{ gradedAt: "desc" }],
      select: {
        id: true,
        studentId: true,
        correctsId: true,
        finalScoreX100: true,
        scaleMax: true,
      },
    }),
  ]);

  const casosPorAlumno = agrupar(casos, (c) => c.studentId);
  const citasPorAlumno = agrupar(citas, (c) => c.studentId);
  const notasPorAlumno = agrupar(calificaciones, (g) => g.studentId);
  const requisitosPorPrograma = agrupar(requisitos, (r) => r.programId);

  const rows: EduEvaluacionRow[] = visibles.map((a) => {
    const specs = (requisitosPorPrograma.get(a.programId) ?? []).map(toSpec);
    const suyos = (casosPorAlumno.get(a.id) ?? []).map(toCountable);
    const fraccion = eduCycleFraction(a.cohort, now);
    const progresos = specs.map((r) => eduRequirementProgress(r, suyos, fraccion));
    const verdict = eduAtrasoVerdict(progresos, fraccion);
    const horas = eduClinicalHours(citasPorAlumno.get(a.id) ?? []);

    const notas = notasPorAlumno.get(a.id) ?? [];
    const corregidas = new Set(
      notas.map((g) => g.correctsId).filter((v): v is string => typeof v === "string"),
    );
    const vigentes = notas.map((g) => ({
      finalScoreX100: g.finalScoreX100,
      scaleMax: g.scaleMax,
      current: !corregidas.has(g.id),
    }));
    const promedio = eduAverageScore(vigentes);

    return {
      studentId: a.id,
      studentName: personName(a.user),
      matricula: a.matricula,
      programId: a.programId,
      programName: a.program.name,
      cohortId: a.cohortId,
      cohortName: a.cohort.name,
      semester: a.semester,
      status: a.status,
      estado: verdict.estado,
      motivo: verdict.motivo,
      hechos: verdict.hechos,
      esperados: verdict.esperados,
      totales: verdict.totales,
      fraccion: verdict.fraccion,
      hoursLabel: eduHoursLabel(horas.totalMinutes),
      gradesCount: vigentes.filter((g) => g.current).length,
      averageX100: promedio.averageX100,
      averageLabel: promedio.averageX100 === null ? null : eduScoreLabel(promedio.averageX100),
      averageScaleMax: promedio.scaleMax,
    };
  });

  const filtradas = filters.estado
    ? rows.filter((r) => (r.estado ?? "SIN_CALCULAR") === filters.estado)
    : rows;

  // El semáforo se ordena de peor a mejor: la lista existe para encontrar a
  // quien hay que llamar, no para leerla entera.
  const peso: Record<string, number> = { ATRASADO: 0, VIGILAR: 1, AL_DIA: 2, SIN_CALCULAR: 3 };
  filtradas.sort((a, b) => {
    const pa = peso[a.estado ?? "SIN_CALCULAR"] ?? 9;
    const pb = peso[b.estado ?? "SIN_CALCULAR"] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.studentName.localeCompare(b.studentName, "es");
  });

  // ⚠️ Esta función NO recibe la zona horaria, y no es un olvido: no pinta
  // ni una fecha. Las horas salen en "9 h 5 min" y el avance en números;
  // lo único con fecha de esta ola es la bitácora (getEduBitacora), que sí
  // la recibe. Un parámetro que no se usa es un parámetro que alguien va a
  // empezar a pasar mal.
  return { rows: filtradas, truncated };
}

function agrupar<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const lista = map.get(k);
    if (lista) lista.push(r);
    else map.set(k, [r]);
  }
  return map;
}

function toSpec(r: RequirementPayload): EduRequirementSpec {
  return {
    id: r.id,
    name: r.name,
    programId: r.programId,
    semesterFrom: r.semesterFrom,
    semesterTo: r.semesterTo,
    procedureId: r.procedureId,
    category: r.category,
    requiredCount: r.requiredCount,
    onlyCompleted: r.onlyCompleted,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA BITÁCORA ACADÉMICA
//
// La historia del alumno en UNA pantalla: casos, calificaciones, horas,
// requisitos y traspasos. Es lo que la dirección enseña en una
// acreditación, así que además se puede exportar (ver más abajo).
// ═══════════════════════════════════════════════════════════════════════

export async function getEduBitacora(
  ctx: EduClinicaContext,
  studentId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduBitacoraPage | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return null;

  const id = eduCleanId(studentId);
  if (!id) return null;
  const zona = eduSafeTimeZone(timeZone);

  // 🔴 El alumno se busca DENTRO del alcance: uno que no le toca a quien
  // pregunta se ve igual que uno que no existe. Un alumno solo se alcanza
  // a sí mismo.
  const alumno = await prisma.eduStudent.findFirst({
    where: { ...eduStudentScopeWhere({ institutionId, scope, now }), id },
    select: {
      id: true,
      matricula: true,
      semester: true,
      status: true,
      programId: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      program: { select: { name: true } },
      cohort: { select: { name: true, startDate: true, endDate: true } },
    },
  });
  if (!alumno) return null;

  const [requisitos, casos, citas, grades] = await Promise.all([
    prisma.eduRequirement.findMany({
      where: { institutionId, isActive: true, programId: alumno.programId },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      select: REQUIREMENT_SELECT,
    }),
    prisma.eduCase.findMany({
      where: { institutionId, studentId: alumno.id },
      orderBy: [{ openedAt: "desc" }],
      take: EDU_EVALUACION_MAX_ROWS,
      select: CASE_FOR_COUNT_SELECT,
    }),
    prisma.eduAppointment.findMany({
      where: { institutionId, studentId: alumno.id, status: "COMPLETED" },
      select: APPOINTMENT_FOR_HOURS_SELECT,
    }),
    listEduStudentGrades(ctx, alumno.id, zona),
  ]);

  const fraccion = eduCycleFraction(alumno.cohort, now);
  const contables = casos.map(toCountable);
  const progresos = requisitos.map((r) => eduRequirementProgress(toSpec(r), contables, fraccion));
  const verdict = eduAtrasoVerdict(progresos, fraccion);
  const horas = eduClinicalHours(citas);

  // La calificación vigente de cada caso, para la columna de la tabla.
  const notasPorCaso = agrupar(grades, (g) => g.caseId);
  const casesRows: EduBitacoraCaseRow[] = casos.map((c) => {
    const vigente = eduCurrentGrade(notasPorCaso.get(c.id) ?? []);
    return {
      id: c.id,
      status: c.status as EduCaseStatus,
      patientId: c.patientId,
      patientName: patientName(c.patient),
      patientFolio: c.patient.folio,
      programName: c.program.name,
      procedureId: c.procedureId,
      procedureName: c.procedure?.name ?? null,
      procedureCategory: c.procedure?.category ?? null,
      openedAt: c.openedAt.toISOString(),
      openedLabel: fechaLarga(c.openedAt, zona),
      closedLabel: c.closedAt ? fechaLarga(c.closedAt, zona) : null,
      gradeLabel: vigente ? eduScoreLabel(vigente.finalScoreX100) : null,
      gradeScaleMax: vigente ? vigente.scaleMax : null,
      gradeId: vigente ? vigente.id : null,
      transferredFromCaseId: c.transferredFromCaseId,
    };
  });

  const transfers = await listEduStudentTransfers(institutionId, alumno.id, zona);

  const promedio = eduAverageScore(grades);

  return {
    studentId: alumno.id,
    studentName: personName(alumno.user),
    matricula: alumno.matricula,
    email: alumno.user.email,
    programId: alumno.programId,
    programName: alumno.program.name,
    cohortName: alumno.cohort.name,
    cohortStartLabel: alumno.cohort.startDate
      ? formatEduContractDate(alumno.cohort.startDate)
      : null,
    cohortEndLabel: alumno.cohort.endDate ? formatEduContractDate(alumno.cohort.endDate) : null,
    semester: alumno.semester,
    statusLabel: EDU_STUDENT_STATUS_LABELS[alumno.status as EduStudentStatus] ?? alumno.status,
    verdict,
    requirements: progresos,
    hours: horas,
    hoursLabel: eduHoursLabel(horas.totalMinutes),
    cases: casesRows,
    casesWithoutProcedure: casos.filter((c) => !c.procedureId).length,
    grades,
    transfers,
    averageX100: promedio.averageX100,
    averageLabel: promedio.averageX100 === null ? null : eduScoreLabel(promedio.averageX100),
    averageScaleMax: promedio.scaleMax,
    generatedLabel: fechaHora(now, zona),
  };
}

/**
 * Los traspasos que TOCAN a este alumno: los que entregó y los que
 * recibió.
 *
 * Se leen de los CASOS, no de una tabla de traspasos: el enlace
 * `transferredFromCaseId` ya lo dice todo, y una tabla aparte sería una
 * segunda versión de la misma historia que alguien tendría que mantener
 * sincronizada.
 */
async function listEduStudentTransfers(
  institutionId: string,
  studentId: string,
  timeZone: string,
): Promise<EduTransferRow[]> {
  const nuevos = await prisma.eduCase.findMany({
    where: {
      institutionId,
      transferredFromCaseId: { not: null },
      OR: [{ studentId }, { transferredFrom: { studentId } }],
    },
    orderBy: [{ openedAt: "desc" }],
    take: EDU_EVALUACION_MAX_ROWS,
    select: {
      id: true,
      openedAt: true,
      transferReason: true,
      transferredFromCaseId: true,
      studentId: true,
      student: {
        select: { id: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
      patient: { select: { firstName: true, lastName: true, folio: true } },
      program: { select: { name: true } },
      transferredBy: { select: { firstName: true, lastName: true, email: true } },
      transferredFrom: {
        select: {
          id: true,
          studentId: true,
          student: {
            select: { id: true, user: { select: { firstName: true, lastName: true, email: true } } },
          },
        },
      },
    },
  });

  return nuevos
    .filter((c) => c.transferredFrom)
    .map((c) => ({
      caseId: c.id,
      fromCaseId: c.transferredFrom!.id,
      patientName: patientName(c.patient),
      patientFolio: c.patient.folio,
      programName: c.program.name,
      fromStudentId: c.transferredFrom!.studentId,
      fromStudentName: personName(c.transferredFrom!.student.user),
      toStudentId: c.studentId,
      toStudentName: personName(c.student.user),
      reason: c.transferReason,
      byName: c.transferredBy ? personName(c.transferredBy) : null,
      at: c.openedAt.toISOString(),
      atLabel: fechaLarga(c.openedAt, timeZone),
    }));
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA EXPORTACIÓN
//
// CSV y no PDF: lo que la dirección hace con esto en una acreditación es
// pegarlo en una hoja de cálculo y sumarlo. Un PDF bonito que no se puede
// sumar obliga a volver a teclearlo — y volver a teclear un expediente
// académico es cómo aparecen las diferencias que después nadie explica.
//
// El escapado (comillas y el apóstrofo delante de "=") vive en
// evaluacion-core.ts, que es donde se puede probar sin base de datos.
// ═══════════════════════════════════════════════════════════════════════

export function buildEduBitacoraCsv(page: EduBitacoraPage): string {
  const filas: string[] = [];

  filas.push(eduCsvRow(["BITÁCORA ACADÉMICA"]));
  filas.push(eduCsvRow(["Alumno", page.studentName]));
  filas.push(eduCsvRow(["Matrícula", page.matricula]));
  filas.push(eduCsvRow(["Especialidad", page.programName]));
  filas.push(eduCsvRow(["Generación", page.cohortName]));
  filas.push(eduCsvRow(["Semestre", page.semester]));
  filas.push(eduCsvRow(["Estado", page.statusLabel]));
  filas.push(eduCsvRow(["Horas clínicas", page.hoursLabel]));
  filas.push(
    eduCsvRow([
      "De ellas, estimadas por falta de sellos",
      eduHoursLabel(page.hours.estimatedMinutes),
    ]),
  );
  filas.push(
    eduCsvRow([
      "Promedio",
      page.averageLabel ?? "sin calificaciones",
      page.averageScaleMax ? `sobre ${page.averageScaleMax}` : "",
    ]),
  );
  filas.push(eduCsvRow(["Avance", page.verdict.motivo]));
  filas.push(eduCsvRow(["Generado", page.generatedLabel]));
  filas.push("");

  filas.push(eduCsvRow(["REQUISITOS DEL PLAN DE ESTUDIOS"]));
  filas.push(
    eduCsvRow(["Requisito", "Necesita", "Lleva", "Faltan", "Esperados a esta altura", "Cumplido"]),
  );
  for (const r of page.requirements) {
    filas.push(
      eduCsvRow([
        r.name,
        r.requiredCount,
        r.doneCount,
        r.missingCount,
        r.expectedCount,
        r.met ? "Sí" : "No",
      ]),
    );
  }
  filas.push("");

  filas.push(eduCsvRow(["CASOS"]));
  filas.push(
    eduCsvRow([
      "Paciente",
      "Folio",
      "Especialidad",
      "Procedimiento",
      "Estado",
      "Abierto",
      "Cerrado",
      "Calificación",
      "Viene de un traspaso",
    ]),
  );
  for (const c of page.cases) {
    filas.push(
      eduCsvRow([
        c.patientName,
        c.patientFolio,
        c.programName,
        c.procedureName ?? "sin procedimiento",
        c.status,
        c.openedLabel,
        c.closedLabel ?? "",
        c.gradeLabel ? `${c.gradeLabel} / ${c.gradeScaleMax}` : "",
        c.transferredFromCaseId ? "Sí" : "No",
      ]),
    );
  }
  filas.push("");

  filas.push(eduCsvRow(["CALIFICACIONES"]));
  filas.push(
    eduCsvRow([
      "Fecha",
      "Paciente",
      "Rúbrica",
      "Calificación",
      "Escala",
      "Calificó",
      "Vigente",
      "Comentario",
    ]),
  );
  for (const g of page.grades) {
    filas.push(
      eduCsvRow([
        g.gradedLabel,
        g.patientName,
        g.rubricName,
        g.finalScoreLabel,
        g.scaleMax,
        g.gradedByName,
        g.current ? "Sí" : "No (corregida)",
        g.comment ?? "",
      ]),
    );
  }
  filas.push("");

  filas.push(eduCsvRow(["TRASPASOS"]));
  filas.push(eduCsvRow(["Fecha", "Paciente", "Especialidad", "De", "A", "Motivo", "Lo hizo"]));
  for (const t of page.transfers) {
    filas.push(
      eduCsvRow([
        t.atLabel,
        t.patientName,
        t.programName,
        t.fromStudentName,
        t.toStudentName,
        t.reason ?? "",
        t.byName ?? "",
      ]),
    );
  }

  return eduCsvFile(filas);
}
