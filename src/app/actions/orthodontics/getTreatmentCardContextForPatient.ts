"use server";
// Orthodontics — Ronda 6 (ws1-t8, «El día de la ortodoncista», M6). Entrada
// de "Registrar control" desde la FICHA del paciente (OrthodonticsRedesignClient),
// hermana de `getTreatmentCardContextForAppointment.ts` (Agenda/Tablero/
// Controles/Hoy) — mismo contexto, mismo `buildTreatmentCardContext`, pero
// la cita se RESUELVE aquí en vez de venir dada:
//
//   1. Si el paciente tiene una cita de control de HOY (TIPO_CITA_CONTROL_ORTO,
//      no cancelada/no-show) para este plan, se usa esa — la hoja queda
//      ligada a ella exactamente igual que si se hubiera abierto desde el
//      botón de la Agenda (hallazgo 6: "Registrar control desde la ficha no
//      queda ligado a la cita del día").
//   2. Si no hay ninguna, se abre sin cita (`appointmentId: null`) — la
//      ficha sigue permitiendo registrar un control sin agenda de por medio
//      (visita espontánea, caso real de clínica chica), pero ya no FINGE una
//      cita que no existe.
//
// En los dos casos, `buildTreatmentCardContext` aplica la misma regla de
// "hoja de hoy" (hallazgo 7): si el plan YA tiene una hoja de hoy —ligada a
// otra cita, o sin cita— se continúa esa en vez de crear una segunda.

import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { buildTreatmentCardContext, type TreatmentCardAgendaContext } from "./getTreatmentCardContextForAppointment";

export async function getTreatmentCardContextForPatient(
  treatmentPlanId: string,
): Promise<ActionResult<TreatmentCardAgendaContext>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      installedAt: true,
      startDate: true,
      // Fila 12: datos de la nota precargada (buildTreatmentCardContext).
      technique: true,
      patient: { select: { firstName: true, lastName: true } },
      paymentPlan: { select: { status: true } },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  const patient = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(patient)) return patient;

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const timezone = clinic?.timezone ?? "America/Mexico_City";

  const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(new Date(), timezone), timezone);
  const citaDeHoy = await prisma.appointment.findFirst({
    where: {
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true, type: true, startsAt: true, endsAt: true },
  });
  const appt =
    citaDeHoy && esCitaControlOrto(citaDeHoy.type)
      ? { id: citaDeHoy.id, startsAt: citaDeHoy.startsAt, endsAt: citaDeHoy.endsAt }
      : null;

  const context = await buildTreatmentCardContext(plan, appt, timezone);
  return ok(context);
}
