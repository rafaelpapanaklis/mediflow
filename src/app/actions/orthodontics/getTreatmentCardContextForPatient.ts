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
// ws1-t8 (ticket BEVADENT, punto 3): si la hoja se abre DENTRO de una consulta en curso («Nueva
// consulta» → tipo Ortodoncia), esa consulta ya sabe qué cita se está atendiendo: llega como
// `citaEnCursoId` y manda sobre la búsqueda de la cita de hoy (la de P0294 era del día siguiente y
// la hoja salía sin cita, con una segunda nota). Solo vale si la cita es de este paciente y el
// paciente está presente (llegó, en sillón o en consulta); si no, se sigue la regla de siempre.
//
// ws1-t8 (revisión de ws1-t9, fallo 3): sin consulta en curso, la ficha manda además la cita de su dirección
// (`?appointment=`, la que abrió «Iniciar consulta»). Solo se usa si es de un día FUTURO y el paciente no ha
// llegado: la hoja nace con ella para que el cajón AVISE antes de firmar que esa cita no se marca como atendida,
// y la firma la deja intacta y lo repite en el aviso (cerrar-cita-al-firmar.ts). Antes ese aviso no se podía
// ver desde ninguna pantalla: la hoja se firmaba sin cita y sin decir nada. Una cita de hoy o pasada sigue la
// regla de siempre (la de control de hoy).
//
// En los dos casos, `buildTreatmentCardContext` aplica la misma regla de
// "hoja de hoy" (hallazgo 7): si el plan YA tiene una hoja de hoy —ligada a
// otra cita, o sin cita— se continúa esa en vez de crear una segunda.

import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { citaParaLigarLaHoja } from "@/lib/orthodontics/cita-para-ligar-hoja";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { buildTreatmentCardContext, type TreatmentCardAgendaContext } from "@/lib/orthodontics/treatment-card-context";
import { citaAlFirmar } from "@/lib/orthodontics/cerrar-cita-al-firmar";

export async function getTreatmentCardContextForPatient(
  treatmentPlanId: string,
  citaEnCursoId?: string | null,
  citaDeLaDireccionId?: string | null,
): Promise<ActionResult<TreatmentCardAgendaContext>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      installedAt: true,
      startDate: true,
      createdAt: true,
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

  if (citaEnCursoId) {
    const enCurso = await prisma.appointment.findFirst({
      where: {
        id: citaEnCursoId,
        clinicId: ctx.clinicId,
        patientId: plan.patientId,
        status: { in: ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] },
      },
      select: { id: true, startsAt: true, endsAt: true, status: true },
    });
    if (enCurso) return ok(await buildTreatmentCardContext(plan, enCurso, timezone));
  }

  if (citaDeLaDireccionId && citaDeLaDireccionId !== citaEnCursoId) {
    const deLaDireccion = await prisma.appointment.findFirst({
      where: {
        id: citaDeLaDireccionId,
        clinicId: ctx.clinicId,
        patientId: plan.patientId,
        status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED", "CHECKED_OUT"] },
      },
      select: { id: true, startsAt: true, endsAt: true, status: true },
    });
    if (deLaDireccion && !citaAlFirmar(deLaDireccion, new Date(), timezone).ligar) {
      return ok(await buildTreatmentCardContext(plan, deLaDireccion, timezone));
    }
  }

  // Revisión final de ws1-t9 (fallo nuevo 2): con dos citas hoy, la de la dirección manda (antes tomaba la
  // PRIMERA del día, de otra doctora) y nunca una que la sesión no pueda mover: cita-para-ligar-hoja.ts.
  const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(new Date(), timezone), timezone);
  const citasDeHoy = await prisma.appointment.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true, type: true, startsAt: true, endsAt: true, status: true, doctorId: true },
  });
  // Una dirección de otro día ya se trató arriba: aquí solo cuenta si es una cita de HOY.
  const pedidaDeHoy = citasDeHoy.some((c) => c.id === citaDeLaDireccionId) ? citaDeLaDireccionId : null;
  const citaDeHoy = citaParaLigarLaHoja(citasDeHoy, pedidaDeHoy, { id: ctx.userId, role: String(ctx.role) }, { incluirAtendidas: true });
  const appt = citaDeHoy
    ? { id: citaDeHoy.id, startsAt: citaDeHoy.startsAt, endsAt: citaDeHoy.endsAt, status: citaDeHoy.status }
    : null;

  const context = await buildTreatmentCardContext(plan, appt, timezone);
  return ok(context);
}
