"use server";
// Orthodontics — Control y agenda (ws1-t4, Ola 1, sep-2026).
//
// Resuelve el `treatmentPlanId` de un paciente para que `RanuraCita`
// (agenda/RanuraCita.tsx) sepa si la cita de HOY corresponde a un caso de
// ortodoncia abierto — el hueco que dejó Ola 0 (ver «MAPA DE PARTES»,
// REPORTE-ws1-t1.md, punto 6): `AgendaAppointmentDTO` no trae
// `treatmentPlanId`, así que esta parte decidió resolverlo con un lookup
// propio por `patientId` en vez de tocar el DTO general de Agenda
// (compartido con TODOS los verticales dentales).
//
// Es un self-fetch desde un componente cliente ("use server" se puede
// invocar directo sin pasar por una API route) — mismo espíritu que
// AvisoAnticiposPorRevisar: se calla si no hay nada.

import { prisma } from "@/lib/prisma";
import { getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function getTreatmentPlanIdForAppointment(
  patientId: string,
): Promise<ActionResult<{ treatmentPlanId: string | null }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  if (!patientId) return fail("patientId requerido");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return ok({ treatmentPlanId: plan?.id ?? null });
}
