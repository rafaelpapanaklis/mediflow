"use server";
// Ortodoncia — F «Cambio de doctor» (ws1-t10). Pasa al doctor tratante ACTUAL del
// caso los controles futuros que se quedaron agendados con el anterior. Solo los
// que no chocan con la agenda del doctor nuevo; los demás se dejan como están y
// se cuentan para avisarle a quien lo pidió. `clinicId` de la sesión; el paciente
// y el doctor salen del caso, nunca del cliente.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  ESTADOS_DE_CITA_POR_VENIR,
  ESTADOS_QUE_OCUPAN_AGENDA,
  repartirControles,
} from "@/lib/orthodontics/cambio-de-doctor";
import { controlesConOtroDoctor } from "@/lib/orthodontics/controles-con-otro-doctor-db";
import { auditOrtho, getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function moverControlesFuturosAlDoctor(args: {
  treatmentPlanId: string;
}): Promise<ActionResult<{ movidos: number; conChoque: number }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: args.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, treatingDoctorId: true },
  });
  if (!plan) return fail("Plan no encontrado");
  if (!plan.treatingDoctorId) return fail("El caso no tiene doctor tratante");
  const paciente = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(paciente)) return paciente;

  const controles = await controlesConOtroDoctor({
    clinicId: ctx.clinicId,
    patientId: plan.patientId,
    treatingDoctorId: plan.treatingDoctorId,
  });
  if (controles.length === 0) return ok({ movidos: 0, conChoque: 0 });

  const desde = controles[0].startsAt;
  const ocupadas = await prisma.appointment.findMany({
    where: {
      clinicId: ctx.clinicId,
      doctorId: plan.treatingDoctorId,
      status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
      endsAt: { gt: desde },
    },
    select: { startsAt: true, endsAt: true },
    take: 500,
  });
  const { mover, conflicto } = repartirControles(controles, ocupadas);

  let movidos = 0;
  for (const c of mover) {
    // El filtro repite el estado y el doctor de origen: si en el ínterin la cita
    // cambió (la atendieron, la cancelaron), no se toca.
    const { count } = await prisma.appointment.updateMany({
      where: { id: c.id, clinicId: ctx.clinicId, doctorId: { not: plan.treatingDoctorId }, status: { in: [...ESTADOS_DE_CITA_POR_VENIR] } },
      data: { doctorId: plan.treatingDoctorId },
    });
    movidos += count;
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    meta: { accion: "mover-controles-al-doctor-tratante", doctorId: plan.treatingDoctorId, movidos, conChoque: conflicto.length },
  });
  revalidatePath(`/dashboard/patients/${plan.patientId}`);
  return ok({ movidos, conChoque: conflicto.length });
}
