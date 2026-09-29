"use server";
// Ortodoncia — ws1-t1 ronda 2, punto 4 pendiente de la ronda 1: tras firmar
// un control con "próximo control en N semanas", avisar al paciente SI hay
// ventana de 24 h. Mismo patrón exacto que sendControlInstructions.ts /
// sendMensualidadReminder.ts: texto libre, staff-triggered, dedupe por día,
// sin plantilla de Meta (opcional, no cuesta si no hay ventana — se ofrece
// "Copiar texto").

import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { destinoDelAviso, textoAvisoProximoControl } from "@/lib/orthodontics/aviso-proximo-control";
import { formatDateHuman } from "@/lib/whatsapp/bot/booking-parse";
import { lastSentOfKind } from "@/lib/orthodontics/whatsapp-dedupe";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { fail, ok, type ActionResult } from "@/app/actions/orthodontics/result";

export interface AvisarProximoControlInput {
  cardId: string;
}

export interface AvisarProximoControlResult {
  texto: string;
  enviado: boolean;
  motivoNoEnviado?: string;
}

export async function avisarProximoControlAlPaciente(
  input: AvisarProximoControlInput,
): Promise<ActionResult<AvisarProximoControlResult>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return fail("Sin permiso para enviar WhatsApp");

  const activo = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!activo) return fail("Módulo Ortodoncia no activo para esta clínica");
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);

  const card = await prisma.orthoTreatmentCard.findFirst({
    where: { id: input.cardId, clinicId: ctx.clinicId },
    select: { patientId: true, nextDate: true, treatmentPlanId: true },
  });
  if (!card) return fail("Hoja de control no encontrada");
  if (!card.nextDate) return fail("Esta hoja de control no tiene próximo control capturado.");

  const visibilidad = await assertPatientVisible(card.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visibilidad) return fail("Paciente no encontrado");

  const [patient, clinic, plan] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: card.patientId, clinicId: ctx.clinicId, deletedAt: null },
      select: { firstName: true, lastName: true, phone: true },
    }),
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, timezone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true },
    }),
    // ws1-t8: como la mensualidad y la cobranza, si el caso tiene responsable de pago
    // (tutor) el aviso va a SU teléfono. Best-effort: sin la columna o sin responsable,
    // cae al paciente, como siempre.
    prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: card.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      select: { responsibleGuardianId: true, responsibleGuardian: { select: { phone: true } } },
    }).catch((e) => { console.error("[ortho] avisarProximoControl: responsibleGuardian no disponible:", e); return null; }),
  ]);
  if (!patient) return fail("Paciente no encontrado");
  const destino = destinoDelAviso({
    responsablePhone: plan?.responsibleGuardian?.phone,
    hayResponsable: Boolean(plan?.responsibleGuardianId),
    pacientePhone: patient.phone,
  });
  if (destino.ok === false) return fail(destino.motivo);
  const { telefono: telefonoDestino, esResponsable } = destino.destino;
  if (!clinic) return fail("Clínica no encontrada");

  const paciente = `${patient.firstName} ${patient.lastName}`.trim();
  const fechaTexto = formatDateHuman(card.nextDate.toISOString().slice(0, 10), clinic.timezone);
  const horaTexto = card.nextDate.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: clinic.timezone });
  const texto = textoAvisoProximoControl({ paciente, clinica: clinic.name, fechaTexto, horaTexto, paraResponsable: esResponsable });

  const ahora = new Date();
  const yaEnviado = await lastSentOfKind(ctx.clinicId, telefonoDestino, "manual_api", ahora).catch(() => null);
  if (yaEnviado) {
    return ok({
      texto,
      enviado: false,
      motivoNoEnviado: `Ya se le avisó hoy (${yaEnviado.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}). Si de verdad hace falta otro envío, cópialo.`,
    });
  }

  if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return ok({ texto, enviado: false, motivoNoEnviado: "WhatsApp no está conectado en esta clínica." });
  }

  const abierta = isWithin24hWindow(await lastInboundAtForPhone(ctx.clinicId, telefonoDestino).catch(() => null), ahora);
  if (!abierta) {
    return ok({
      texto,
      enviado: false,
      motivoNoEnviado: `${esResponsable ? "El responsable de pago" : "El paciente"} no ha escrito en las últimas 24 h: copia el texto y compártelo por otro medio.`,
    });
  }

  try {
    await sendWhatsAppLogged({
      clinic: {
        id: ctx.clinicId,
        waPhoneNumberId: clinic.waPhoneNumberId,
        waAccessToken: clinic.waAccessToken,
        waConnected: clinic.waConnected,
        waTemplates: clinic.waTemplates,
      },
      to: telefonoDestino,
      body: texto,
      kind: "manual_api",
    });
    await registrarMovimientoDelPaciente({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: card.patientId,
      entityType: "orthodontic-control",
      entityId: card.patientId,
      action: "send",
      texto: "Avisó al paciente por WhatsApp de su próximo control de ortodoncia",
    });
    return ok({ texto, enviado: true });
  } catch (e) {
    const motivo = e instanceof WhatsAppBlockedError ? e.message : "No se pudo enviar el WhatsApp.";
    return ok({ texto, enviado: false, motivoNoEnviado: motivo });
  }
}
