/**
 * DaleControl INSTITUCIONAL — EL PLAN DE TRATAMIENTO contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro (estados, transiciones, KPI, próxima
 * fecha) vive en plan-tratamiento-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *
 *   · PERMISO — `expediente.view` para leer, `expediente.write` para
 *     armar el plan y marcar sesiones. Ninguna key nueva: el plan de
 *     tratamiento es parte del expediente y quien escribe la nota de una
 *     sesión es quien la hizo.
 *   · ALCANCE — el CLÍNICO (`getEduClinicalPatient`, recurso "cases").
 *     CAJA no ve planes de tratamiento: cobra, no planifica actos
 *     clínicos.
 *
 * ⚠️ EL IMPORTE (`totalCents`) SE GUARDA PERO NO LO VE EL ALUMNO. El plan
 * lo lee el alcance clínico, así que el número viaja; la pantalla de C·2
 * lo esconde para quien no lleva `caja.view`. Se deja escrito aquí porque
 * es exactamente el tipo de detalle que se pierde entre una ola y la
 * siguiente.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText } from "@/lib/edu/agenda-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import {
  EDU_PLAN_DESC_MAX,
  EDU_PLAN_MAX_ROWS,
  EDU_PLAN_MAX_SESIONES,
  EDU_PLAN_SESSION_NOTES_MAX,
  EDU_PLAN_STATUSES_CERRADOS,
  eduPlanAtrasado,
  eduPlanKpis,
  eduPlanParseEntero,
  eduPlanParseNombre,
  eduPlanParseStatus,
  eduPlanProximaFecha,
  eduPlanPuedeTransicionar,
  type EduPlanKpis,
  type EduTreatmentPlanStatus,
} from "@/lib/edu/plan-tratamiento-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduPlanContext extends EduClinicaContext, EduAuditActor {}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

export interface EduPlanRow {
  id: string;
  name: string;
  description: string | null;
  caseId: string | null;
  status: EduTreatmentPlanStatus;
  totalCents: number;
  startsAt: string;
  expectedEndAt: string | null;
  closedAt: string | null;
  nextExpectedAt: string | null;
  closeReason: string | null;
  createdByName: string;
  kpis: EduPlanKpis & { atrasado: boolean };
  sesiones: {
    id: string;
    sessionNumber: number;
    notes: string | null;
    completedAt: string | null;
    appointmentId: string | null;
  }[];
}

/** LOS PLANES de un paciente, con sus sesiones y su avance ya calculado. */
export async function listEduPlanes(
  ctx: EduPlanContext,
  patientId: string,
  now: Date = new Date(),
): Promise<EduPlanRow[]> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const filas = await prisma.eduTreatmentPlan.findMany({
    where: { institutionId, patientId: paciente.id },
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
    take: EDU_PLAN_MAX_ROWS,
    include: {
      sessions: {
        orderBy: { sessionNumber: "asc" },
        select: {
          id: true,
          sessionNumber: true,
          notes: true,
          completedAt: true,
          appointmentId: true,
        },
      },
    },
  });

  return filas.map((p) => {
    const kpis = eduPlanKpis(p.sessions, p.totalSessions);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      caseId: p.caseId,
      status: p.status as EduTreatmentPlanStatus,
      totalCents: p.totalCents,
      startsAt: p.startsAt.toISOString(),
      expectedEndAt: p.expectedEndAt?.toISOString() ?? null,
      closedAt: p.closedAt?.toISOString() ?? null,
      nextExpectedAt: p.nextExpectedAt?.toISOString() ?? null,
      closeReason: p.closeReason,
      createdByName: p.createdByName,
      kpis: {
        ...kpis,
        atrasado: eduPlanAtrasado(p.status as EduTreatmentPlanStatus, p.nextExpectedAt, now),
      },
      sesiones: p.sessions.map((s) => ({
        id: s.id,
        sessionNumber: s.sessionNumber,
        notes: s.notes,
        completedAt: s.completedAt?.toISOString() ?? null,
        appointmentId: s.appointmentId,
      })),
    };
  });
}

/**
 * CREA un plan y sus sesiones vacías de una vez.
 *
 * 🔴 LAS SESIONES SE CREAN TODAS, VACÍAS, DESDE EL PRINCIPIO. Un plan de
 * doce sesiones tiene doce renglones desde el día uno: es lo que permite
 * marcar la 5 sin haber marcado la 4 (pasa: el paciente se saltó una
 * cita), y lo que hace que el avance sea una cuenta y no una resta contra
 * un número guardado.
 *
 * 🔴 EL CASO SE COMPRUEBA DENTRO DEL MISMO PACIENTE. Sin eso, se podría
 * colgar un plan de un caso de otra persona pasando su id: el alcance ya
 * comprobó el paciente, no el caso.
 */
export async function createEduPlan(
  ctx: EduPlanContext,
  patientId: string,
  body: {
    name?: unknown;
    description?: unknown;
    caseId?: unknown;
    totalSessions?: unknown;
    sessionIntervalDays?: unknown;
    totalCents?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const name = eduPlanParseNombre(body?.name);
  const description = eduOptionalText(body?.description, EDU_PLAN_DESC_MAX) ?? null;
  const totalSessions = eduPlanParseEntero(body?.totalSessions, "Las sesiones", 1, EDU_PLAN_MAX_SESIONES, 1);
  const sessionIntervalDays = eduPlanParseEntero(body?.sessionIntervalDays, "El intervalo en días", 1, 365, 30);
  const totalCents = eduPlanParseEntero(body?.totalCents, "El importe en centavos", 0, 99_999_999, 0);

  let caseId: string | null = null;
  const rawCase = eduCleanId(body?.caseId);
  if (rawCase) {
    const caso = await prisma.eduCase.findFirst({
      where: { id: rawCase, institutionId, patientId: paciente.id },
      select: { id: true },
    });
    if (!caso) throw new EduPadronError("Ese caso no existe o no es de este paciente.", 404);
    caseId = caso.id;
  }

  const createdByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  const creado = await prisma.$transaction(async (tx) => {
    const plan = await tx.eduTreatmentPlan.create({
      data: {
        institutionId,
        patientId: paciente.id,
        caseId,
        name,
        description,
        totalSessions,
        sessionIntervalDays,
        totalCents,
        startsAt: now,
        nextExpectedAt: new Date(now.getTime() + sessionIntervalDays * 24 * 60 * 60 * 1000),
        createdById: ctx.eduUserId,
        createdByName,
      },
      select: { id: true },
    });

    await tx.eduTreatmentSession.createMany({
      data: Array.from({ length: totalSessions }, (_, i) => ({
        institutionId,
        planId: plan.id,
        sessionNumber: i + 1,
      })),
    });

    return plan;
  });

  await eduAudit(ctx, {
    action: "create",
    entity: "treatmentPlan",
    entityId: creado.id,
    patientId: paciente.id,
    after: { name, totalSessions, totalCents },
    ...meta,
  });

  return { id: creado.id };
}

/**
 * MARCA (o desmarca) una sesión como hecha, y recalcula la próxima fecha.
 *
 * 🔴 `updateMany` CON EL ESTADO EN EL `where` Y 409 SI `count === 0`. Es la
 * regla de la casa: dos alumnos con el mismo plan abierto, el primero
 * marca la sesión 5, el segundo también — y el segundo recibiría un 200
 * sin haber escrito nada.
 *
 * 🔴 EL PLAN SE RECALCULA EN LA MISMA TRANSACCIÓN. Si `nextExpectedAt` se
 * escribiera después, un fallo entre las dos escrituras dejaría el plan
 * saliendo como atrasado para siempre.
 */
export async function marcarEduPlanSesion(
  ctx: EduPlanContext,
  planId: string,
  sessionId: string,
  body: { hecha?: unknown; notes?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; completedAt: string | null; kpis: EduPlanKpis }> {
  const institutionId = requireInstitution(ctx);

  const pid = eduCleanId(planId);
  const sid = eduCleanId(sessionId);
  if (!pid || !sid) throw new EduPadronError("Falta el plan o la sesión.", 400);

  const plan = await prisma.eduTreatmentPlan.findFirst({
    where: { id: pid, institutionId },
    select: {
      id: true,
      patientId: true,
      status: true,
      startsAt: true,
      sessionIntervalDays: true,
      totalSessions: true,
    },
  });
  if (!plan) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  // El ALCANCE: el plan es del paciente, así que se comprueba el paciente.
  const paciente = await getEduClinicalPatient(ctx, plan.patientId, now);
  if (!paciente) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  if (EDU_PLAN_STATUSES_CERRADOS.includes(plan.status as EduTreatmentPlanStatus)) {
    throw new EduPadronError(
      "Ese plan ya está cerrado. Un plan cerrado no se reabre: se abre otro.",
      409,
    );
  }

  const hecha = body?.hecha !== false;
  const notes = eduOptionalText(body?.notes, EDU_PLAN_SESSION_NOTES_MAX);

  const kpis = await prisma.$transaction(async (tx) => {
    const res = await tx.eduTreatmentSession.updateMany({
      // El estado leído va en el where: si se pide marcar, la sesión tiene
      // que estar SIN marcar, y al revés.
      where: {
        id: sid,
        institutionId,
        planId: plan.id,
        completedAt: hecha ? null : { not: null },
      },
      data: {
        completedAt: hecha ? now : null,
        completedById: hecha ? ctx.eduUserId : null,
        ...(notes === undefined ? {} : { notes }),
      },
    });
    if (res.count === 0) {
      throw new EduPadronError(
        hecha
          ? "Esa sesión ya estaba marcada como hecha. Actualiza la pantalla."
          : "Esa sesión no estaba marcada. Actualiza la pantalla.",
        409,
      );
    }

    const sesiones = await tx.eduTreatmentSession.findMany({
      where: { institutionId, planId: plan.id },
      select: { sessionNumber: true, completedAt: true },
    });
    const k = eduPlanKpis(sesiones, plan.totalSessions);
    await tx.eduTreatmentPlan.updateMany({
      where: { id: plan.id, institutionId },
      data: { nextExpectedAt: eduPlanProximaFecha(k, plan.startsAt, plan.sessionIntervalDays) },
    });
    return k;
  });

  await eduAudit(ctx, {
    action: "update",
    entity: "treatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    before: { sesionHecha: !hecha },
    after: { sesionHecha: hecha, avance: kpis.avance },
    ...meta,
  });

  return { id: sid, completedAt: hecha ? now.toISOString() : null, kpis };
}

/**
 * CAMBIA EL ESTADO del plan (pausar, terminar, abandonar).
 *
 * Las transiciones válidas son un DATO (`EDU_PLAN_TRANSITIONS`), no una
 * cadena de `if` que el segundo endpoint se olvide de copiar.
 */
export async function cambiarEstadoEduPlan(
  ctx: EduPlanContext,
  planId: string,
  body: { status?: unknown; reason?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; status: EduTreatmentPlanStatus }> {
  const institutionId = requireInstitution(ctx);

  const pid = eduCleanId(planId);
  if (!pid) throw new EduPadronError("Falta el plan.", 400);

  const destino = eduPlanParseStatus(body?.status);
  if (!destino) throw new EduPadronError("Ese estado de plan no existe.", 400);

  const plan = await prisma.eduTreatmentPlan.findFirst({
    where: { id: pid, institutionId },
    select: { id: true, patientId: true, status: true },
  });
  if (!plan) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  const paciente = await getEduClinicalPatient(ctx, plan.patientId, now);
  if (!paciente) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  const desde = plan.status as EduTreatmentPlanStatus;
  if (!eduPlanPuedeTransicionar(desde, destino)) {
    throw new EduPadronError(
      `Un plan ${desde} no puede pasar a ${destino}. Un plan cerrado no se reabre: se abre otro.`,
      409,
    );
  }

  const cierra = EDU_PLAN_STATUSES_CERRADOS.includes(destino);
  const reason = eduOptionalText(body?.reason, 500) ?? null;
  if (destino === "ABANDONADO" && !reason) {
    throw new EduPadronError(
      "Abandonar un plan pide un motivo: es lo que distingue «el paciente dejó de venir» de «se terminó».",
      400,
    );
  }

  // 🔴 `Unchecked…` y no `…UpdateManyMutationInput`: Prisma deja los
  // escalares de llave foránea (`closedById`) SOLO en la variante
  // "unchecked", porque la otra espera que se escriban por la relación.
  // Un `as` sobre el tipo equivocado compilaría igual y sería mentira.
  const data: Prisma.EduTreatmentPlanUncheckedUpdateManyInput = {
    status: destino,
    closedAt: cierra ? now : null,
    closedById: cierra ? ctx.eduUserId : null,
    closeReason: cierra ? reason : null,
  };

  // El estado LEÍDO en el where: si alguien lo cambió entre la lectura y
  // esta escritura, count sale 0 y contestamos 409 en vez de pisar su
  // decisión.
  const res = await prisma.eduTreatmentPlan.updateMany({
    where: { id: plan.id, institutionId, status: desde },
    data,
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien cambió el estado de ese plan mientras lo mirabas. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "treatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    before: { status: desde },
    after: { status: destino, closeReason: reason },
    ...meta,
  });

  return { id: plan.id, status: destino };
}
