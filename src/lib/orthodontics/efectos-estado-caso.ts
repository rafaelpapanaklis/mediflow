// H46 (revisión de lógica de uso): el estado del caso y la fase iban por
// separado. Poner «En retención» a mano no creaba el régimen ni sus revisiones
// y poner la fecha de colocación no arrancaba ninguna fase. Estos efectos se
// aplican al cambiar el estado desde updateTreatmentPlan, sin duplicar nada
// (idempotentes) y sin pisar lo que `advanceTreatmentPhase` ya hizo.
import type { OrthoTreatmentStatus } from "@prisma/client";

export const MESES_REVISION_RETENCION = [3, 6, 12, 24, 36] as const;

export function sumarMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + meses);
  return d;
}

/** Qué hay que hacer con las fases al cambiar de estado (pura, para probarla). */
export function accionDeFases(
  nuevo: OrthoTreatmentStatus,
  fases: { id: string; phaseKey: string; status: string; orderIndex: number }[],
): { completar: string[]; iniciar: string | null } {
  const enCurso = fases.filter((f) => f.status === "IN_PROGRESS");
  if (nuevo === "IN_PROGRESS") {
    if (enCurso.length > 0) return { completar: [], iniciar: null };
    const primera = [...fases]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .find((f) => f.status !== "COMPLETED" && f.phaseKey !== "RETENTION");
    return { completar: [], iniciar: primera?.id ?? null };
  }
  if (nuevo === "RETENTION") {
    const ret = fases.find((f) => f.phaseKey === "RETENTION");
    if (!ret || ret.status === "IN_PROGRESS") return { completar: [], iniciar: null };
    return {
      completar: enCurso.filter((f) => f.id !== ret.id).map((f) => f.id),
      iniciar: ret.id,
    };
  }
  return { completar: [], iniciar: null };
}

interface Cliente {
  orthodonticPhase: { findMany: Function; update: Function };
  orthoRetentionRegimen: { findUnique: Function; create: Function };
  orthoRetainerCheckup: { create: Function };
}

export async function aplicarEfectosDeEstado(
  db: Cliente,
  plan: { id: string; clinicId: string },
  nuevo: OrthoTreatmentStatus,
  ahora: Date = new Date(),
): Promise<void> {
  const fases = (await db.orthodonticPhase.findMany({
    where: { treatmentPlanId: plan.id },
    select: { id: true, phaseKey: true, status: true, orderIndex: true },
  })) as { id: string; phaseKey: string; status: string; orderIndex: number }[];
  const { completar, iniciar } = accionDeFases(nuevo, fases);
  for (const id of completar) {
    await db.orthodonticPhase.update({ where: { id }, data: { status: "COMPLETED", completedAt: ahora } });
  }
  if (iniciar) {
    await db.orthodonticPhase.update({ where: { id: iniciar }, data: { status: "IN_PROGRESS", startedAt: ahora } });
  }
  if (nuevo === "RETENTION") {
    const existe = await db.orthoRetentionRegimen.findUnique({
      where: { treatmentPlanId: plan.id },
      select: { id: true },
    });
    if (existe) return;
    const regimen = (await db.orthoRetentionRegimen.create({
      data: {
        treatmentPlanId: plan.id,
        clinicId: plan.clinicId,
        debondedAt: ahora,
        upperRetainer: "HAWLEY_SUP",
        lowerRetainer: "ESSIX_INF",
        fixedLingualPresent: true,
        fixedLingualGauge: "G_0195",
        regimenDescription: "24/7 año 1 · nocturno años 2-5",
        preSurveyEnabled: true,
      },
      select: { id: true },
    })) as { id: string };
    for (const m of MESES_REVISION_RETENCION) {
      await db.orthoRetainerCheckup.create({
        data: {
          regimenId: regimen.id,
          clinicId: plan.clinicId,
          monthsFromDebond: m,
          scheduledDate: sumarMeses(ahora, m),
          status: "PROGRAMMED",
        },
      });
    }
  }
}
