"use server";
// Ortodoncia — Paciente y WhatsApp (ws1-t2, W5): enviar por WhatsApp las
// indicaciones del control de HOY (C3, "Control y agenda" — solo se LEEN,
// nunca se editan desde aquí). Staff-triggered desde el Tablero.
//
// Texto libre, SOLO dentro de la ventana de 24 h (una cita de control de hoy
// normalmente cae dentro: el paciente suele escribir para confirmar o llegó
// hace poco). Fuera de ella, "Copiar texto" — mismo criterio que el
// recordatorio de mensualidad (sendMensualidadReminder.ts).
//
// Revisión cruzada (REPORTE-ws1-t1.md, «## Revisión cruzada»):
//   · [bloquea] usaba `canAccessModule` — cambiado a `hasActiveOrthodonticsModule`.
//   · [menor] sin candado de doble envío — ahora pregunta a `whatsapp-dedupe`.

import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { lastSentOfKind } from "@/lib/orthodontics/whatsapp-dedupe";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { fail, ok, type ActionResult } from "@/app/actions/orthodontics/result";

export interface SendControlInstructionsInput {
  appointmentId: string;
}

export interface SendControlInstructionsResult {
  texto: string;
  enviado: boolean;
  motivoNoEnviado?: string;
}

export async function sendControlInstructions(
  input: SendControlInstructionsInput,
): Promise<ActionResult<SendControlInstructionsResult>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return fail("Sin permiso para enviar WhatsApp");

  const activo = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!activo) return fail("Módulo Ortodoncia no activo para esta clínica");

  const appointment = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, clinicId: ctx.clinicId },
    select: { patientId: true },
  });
  if (!appointment) return fail("Cita no encontrada");

  const visibilidad = await assertPatientVisible(appointment.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visibilidad) return fail("Paciente no encontrado");

  const [card, patient, clinic] = await Promise.all([
    prisma.orthoTreatmentCard.findFirst({
      where: { clinicId: ctx.clinicId, appointmentId: input.appointmentId },
      select: { indications: true },
    }),
    prisma.patient.findFirst({
      where: { id: appointment.patientId, clinicId: ctx.clinicId, deletedAt: null },
      select: { firstName: true, lastName: true, phone: true },
    }),
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true },
    }),
  ]);
  if (!card?.indications) return fail("Este control todavía no tiene indicaciones cargadas.");
  if (!patient) return fail("Paciente no encontrado");
  if (!patient.phone) return fail("El paciente no tiene teléfono registrado.");
  if (!clinic) return fail("Clínica no encontrada");

  const paciente = `${patient.firstName} ${patient.lastName}`.trim();
  const texto = `Hola ${paciente}, indicaciones de tu control de hoy en ${clinic.name}:\n${card.indications}`;

  const ahora = new Date();
  const yaEnviado = await lastSentOfKind(ctx.clinicId, patient.phone, "manual_api", ahora).catch(() => null);
  if (yaEnviado) {
    return ok({
      texto,
      enviado: false,
      motivoNoEnviado: `Ya se le mandaron indicaciones hoy (${yaEnviado.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}). Si de verdad hace falta otro envío, cópialo.`,
    });
  }

  if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return ok({ texto, enviado: false, motivoNoEnviado: "WhatsApp no está conectado en esta clínica." });
  }

  const abierta = isWithin24hWindow(await lastInboundAtForPhone(ctx.clinicId, patient.phone).catch(() => null), ahora);
  if (!abierta) {
    return ok({
      texto,
      enviado: false,
      motivoNoEnviado: "El paciente no ha escrito en las últimas 24 h: copia el texto y compártelo por otro medio.",
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
      to: patient.phone,
      body: texto,
      kind: "manual_api",
    });
    return ok({ texto, enviado: true });
  } catch (e) {
    const motivo = e instanceof WhatsAppBlockedError ? e.message : "No se pudo enviar el WhatsApp.";
    return ok({ texto, enviado: false, motivoNoEnviado: motivo });
  }
}
