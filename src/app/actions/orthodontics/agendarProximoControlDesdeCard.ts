"use server";
// Ortodoncia — ws1-t1 ronda 2, punto 4 pendiente de la ronda 1: "tras firmar
// un control con 'próximo control en N semanas', ofrecer a recepción
// agendarlo con un clic" (C5 del alcance, comentario original en
// DrawerTreatmentCard.tsx). El doctor ya eligió fecha+hora+duración al
// firmar (OrthoTreatmentCard.nextDate/nextDurationMin, datetime-local); esto
// solo convierte ese dato en una Appointment de verdad.
//
// Reusa createBotAppointment (bot-booking-service.ts) tal cual — mismos
// candados que cualquier alta (horario de la clínica, horario propio del
// doctor, bloqueos de agenda, choque con otra cita): no se reinventa nada de
// eso aquí. Un clic repetido sobre el mismo próximo control choca con la
// cita que ya se creó (mismo doctor, mismo horario → "overlap") en vez de
// duplicarla — no hace falta una columna nueva para marcar "ya agendado".
//
// Nota conocida: createBotAppointment escribe siempre `source: "WHATSAPP"`
// (pensado para el bot) — una cita creada por recepción desde aquí queda con
// esa etiqueta. Cosmético/de reporte, no afecta el candado ni el cobro;
// documentado en el reporte de cierre.

import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { createBotAppointment, type CreateErrorCode } from "@/lib/agenda/bot-booking-service";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { fechaHoraParaTexto } from "@/lib/movimientos-paciente/textos";
import { fail, ok, type ActionResult } from "./result";

export interface AgendarProximoControlInput {
  cardId: string;
}

export interface AgendarProximoControlResult {
  appointmentId: string;
}

const MENSAJE_POR_ERROR: Record<CreateErrorCode, string> = {
  outside_hours: "Ese horario cae fuera del horario de la clínica — agenda el control a mano desde la Agenda.",
  blocked: "Ese hueco está bloqueado en la Agenda — agenda el control a mano.",
  doctor_off: "El doctor tratante no atiende a esa hora — agenda el control a mano o cambia la fecha.",
  overlap: "Ya hay una cita en ese horario para el doctor tratante (puede ser la que ya creaste desde aquí).",
  doctor_not_found: "El doctor tratante de este caso ya no está activo en la clínica.",
  patient_not_found: "El paciente de este caso no se encontró.",
  invalid: "La fecha/hora del próximo control no es válida.",
  pago_no_disponible: "No se pudo generar el link de pago.",
  failed: "No se pudo crear la cita. Intenta de nuevo o agenda a mano.",
};

export async function agendarProximoControlDesdeCard(
  input: AgendarProximoControlInput,
): Promise<ActionResult<AgendarProximoControlResult>> {
  // agenda.create, no medicalRecord.edit ni settings.edit: crear una cita es
  // trabajo de recepción, igual que cualquier otra alta desde la Agenda.
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const denied = denyIfMissingPermission(ctx, "agenda.create");
  if (denied) return fail("Sin permiso para crear citas");

  const activo = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!activo) return fail("Módulo Ortodoncia no activo para esta clínica");
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);

  const card = await prisma.orthoTreatmentCard.findFirst({
    where: { id: input.cardId, clinicId: ctx.clinicId },
    select: { patientId: true, treatmentPlanId: true, nextDate: true, nextDurationMin: true },
  });
  if (!card) return fail("Hoja de control no encontrada");
  if (!card.nextDate) return fail("Esta hoja de control no tiene próximo control capturado.");

  const visibilidad = await assertPatientVisible(card.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visibilidad) return fail("Paciente no encontrado");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: card.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { treatingDoctorId: true },
  });
  if (!plan?.treatingDoctorId) {
    return fail("Este caso no tiene doctor tratante asignado — agenda el control a mano desde la Agenda.");
  }

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  if (!clinic) return fail("Clínica no encontrada");

  // El datetime-local del doctor viaja como ISO absoluto (toISOString) —
  // aquí se parte en fecha+hora LOCALES de la clínica, que es lo que pide
  // createBotAppointment (arma el UTC otra vez con tzLocalToUtc).
  const dateISO = card.nextDate.toLocaleDateString("en-CA", { timeZone: clinic.timezone }); // YYYY-MM-DD
  const time = card.nextDate.toLocaleTimeString("en-GB", { timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit" }); // HH:MM

  const res = await createBotAppointment({
    clinicId: ctx.clinicId,
    patientId: card.patientId,
    doctorId: plan.treatingDoctorId,
    dateISO,
    time,
    durationMin: card.nextDurationMin ?? 30,
    reason: TIPO_CITA_CONTROL_ORTO,
  });

  if (!res.ok) return fail(MENSAJE_POR_ERROR[res.error]);
  await registrarMovimientoDelPaciente({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    patientId: card.patientId,
    entityType: "appointment",
    entityId: res.appointmentId,
    action: "create",
    texto: `Agendó el próximo control de ortodoncia para el ${fechaHoraParaTexto(card.nextDate, clinic.timezone)}`,
  });
  return ok({ appointmentId: res.appointmentId });
}
