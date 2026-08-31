/**
 * DaleControl INSTITUCIONAL — RÚBRICAS Y CALIFICACIONES contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro (los pesos, la calificación final, los
 * topes) vive en evaluacion-core.ts y el recorte de filas en visibility.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SOLO EL DOCENTE (O LA DIRECCIÓN) CALIFICA. EL ALUMNO VE.
 *
 * Y no basta con no darle el permiso: son DOS cerraduras, como todo lo que
 * importa en este vertical.
 *   1. el permiso "evaluacion.grade", que un ALUMNO no tiene por default;
 *   2. el ALCANCE — el caso que se califica se busca con el `where` del
 *      recurso "cases", así que un docente solo puede calificar casos de
 *      los alumnos que supervisa HOY, y si alguien le encendiera
 *      "evaluacion.grade" a un alumno por error, solo alcanzaría sus
 *      propios casos… y ahí lo para la tercera línea de defensa: NADIE
 *      puede calificarse a sí mismo (ver createEduGrade).
 *
 * 🔴 UNA CALIFICACIÓN GUARDADA NO SE EDITA EN SILENCIO. No hay UPDATE de
 * calificaciones en este archivo — a propósito. Corregir es INSERTAR una
 * fila nueva que apunta a la anterior (`correctsId`), igual que la nota
 * firmada del expediente de la Ola 3. La vigente es la que nadie corrige,
 * y las dos quedan con su autor y su hora.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import {
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduStudentScopeWhere,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_CRITERION_DESC_MAX,
  EDU_CRITERION_NAME_MAX,
  EDU_EVALUACION_MAX_ROWS,
  EDU_GRADE_COMMENT_MAX,
  EDU_GRADE_ITEM_COMMENT_MAX,
  EDU_RUBRIC_NAME_MAX,
  EDU_RUBRIC_NOTES_MAX,
  eduComputeFinalScore,
  eduCurrentGrade,
  eduEvalBoolean,
  eduEvalInt,
  eduEvalOptionalText,
  eduEvalText,
  eduParseScoreX100,
  eduRubricWeightCheck,
  eduScaleCheck,
  eduScoreLabel,
  type EduGradeRow,
  type EduRubricRow,
} from "@/lib/edu/evaluacion-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: { firstName: string; lastName: string; email?: string | null }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LAS RÚBRICAS
// ═══════════════════════════════════════════════════════════════════════

const RUBRIC_SELECT = {
  id: true,
  name: true,
  programId: true,
  procedureId: true,
  scaleMin: true,
  scaleMax: true,
  isActive: true,
  orderIndex: true,
  notes: true,
  program: { select: { name: true } },
  procedure: { select: { name: true } },
  criteria: {
    orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      weightPercent: true,
      orderIndex: true,
    },
  },
  _count: { select: { grades: true } },
} satisfies Prisma.EduRubricSelect;

type RubricPayload = Prisma.EduRubricGetPayload<{ select: typeof RUBRIC_SELECT }>;

function toRubricRow(r: RubricPayload): EduRubricRow {
  return {
    id: r.id,
    name: r.name,
    programId: r.programId,
    programName: r.program?.name ?? null,
    procedureId: r.procedureId,
    procedureName: r.procedure?.name ?? null,
    scaleMin: r.scaleMin,
    scaleMax: r.scaleMax,
    isActive: r.isActive,
    orderIndex: r.orderIndex,
    notes: r.notes,
    criteria: r.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      weightPercent: c.weightPercent,
      orderIndex: c.orderIndex,
    })),
    usedIn: r._count.grades,
  };
}

/**
 * Las rúbricas del instituto.
 *
 * No lleva recorte por alumno y no es un olvido: una rúbrica es el
 * criterio COMPARTIDO de la escuela, no un dato de nadie. Quien puede
 * abrir la pantalla las ve todas — lo que se recorta son las
 * calificaciones, que sí son de alguien.
 */
export async function listEduRubrics(
  ctx: EduClinicaContext,
  filters: { onlyActive?: boolean; programId?: string | null; procedureId?: string | null } = {},
): Promise<EduRubricRow[]> {
  const institutionId = requireInstitution(ctx);

  const where: Prisma.EduRubricWhereInput = { institutionId };
  if (filters.onlyActive) where.isActive = true;
  if (filters.programId) {
    // Una rúbrica SIN especialidad sirve para todas: tiene que salir en el
    // desplegable de cualquiera. Filtrar solo por igualdad dejaría fuera
    // justo la rúbrica general de la escuela chica.
    where.OR = [{ programId: filters.programId }, { programId: null }];
  }
  if (filters.procedureId) {
    where.AND = [
      { OR: [{ procedureId: filters.procedureId }, { procedureId: null }] },
    ];
  }

  const rows = await prisma.eduRubric.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { orderIndex: "asc" }, { name: "asc" }],
    take: EDU_EVALUACION_MAX_ROWS,
    select: RUBRIC_SELECT,
  });
  return rows.map(toRubricRow);
}

export interface EduRubricInput {
  name?: unknown;
  programId?: unknown;
  procedureId?: unknown;
  scaleMin?: unknown;
  scaleMax?: unknown;
  notes?: unknown;
  isActive?: unknown;
  orderIndex?: unknown;
  criteria?: unknown;
}

interface CriterioLimpio {
  name: string;
  description: string | null;
  weightPercent: number;
  orderIndex: number;
}

/**
 * Los criterios que llegan del formulario, saneados Y VALIDADOS.
 *
 * 🔴 Los pesos se validan AQUÍ, al guardar la rúbrica, y no al calificar.
 * Ver el porqué largo en eduRubricWeightCheck: el error tiene que salirle
 * a quien diseña la rúbrica sentado, no al docente de pie con el paciente
 * ya atendido.
 */
function limpiarCriterios(raw: unknown): CriterioLimpio[] {
  if (!Array.isArray(raw)) {
    throw new EduPadronError("Manda al menos un criterio para la rúbrica.");
  }

  const criterios: CriterioLimpio[] = [];
  const vistos = new Set<string>();
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null) return;
    const c = item as Record<string, unknown>;
    const name = eduEvalText(c.name, EDU_CRITERION_NAME_MAX);
    if (!name) return;
    const clave = name.toLowerCase();
    if (vistos.has(clave)) {
      throw new EduPadronError(`El criterio "${name}" está repetido en la rúbrica.`);
    }
    vistos.add(clave);
    const weightPercent = eduEvalInt(c.weightPercent, 1, 100);
    if (weightPercent === null) {
      throw new EduPadronError(
        `El peso de "${name}" tiene que ser un entero entre 1 y 100.`,
      );
    }
    criterios.push({
      name,
      description: eduEvalOptionalText(c.description, EDU_CRITERION_DESC_MAX) ?? null,
      weightPercent,
      orderIndex: eduEvalInt(c.orderIndex, 0, 999) ?? i + 1,
    });
  });

  const check = eduRubricWeightCheck(criterios);
  if (!check.ok) throw new EduPadronError(check.detail);
  return criterios;
}

/** La especialidad y el procedimiento, comprobados contra ESTE instituto. */
async function resolveRubricTargets(
  institutionId: string,
  input: EduRubricInput,
): Promise<{ programId: string | null; procedureId: string | null }> {
  let programId: string | null = null;
  if (input.programId !== undefined && input.programId !== null && input.programId !== "") {
    const id = eduCleanId(input.programId);
    const p = id
      ? await prisma.eduProgram.findFirst({ where: { id, institutionId }, select: { id: true } })
      : null;
    if (!p) throw new EduPadronError("Esa especialidad no es de este instituto.", 404);
    programId = p.id;
  }

  let procedureId: string | null = null;
  if (input.procedureId !== undefined && input.procedureId !== null && input.procedureId !== "") {
    const id = eduCleanId(input.procedureId);
    const p = id
      ? await prisma.eduProcedure.findFirst({ where: { id, institutionId }, select: { id: true } })
      : null;
    if (!p) throw new EduPadronError("Ese procedimiento no es de este instituto.", 404);
    procedureId = p.id;
  }

  return { programId, procedureId };
}

/** Crea una rúbrica con sus criterios, en UNA transacción. */
export async function createEduRubric(
  ctx: EduClinicaContext,
  input: EduRubricInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const name = eduEvalText(input.name, EDU_RUBRIC_NAME_MAX);
  if (!name) throw new EduPadronError("Ponle nombre a la rúbrica.");

  const scaleMin = eduEvalInt(input.scaleMin, 0, 1000) ?? 0;
  const scaleMax = eduEvalInt(input.scaleMax, 0, 1000) ?? 100;
  const escalaMala = eduScaleCheck(scaleMin, scaleMax);
  if (escalaMala) throw new EduPadronError(escalaMala);

  const criterios = limpiarCriterios(input.criteria);
  const targets = await resolveRubricTargets(institutionId, input);

  const repetida = await prisma.eduRubric.findFirst({
    where: { institutionId, name },
    select: { id: true },
  });
  if (repetida) {
    throw new EduPadronError(`Ya hay una rúbrica que se llama "${name}".`, 409);
  }

  // La rúbrica y sus criterios se escriben JUNTOS o no se escriben: una
  // rúbrica sin criterios es una opción del desplegable que no califica
  // nada, y nadie entendería por qué está ahí.
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.eduRubric.create({
      data: {
        institutionId,
        name,
        programId: targets.programId,
        procedureId: targets.procedureId,
        scaleMin,
        scaleMax,
        notes: eduEvalOptionalText(input.notes, EDU_RUBRIC_NOTES_MAX) ?? null,
        orderIndex: eduEvalInt(input.orderIndex, 0, 999) ?? 0,
      },
      select: { id: true },
    });

    await tx.eduRubricCriterion.createMany({
      data: criterios.map((c) => ({
        institutionId,
        rubricId: r.id,
        name: c.name,
        description: c.description,
        weightPercent: c.weightPercent,
        orderIndex: c.orderIndex,
      })),
    });

    return r;
  });

  return created;
}

/**
 * Edita una rúbrica.
 *
 * 🔴 Los criterios se REEMPLAZAN en bloque cuando vienen, y las
 * calificaciones YA HECHAS no se tocan: cada una guarda el nombre del
 * criterio y su peso CONGELADOS (EduCaseGradeItem). Cambiar la rúbrica
 * mañana no recalcula lo que se calificó ayer — que es exactamente lo que
 * pasaría si los items apuntaran solo por id.
 */
export async function updateEduRubric(
  ctx: EduClinicaContext,
  rubricId: string,
  input: EduRubricInput,
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(rubricId);
  const actual = id
    ? await prisma.eduRubric.findFirst({
        where: { id, institutionId },
        select: { id: true, name: true },
      })
    : null;
  if (!actual) throw new EduPadronError("Esa rúbrica no es de este instituto.", 404);

  const data: Prisma.EduRubricUpdateInput = {};

  if (input.name !== undefined) {
    const name = eduEvalText(input.name, EDU_RUBRIC_NAME_MAX);
    if (!name) throw new EduPadronError("Ponle nombre a la rúbrica.");
    if (name !== actual.name) {
      const repetida = await prisma.eduRubric.findFirst({
        where: { institutionId, name, id: { not: actual.id } },
        select: { id: true },
      });
      if (repetida) throw new EduPadronError(`Ya hay una rúbrica que se llama "${name}".`, 409);
    }
    data.name = name;
  }

  if (input.scaleMin !== undefined || input.scaleMax !== undefined) {
    const previo = await prisma.eduRubric.findFirst({
      where: { id: actual.id, institutionId },
      select: { scaleMin: true, scaleMax: true },
    });
    const scaleMin = eduEvalInt(input.scaleMin, 0, 1000) ?? previo?.scaleMin ?? 0;
    const scaleMax = eduEvalInt(input.scaleMax, 0, 1000) ?? previo?.scaleMax ?? 100;
    const mala = eduScaleCheck(scaleMin, scaleMax);
    if (mala) throw new EduPadronError(mala);
    data.scaleMin = scaleMin;
    data.scaleMax = scaleMax;
  }

  if (input.programId !== undefined || input.procedureId !== undefined) {
    const targets = await resolveRubricTargets(institutionId, input);
    if (input.programId !== undefined) {
      data.program = targets.programId
        ? { connect: { id: targets.programId } }
        : { disconnect: true };
    }
    if (input.procedureId !== undefined) {
      data.procedure = targets.procedureId
        ? { connect: { id: targets.procedureId } }
        : { disconnect: true };
    }
  }

  if (input.notes !== undefined) {
    data.notes = eduEvalOptionalText(input.notes, EDU_RUBRIC_NOTES_MAX) ?? null;
  }
  if (input.isActive !== undefined) {
    const v = eduEvalBoolean(input.isActive);
    if (v === null) throw new EduPadronError("El estado de la rúbrica no es válido.");
    data.isActive = v;
  }
  if (input.orderIndex !== undefined) {
    data.orderIndex = eduEvalInt(input.orderIndex, 0, 999) ?? 0;
  }

  const criterios = input.criteria !== undefined ? limpiarCriterios(input.criteria) : null;

  if (Object.keys(data).length === 0 && !criterios) {
    throw new EduPadronError("No mandaste ningún cambio.");
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.eduRubric.update({ where: { id: actual.id }, data });
    }
    if (criterios) {
      // ═══════════════════════════════════════════════════════════════
      // Los criterios se reconcilian POR NOMBRE, no se borran y se
      // vuelven a crear.
      //
      // 🔴 La diferencia importa y no es de estilo. `EduCaseGradeItem`
      // guarda el nombre y el peso CONGELADOS —así que borrar y recrear
      // no rompería ninguna calificación vieja— pero además guarda el
      // `criterionId`, que es lo único que permite preguntar "¿cómo va la
      // escuela en Aislamiento?" a lo largo de un año. Con delete+create,
      // ajustar un peso en marzo dejaría ese id en NULL para todo lo
      // calificado antes, y la pregunta se volvería incontestable sin que
      // nadie notara nada.
      //
      // El nombre es la llave natural: el índice único es
      // (rubricId, name), así que un criterio que conserva su nombre es
      // el mismo criterio.
      // ═══════════════════════════════════════════════════════════════
      const previos = await tx.eduRubricCriterion.findMany({
        where: { institutionId, rubricId: actual.id },
        select: { id: true, name: true },
      });
      const porNombre = new Map(previos.map((p) => [p.name, p.id]));
      const nombresNuevos = new Set(criterios.map((c) => c.name));

      const sobran = previos.filter((p) => !nombresNuevos.has(p.name)).map((p) => p.id);
      if (sobran.length > 0) {
        await tx.eduRubricCriterion.deleteMany({
          where: { institutionId, rubricId: actual.id, id: { in: sobran } },
        });
      }

      for (const c of criterios) {
        const previoId = porNombre.get(c.name);
        if (previoId) {
          await tx.eduRubricCriterion.update({
            where: { id: previoId },
            data: {
              description: c.description,
              weightPercent: c.weightPercent,
              orderIndex: c.orderIndex,
            },
          });
        } else {
          await tx.eduRubricCriterion.create({
            data: {
              institutionId,
              rubricId: actual.id,
              name: c.name,
              description: c.description,
              weightPercent: c.weightPercent,
              orderIndex: c.orderIndex,
            },
          });
        }
      }
    }
  });

  return { id: actual.id };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LAS CALIFICACIONES
// ═══════════════════════════════════════════════════════════════════════

const GRADE_SELECT = {
  id: true,
  caseId: true,
  studentId: true,
  rubricId: true,
  rubricName: true,
  scaleMin: true,
  scaleMax: true,
  finalScoreX100: true,
  comment: true,
  gradedById: true,
  gradedAt: true,
  correctsId: true,
  gradedBy: { select: { firstName: true, lastName: true, email: true } },
  student: {
    select: { id: true, user: { select: { firstName: true, lastName: true, email: true } } },
  },
  case: {
    select: {
      patient: { select: { firstName: true, lastName: true, folio: true } },
      program: { select: { name: true } },
      procedure: { select: { name: true } },
    },
  },
  items: {
    orderBy: [{ orderIndex: "asc" }],
    select: {
      id: true,
      criterionId: true,
      criterionName: true,
      weightPercent: true,
      scoreX100: true,
      comment: true,
    },
  },
} satisfies Prisma.EduCaseGradeSelect;

type GradePayload = Prisma.EduCaseGradeGetPayload<{ select: typeof GRADE_SELECT }>;

/**
 * La fila que viaja a la pantalla, con las fechas ya formateadas en la
 * zona del INSTITUTO — nunca la del navegador, que rompería la hidratación
 * y además diría otra hora.
 */
export function toEduGradeRow(g: GradePayload, timeZone: string, current: boolean): EduGradeRow {
  return {
    id: g.id,
    caseId: g.caseId,
    studentId: g.studentId,
    studentName: personName(g.student.user),
    rubricId: g.rubricId,
    rubricName: g.rubricName,
    scaleMin: g.scaleMin,
    scaleMax: g.scaleMax,
    finalScoreX100: g.finalScoreX100,
    finalScoreLabel: eduScoreLabel(g.finalScoreX100),
    comment: g.comment,
    gradedById: g.gradedById,
    gradedByName: personName(g.gradedBy),
    gradedAt: g.gradedAt.toISOString(),
    gradedLabel: new Intl.DateTimeFormat("es-MX", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(g.gradedAt),
    correctsId: g.correctsId,
    current,
    items: g.items.map((it) => ({
      id: it.id,
      criterionId: it.criterionId,
      criterionName: it.criterionName,
      weightPercent: it.weightPercent,
      scoreX100: it.scoreX100,
      scoreLabel: eduScoreLabel(it.scoreX100),
      comment: it.comment,
    })),
    patientName:
      [g.case.patient.firstName, g.case.patient.lastName].filter(Boolean).join(" ").trim() ||
      "Sin nombre",
    patientFolio: g.case.patient.folio,
    programName: g.case.program.name,
    procedureName: g.case.procedure?.name ?? null,
  };
}

/** Marca cuál de las filas es la VIGENTE (la que nadie corrige). */
function marcarVigentes(rows: GradePayload[], timeZone: string): EduGradeRow[] {
  const corregidas = new Set(
    rows.map((g) => g.correctsId).filter((id): id is string => typeof id === "string"),
  );
  return rows.map((g) => toEduGradeRow(g, timeZone, !corregidas.has(g.id)));
}

/**
 * Las calificaciones DE UN CASO, dentro del alcance.
 *
 * El caso se busca con el `where` del recurso "cases": uno que no le toca
 * a quien pregunta contesta lista vacía, igual que uno que no existe.
 */
export async function listEduCaseGrades(
  ctx: EduClinicaContext,
  caseId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduGradeRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(caseId);
  if (!id) return [];

  const caso = await prisma.eduCase.findFirst({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id },
    select: { id: true },
  });
  if (!caso) return [];

  const rows = await prisma.eduCaseGrade.findMany({
    where: { institutionId, caseId: caso.id },
    orderBy: [{ gradedAt: "desc" }],
    take: EDU_EVALUACION_MAX_ROWS,
    select: GRADE_SELECT,
  });
  return marcarVigentes(rows, timeZone);
}

/**
 * Las calificaciones de UN ALUMNO (la bitácora).
 *
 * 🔴 P0-1 DE LA AUDITORÍA — EL ALUMNO SE BUSCA DENTRO DEL ALCANCE, y ésta
 * era la única lectura del vertical que no lo hacía. Con un `where` de
 * `{ institutionId, studentId }` a secas,
 * `GET /api/instituto/calificaciones?alumno=<id de un compañero>` le
 * contestaba a CUALQUIERA con "evaluacion.view" —el ALUMNO la tiene por
 * defecto— el expediente académico entero del compañero: cada criterio con
 * su comentario, quién lo calificó y, lo que de verdad duele, el nombre y
 * el FOLIO de los pacientes que atendió.
 *
 * El recorte no se escribe a mano aquí: se pide el mismo helper de siempre
 * (`eduStudentScopeWhere`, del recurso "cases") y se resuelve al alumno
 * ANTES de leer sus notas, exactamente como `getEduBitacora`
 * (evaluacion.ts). Un alumno que no le toca a quien pregunta se ve igual
 * que uno que no existe: lista vacía.
 *
 * Reparto: ALUMNO → las suyas; DOCENTE → las de sus alumnos con asignación
 * VIGENTE; DIRECCION → todas; CAJA → ninguna (cobrar no es evaluar).
 *
 * ⚠️ `getEduBitacora` ya resolvió al alumno con este mismo `where` antes de
 * llamar aquí, así que en esa ruta la consulta se repite. Es un `findFirst`
 * por id y se paga a gusto: el precio de que el recorte viva DENTRO de la
 * función es que ninguna llamada futura pueda olvidárselo.
 */
export async function listEduStudentGrades(
  ctx: EduClinicaContext,
  studentId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduGradeRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(studentId);
  if (!id) return [];

  const alumno = await prisma.eduStudent.findFirst({
    where: { ...eduStudentScopeWhere({ institutionId, scope, now }), id },
    select: { id: true },
  });
  if (!alumno) return [];

  const rows = await prisma.eduCaseGrade.findMany({
    where: { institutionId, studentId: alumno.id },
    orderBy: [{ gradedAt: "desc" }],
    take: EDU_EVALUACION_MAX_ROWS,
    select: GRADE_SELECT,
  });
  return marcarVigentes(rows, timeZone);
}

export interface EduGradeInput {
  caseId?: unknown;
  rubricId?: unknown;
  comment?: unknown;
  /** [{ criterionId, scoreX100 | score, comment }] */
  items?: unknown;
  /** La calificación a la que ésta corrige. */
  correctsId?: unknown;
}

/**
 * CALIFICAR un caso (o corregir una calificación anterior).
 *
 * Las tres cosas que hace y que no se pueden mover de aquí:
 *
 *  1. 🔴 NADIE SE CALIFICA A SÍ MISMO. Aunque alguien le encendiera
 *     "evaluacion.grade" a un alumno por override, el caso que puede
 *     alcanzar es el suyo — y calificarse a uno mismo se rebota aquí, no
 *     en la pantalla. Es la única regla de esta ola que no depende ni del
 *     permiso ni del alcance.
 *  2. La escala y el nombre de la rúbrica se CONGELAN en la fila. Renombrar
 *     la rúbrica o subir la escala mañana no reinterpreta esta
 *     calificación.
 *  3. La final se CALCULA en el servidor con los pesos guardados. El
 *     número que mande el navegador no se usa para nada — igual que en la
 *     caja de la Ola 5, si el navegador supiera calcular una calificación,
 *     sabría calcular una mejor.
 */
export async function createEduGrade(
  ctx: EduClinicaContext,
  input: EduGradeInput,
  now: Date = new Date(),
): Promise<{ id: string; finalScoreX100: number }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no califica casos clínicos.", 403);
  }

  const caseId = eduCleanId(input.caseId);
  if (!caseId) throw new EduPadronError("Elige el caso que vas a calificar.");

  const caso = await prisma.eduCase.findFirst({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id: caseId },
    select: { id: true, studentId: true, student: { select: { userId: true } } },
  });
  if (!caso) throw new EduPadronError("Ese caso no es de este instituto.", 404);

  // 1 · Nadie se califica a sí mismo.
  if (caso.student.userId === ctx.eduUserId) {
    throw new EduPadronError(
      "No puedes calificar tu propio caso. La calificación la pone el docente o la dirección.",
      403,
    );
  }

  const rubricId = eduCleanId(input.rubricId);
  const rubrica = rubricId
    ? await prisma.eduRubric.findFirst({
        where: { id: rubricId, institutionId },
        select: {
          id: true,
          name: true,
          scaleMin: true,
          scaleMax: true,
          isActive: true,
          criteria: {
            orderBy: [{ orderIndex: "asc" }],
            select: { id: true, name: true, weightPercent: true, orderIndex: true },
          },
        },
      })
    : null;
  if (!rubrica) throw new EduPadronError("Elige una rúbrica de este instituto.", 404);
  if (!rubrica.isActive) {
    throw new EduPadronError("Esa rúbrica está desactivada. Elige una vigente.");
  }
  if (rubrica.criteria.length === 0) {
    throw new EduPadronError("Esa rúbrica no tiene criterios: no se puede calificar con ella.");
  }

  // La corrección tiene que ser del MISMO caso: encadenar la calificación
  // de un caso con la de otro dejaría las dos "vigentes" y ninguna de las
  // dos contaría lo que pasó.
  let correctsId: string | null = null;
  if (input.correctsId !== undefined && input.correctsId !== null && input.correctsId !== "") {
    const id = eduCleanId(input.correctsId);
    const previa = id
      ? await prisma.eduCaseGrade.findFirst({
          where: { id, institutionId, caseId: caso.id },
          select: { id: true },
        })
      : null;
    if (!previa) {
      throw new EduPadronError("Esa calificación anterior no es de este caso.", 404);
    }
    const yaCorregida = await prisma.eduCaseGrade.findFirst({
      where: { institutionId, correctsId: previa.id },
      select: { id: true },
    });
    if (yaCorregida) {
      throw new EduPadronError(
        "Esa calificación ya se corrigió. Recarga la pantalla: estás mirando una versión vieja.",
        409,
      );
    }
    correctsId = previa.id;
  }

  // 2 · Las puntuaciones, criterio por criterio y contra la rúbrica.
  const crudos = Array.isArray(input.items) ? input.items : [];
  const porCriterio = new Map<string, { scoreX100: number; comment: string | null }>();
  for (const raw of crudos) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as Record<string, unknown>;
    const cid = eduCleanId(it.criterionId);
    if (!cid) continue;
    const score = eduParseScoreX100(
      it.scoreX100 !== undefined ? it.scoreX100 : it.score,
      rubrica.scaleMin,
      rubrica.scaleMax,
    );
    if (score === null) continue;
    porCriterio.set(cid, {
      scoreX100: score,
      comment: eduEvalOptionalText(it.comment, EDU_GRADE_ITEM_COMMENT_MAX) ?? null,
    });
  }

  const faltan = rubrica.criteria.filter((c) => !porCriterio.has(c.id));
  if (faltan.length > 0) {
    throw new EduPadronError(
      `Falta la puntuación de: ${faltan.map((c) => c.name).join(", ")}. Cada criterio se califica entre ${rubrica.scaleMin} y ${rubrica.scaleMax}.`,
    );
  }

  const items = rubrica.criteria.map((c, i) => {
    const dato = porCriterio.get(c.id)!;
    return {
      criterionId: c.id,
      criterionName: c.name,
      weightPercent: c.weightPercent,
      scoreX100: dato.scoreX100,
      comment: dato.comment,
      orderIndex: c.orderIndex || i + 1,
    };
  });

  // 3 · La final la calcula el SERVIDOR.
  const finalScoreX100 = eduComputeFinalScore(items);

  const created = await prisma.$transaction(async (tx) => {
    const g = await tx.eduCaseGrade.create({
      data: {
        institutionId,
        caseId: caso.id,
        studentId: caso.studentId,
        rubricId: rubrica.id,
        rubricName: rubrica.name,
        scaleMin: rubrica.scaleMin,
        scaleMax: rubrica.scaleMax,
        gradedById: ctx.eduUserId,
        gradedAt: now,
        finalScoreX100,
        comment: eduEvalOptionalText(input.comment, EDU_GRADE_COMMENT_MAX) ?? null,
        correctsId,
      },
      select: { id: true },
    });

    await tx.eduCaseGradeItem.createMany({
      data: items.map((it) => ({
        institutionId,
        gradeId: g.id,
        criterionId: it.criterionId,
        criterionName: it.criterionName,
        weightPercent: it.weightPercent,
        scoreX100: it.scoreX100,
        comment: it.comment,
        orderIndex: it.orderIndex,
      })),
    });

    return g;
  });

  return { id: created.id, finalScoreX100 };
}

/**
 * La calificación VIGENTE de una lista de casos, para pintar la columna
 * "Calificación" sin una consulta por caso.
 *
 * Devuelve un mapa caseId → calificación vigente. La vigencia se calcula
 * con eduCurrentGrade (módulo puro): la fila que nadie corrige.
 */
export async function mapEduCurrentGrades(
  institutionId: string,
  caseIds: string[],
): Promise<Map<string, { id: string; finalScoreX100: number; scaleMax: number }>> {
  const out = new Map<string, { id: string; finalScoreX100: number; scaleMax: number }>();
  const ids = (caseIds ?? []).filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return out;

  const rows = await prisma.eduCaseGrade.findMany({
    where: { institutionId, caseId: { in: ids } },
    orderBy: [{ gradedAt: "desc" }],
    select: {
      id: true,
      caseId: true,
      correctsId: true,
      finalScoreX100: true,
      scaleMax: true,
    },
  });

  const porCaso = new Map<string, typeof rows>();
  for (const r of rows) {
    const lista = porCaso.get(r.caseId);
    if (lista) lista.push(r);
    else porCaso.set(r.caseId, [r]);
  }

  // `forEach` y no `for…of`: el `target` de tsconfig no baja los
  // iteradores de Map, y un `for…of` sobre un Map no compila en este repo.
  porCaso.forEach((lista, caseId) => {
    const vigente = eduCurrentGrade<(typeof rows)[number]>(lista);
    if (vigente) {
      out.set(caseId, {
        id: vigente.id,
        finalScoreX100: vigente.finalScoreX100,
        scaleMax: vigente.scaleMax,
      });
    }
  });
  return out;
}
