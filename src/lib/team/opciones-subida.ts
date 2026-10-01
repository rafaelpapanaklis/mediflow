import "server-only";
import { prisma } from "@/lib/prisma";
import { getResolvedPlanForClinic, getResolvedPlans } from "@/lib/plans";
import { CLINIC_OVERRIDE_SELECT } from "@/lib/billing/plan-overrides";
import { PLAN_IDS } from "@/lib/billing/plans";
import type { PlanSubida } from "./cupo-usuarios-shared";

/** Nombre del plan de la clínica + planes superiores que dan más usuarios. */
export async function getOpcionesSubida(clinicId: string): Promise<{ planNombre: string; planId: string; opciones: PlanSubida[] }> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: CLINIC_OVERRIDE_SELECT });
  const actual = await getResolvedPlanForClinic(clinic);
  const todos = await getResolvedPlans();
  const idx = (id: string) => PLAN_IDS.indexOf(id as (typeof PLAN_IDS)[number]);
  const opciones = todos
    .filter((p) => idx(p.id) > idx(clinic?.plan ?? actual.id))
    .filter((p) => p.maxUsers === null || actual.maxUsers === null || p.maxUsers > actual.maxUsers)
    .map((p) => ({ id: p.id, name: p.name, maxUsers: p.maxUsers, priceMxn: p.priceMxn }));
  return { planNombre: actual.name, planId: clinic?.plan ?? actual.id, opciones };
}
