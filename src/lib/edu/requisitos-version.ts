/**
 * DaleControl INSTITUCIONAL — EL REQUISITO VERSIONADO POR COHORTE contra
 * la base (H-89).
 *
 * SERVIDOR: importa prisma. Lo puro (qué versión aplica a quién, si un
 * cambio duele) vive en requisitos-version-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ ARREGLA (H-89)
 *
 * «Subir el mínimo de 8 a 12 en marzo y TODA la escuela —incluida la que
 * se gradúa en junio— pasa de "Cumplido 8 de 8" a "Te faltan 4 de 12". El
 * alumno lo ve esa tarde, sin explicación y sin fecha.»
 *
 * ⛔ ESTE ARCHIVO NO TOCA `src/lib/edu/evaluacion.ts` NI la pantalla de
 * requisitos, que son de otra casilla de esta ola. La fila viva de
 * `EduRequirement` sigue siendo LA VIGENTE y todo el código que ya existe
 * la lee igual, sin cambiar una línea. Lo que esto añade es el LIBRO de
 * versiones, y `eduRequisitoEfectivo` (en el core) para que la Ola C·2
 * mida a cada alumno contra la versión de SU generación.
 *
 * 🔴 Y NO SE VERSIONA SOLO. Escribir una versión es un acto explícito: la
 * primera vez que alguien cambia un requisito, la pantalla ofrece
 * congelar lo anterior. Sin ese acto, una escuela que nunca ha versionado
 * nada funciona exactamente igual que antes de esta ola — que es lo que
 * hace que aplicarla no rompa nada.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText } from "@/lib/edu/agenda-core";
import {
  EDU_REQ_VERSION_NOTES_MAX,
  eduRequisitoCambioDuele,
  eduRequisitoEfectivo,
  eduRequisitoParseCount,
  type EduRequirementVersionLike,
} from "@/lib/edu/requisitos-version-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduReqVersionContext extends EduAuditActor {
  user: { firstName: string; lastName: string; permissionsOverride?: string[] | null };
}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

export interface EduReqVersionRow {
  id: string;
  version: number;
  cohortId: string | null;
  cohortName: string | null;
  requiredCount: number;
  semesterFrom: number | null;
  semesterTo: number | null;
  onlyCompleted: boolean;
  notes: string | null;
  effectiveFrom: string;
  createdByName: string;
}

/**
 * LAS VERSIONES de un requisito, más recientes primero, más la que está
 * VIGENTE hoy para la regla general.
 */
export async function listEduRequisitoVersiones(
  ctx: { institutionId: string },
  requirementId: string,
  now: Date = new Date(),
): Promise<{ rows: EduReqVersionRow[]; vigenteGeneral: number | null }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(requirementId);
  if (!id) throw new EduPadronError("Falta el requisito.", 400);

  const req = await prisma.eduRequirement.findFirst({
    where: { id, institutionId },
    select: {
      id: true,
      requiredCount: true,
      semesterFrom: true,
      semesterTo: true,
      onlyCompleted: true,
      notes: true,
    },
  });
  if (!req) throw new EduPadronError("Ese requisito no existe o no es de tu instituto.", 404);

  const filas = await prisma.eduRequirementVersion.findMany({
    where: { institutionId, requirementId: req.id },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    take: 100,
    include: { cohort: { select: { name: true } } },
  });

  const comoLike: EduRequirementVersionLike[] = filas.map((v) => ({
    id: v.id,
    version: v.version,
    cohortId: v.cohortId,
    effectiveFrom: v.effectiveFrom,
    requiredCount: v.requiredCount,
    semesterFrom: v.semesterFrom,
    semesterTo: v.semesterTo,
    onlyCompleted: v.onlyCompleted,
    notes: v.notes,
  }));

  const efectivo = eduRequisitoEfectivo(req, comoLike, null, now);

  return {
    rows: filas.map((v) => ({
      id: v.id,
      version: v.version,
      cohortId: v.cohortId,
      cohortName: v.cohort?.name ?? null,
      requiredCount: v.requiredCount,
      semesterFrom: v.semesterFrom,
      semesterTo: v.semesterTo,
      onlyCompleted: v.onlyCompleted,
      notes: v.notes,
      effectiveFrom: v.effectiveFrom.toISOString(),
      createdByName: v.createdByName,
    })),
    vigenteGeneral: efectivo.version,
  };
}

/**
 * CONGELA una versión del requisito.
 *
 * 🔴 EL NÚMERO DE VERSIÓN LO CALCULA EL SERVIDOR y el índice único
 * (requirementId, version) es el candado de verdad: dos coordinadores
 * versionando a la vez calcularían el mismo número, y sin el índice
 * quedarían dos versiones 3. Con él, la segunda choca (P2002) y se
 * reintenta — el mismo patrón que el folio del cobro y el del cuestionario.
 *
 * 🔴 SE AVISA SI EL CAMBIO DUELE. `eduRequisitoCambioDuele` devuelve true
 * cuando el mínimo SUBE o cuando se pasa a "solo completados": los dos
 * casos le quitan avance a todo el mundo de golpe. No BLOQUEA —subir el
 * mínimo es una decisión legítima de la escuela— pero el aviso viaja en la
 * respuesta para que la pantalla lo pueda poner delante antes de guardar.
 */
export async function createEduRequisitoVersion(
  ctx: EduReqVersionContext,
  requirementId: string,
  body: {
    cohortId?: unknown;
    requiredCount?: unknown;
    semesterFrom?: unknown;
    semesterTo?: unknown;
    onlyCompleted?: unknown;
    notes?: unknown;
    effectiveFrom?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; version: number; duele: boolean }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(requirementId);
  if (!id) throw new EduPadronError("Falta el requisito.", 400);

  const req = await prisma.eduRequirement.findFirst({
    where: { id, institutionId },
    select: {
      id: true,
      name: true,
      requiredCount: true,
      semesterFrom: true,
      semesterTo: true,
      onlyCompleted: true,
      notes: true,
    },
  });
  if (!req) throw new EduPadronError("Ese requisito no existe o no es de tu instituto.", 404);

  let cohortId: string | null = null;
  const rawCohort = eduCleanId(body?.cohortId);
  if (rawCohort) {
    const c = await prisma.eduCohort.findFirst({
      where: { id: rawCohort, institutionId },
      select: { id: true },
    });
    if (!c) throw new EduPadronError("Esa generación no existe o no es de tu instituto.", 404);
    cohortId = c.id;
  }

  const snapshot = {
    requiredCount:
      body?.requiredCount === undefined
        ? req.requiredCount
        : eduRequisitoParseCount(body.requiredCount),
    semesterFrom:
      body?.semesterFrom === undefined
        ? req.semesterFrom
        : body.semesterFrom === null
          ? null
          : Number.parseInt(String(body.semesterFrom), 10) || null,
    semesterTo:
      body?.semesterTo === undefined
        ? req.semesterTo
        : body.semesterTo === null
          ? null
          : Number.parseInt(String(body.semesterTo), 10) || null,
    onlyCompleted: body?.onlyCompleted === undefined ? req.onlyCompleted : body.onlyCompleted !== false,
    notes:
      body?.notes === undefined
        ? req.notes
        : (eduOptionalText(body.notes, EDU_REQ_VERSION_NOTES_MAX) ?? null),
  };

  let effectiveFrom = now;
  if (body?.effectiveFrom) {
    const d = new Date(String(body.effectiveFrom));
    if (Number.isNaN(d.getTime())) {
      throw new EduPadronError("La fecha de vigencia no se entiende.", 400);
    }
    effectiveFrom = d;
  }

  const duele = eduRequisitoCambioDuele(req, snapshot);
  const createdByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  for (let intento = 0; intento < 3; intento++) {
    const agg = await prisma.eduRequirementVersion.aggregate({
      where: { institutionId, requirementId: req.id },
      _max: { version: true },
    });
    const version = (agg._max.version ?? 0) + 1;
    try {
      const v = await prisma.eduRequirementVersion.create({
        data: {
          institutionId,
          requirementId: req.id,
          version,
          cohortId,
          ...snapshot,
          effectiveFrom,
          createdById: ctx.eduUserId,
          createdByName,
        },
        select: { id: true, version: true },
      });

      await eduAudit(ctx, {
        action: "create",
        entity: "student",
        entityId: req.id,
        before: { requisito: req.name, requiredCount: req.requiredCount },
        after: { version: v.version, cohortId, ...snapshot, duele },
        ...meta,
      });

      return { id: v.id, version: v.version, duele };
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002" && intento < 2) continue;
      throw err;
    }
  }

  throw new EduPadronError(
    "No se pudo versionar el requisito: otra persona lo está cambiando. Inténtalo otra vez.",
    409,
  );
}
