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
import { isOverlapError } from "@/lib/agenda/api-helpers";
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

  // Solo la ventana que abarcan estos controles (con `take` sin límite superior, un
  // doctor con muchas citas futuras devolvía 500 al azar y se escapaba algún choque).
  const desde = controles[0].startsAt;
  const hasta = controles.reduce((max, c) => (c.endsAt.getTime() > max.getTime() ? c.endsAt : max), controles[0].endsAt);
  const [citasOcupadas, bloqueos] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        doctorId: plan.treatingDoctorId,
        status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
        startsAt: { lt: hasta },
        endsAt: { gt: desde },
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: "asc" },
      take: 2000,
    }),
    // Vacaciones, festivos y demás bloqueos: del doctor o de toda la clínica (doctorId nulo).
    prisma.agendaBlock.findMany({
      where: {
        clinicId: ctx.clinicId,
        deletedAt: null,
        OR: [{ doctorId: plan.treatingDoctorId }, { doctorId: null }],
        startsAt: { lt: hasta },
        endsAt: { gt: desde },
      },
      select: { startsAt: true, endsAt: true },
      take: 500,
    }).catch(() => []),
  ]);
  const { mover, conflicto } = repartirControles(controles, [...citasOcupadas, ...bloqueos]);
  const conflictoTardio: string[] = [];

  let movidos = 0;
  for (const c of mover) {
    // El filtro repite el estado y el doctor de origen: si en el ínterin la cita
    // cambió (la atendieron, la cancelaron), no se toca.
    try {
      const { count } = await prisma.appointment.updateMany({
        where: { id: c.id, clinicId: ctx.clinicId, doctorId: { not: plan.treatingDoctorId }, status: { in: [...ESTADOS_DE_CITA_POR_VENIR] } },
        data: { doctorId: plan.treatingDoctorId },
      });
      movidos += count;
    } catch (e) {
      // La base también impide el traslape (EXCLUDE): si una cita llegó entre la lectura
      // y la escritura, es un choque más, no un error que deje la tanda a medias.
      if (!isOverlapError(e)) throw e;
      conflictoTardio.push(c.id);
    }
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    meta: { accion: "mover-controles-al-doctor-tratante", doctorId: plan.treatingDoctorId, movidos, conChoque: conflicto.length + conflictoTardio.length },
  });
  revalidatePath(`/dashboard/patients/${plan.patientId}`);
  return ok({ movidos, conChoque: conflicto.length + conflictoTardio.length });
}
