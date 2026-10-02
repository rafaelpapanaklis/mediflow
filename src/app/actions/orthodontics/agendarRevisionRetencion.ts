"use server";
// Ortodoncia — H65 (revisión de lógica de uso): las revisiones de retención a
// 3/6/12/24/36 meses solo se mostraban. Esto convierte una en cita de verdad
// («Control de retención») con los mismos candados que cualquier alta.

import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { createBotAppointment, type CreateErrorCode } from "@/lib/agenda/bot-booking-service";
import { fraseTratanteNoRecibeCitas } from "@/lib/agenda/roles-que-atienden-db";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { fechaHoraParaTexto } from "@/lib/movimientos-paciente/textos";
import { fail, ok, type ActionResult } from "./result";

const TIPO_CITA_RETENCION = "Control de retención";

const MENSAJE_POR_ERROR: Record<CreateErrorCode, string> = {
  outside_hours: "Ese horario cae fuera del horario de la clínica.",
  blocked: "Ese hueco está bloqueado en la Agenda.",
  doctor_off: "El doctor tratante no atiende a esa hora.",
  overlap: "Ya hay una cita en ese horario para el doctor tratante.",
  // ws1-t10: la regla es «puede recibir citas» (roles-que-atienden.ts): activo Y con «Aparece en la agenda».
  doctor_not_found: "El doctor tratante de este caso no puede recibir citas: ya no está activo o tiene apagada «Aparece en la agenda» en Equipo.",
  patient_not_found: "El paciente de este caso no se encontró.",
  invalid: "La fecha/hora no es válida.",
  pago_no_disponible: "No se pudo generar el link de pago.",
  failed: "No se pudo crear la cita. Intenta de nuevo o agenda a mano.",
};

export async function agendarRevisionRetencion(input: {
  checkupId: string;
  startsAt: string;
}): Promise<ActionResult<{ appointmentId: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  if (denyIfMissingPermission(ctx, "agenda.create")) return fail("Sin permiso para crear citas");
  if (!(await hasActiveOrthodonticsModule(ctx.clinicId))) return fail("Módulo Ortodoncia no activo para esta clínica");
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);

  const inicio = new Date(input.startsAt);
  if (Number.isNaN(inicio.getTime())) return fail("La fecha/hora no es válida.");
  if (inicio.getTime() < Date.now() - 60_000) return fail("Elige una fecha futura.");

  const checkup = await prisma.orthoRetainerCheckup.findFirst({
    where: { id: input.checkupId, clinicId: ctx.clinicId },
    select: { regimen: { select: { treatmentPlan: { select: { patientId: true, treatingDoctorId: true, clinicId: true, deletedAt: true } } } } },
  });
  const plan = checkup?.regimen?.treatmentPlan;
  if (!plan || plan.deletedAt || plan.clinicId !== ctx.clinicId) return fail("Revisión no encontrada");
  if (!plan.treatingDoctorId) return fail("Este caso no tiene doctor tratante asignado — agenda desde la Agenda.");

  const visibilidad = await assertPatientVisible(plan.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visibilidad) return fail("Paciente no encontrado");

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  if (!clinic) return fail("Clínica no encontrada");
  const dateISO = inicio.toLocaleDateString("en-CA", { timeZone: clinic.timezone });
  const time = inicio.toLocaleTimeString("en-GB", { timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit" });

  const res = await createBotAppointment({
    clinicId: ctx.clinicId,
    patientId: plan.patientId,
    doctorId: plan.treatingDoctorId,
    dateISO,
    time,
    durationMin: 30,
    reason: TIPO_CITA_RETENCION,
  });
  // El tratante que no recibe citas, con su motivo (inactivo, casilla apagada, rol que no atiende).
  if (!res.ok && res.error === "doctor_not_found") return fail(await fraseTratanteNoRecibeCitas(ctx.clinicId, plan.treatingDoctorId));
  if (!res.ok) return fail(MENSAJE_POR_ERROR[res.error]);
  await registrarMovimientoDelPaciente({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    patientId: plan.patientId,
    entityType: "appointment",
    entityId: res.appointmentId,
    action: "create",
    texto: `Agendó una revisión de retención de ortodoncia para el ${fechaHoraParaTexto(inicio, clinic.timezone)}`,
  });
  return ok({ appointmentId: res.appointmentId });
}
