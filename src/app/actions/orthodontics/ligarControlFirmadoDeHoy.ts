"use server";
// ws1-t8 (revisión de ws1-t9, fallo 2): desde la FICHA, la hoja de hoy ya firmada «sin cita» se liga a la cita
// de hoy (ligar-hoja-firmada-db.ts). La usan «Ver el control de hoy (firmado)» de la pestaña Ortodoncia y
// «Terminar consulta». La cita es la de la consulta en curso si la hay (de este paciente, de hoy); si no, la
// primera cita de control de hoy del paciente — el mismo criterio que getTreatmentCardContextForPatient.
import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { ligarHojaFirmadaDeHoyALaCita, type HojaFirmadaLigada } from "@/lib/orthodontics/ligar-hoja-firmada-db";

export async function ligarControlFirmadoDeHoy(
  treatmentPlanId: string,
  citaEnCursoId?: string | null,
): Promise<ActionResult<HojaFirmadaLigada>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");
  const patient = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(patient)) return patient;

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const zona = clinic?.timezone ?? "America/Mexico_City";
  const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(new Date(), zona), zona);

  let cita: { id: string; status: string; startsAt: Date } | null = null;
  if (citaEnCursoId) {
    cita = await prisma.appointment.findFirst({
      where: { id: citaEnCursoId, clinicId: ctx.clinicId, patientId: plan.patientId, startsAt: { gte: startUtc, lt: endUtc } },
      select: { id: true, status: true, startsAt: true },
    });
  } else {
    const deHoy = await prisma.appointment.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: plan.patientId,
        status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED", "CHECKED_OUT"] },
        startsAt: { gte: startUtc, lt: endUtc },
      },
      orderBy: { startsAt: "asc" },
      select: { id: true, type: true, status: true, startsAt: true },
    });
    cita = deHoy && esCitaControlOrto(deHoy.type) ? { id: deHoy.id, status: deHoy.status, startsAt: deHoy.startsAt } : null;
  }
  if (!cita) return ok({ cardId: null, citaCerrada: null });

  return ok(
    await ligarHojaFirmadaDeHoyALaCita({
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      planId: plan.id,
      cita,
      rol: String(ctx.role),
      zona,
    }),
  );
}
