"use server";
// Ortodoncia — Paciente y WhatsApp (ws1-t2, W2): recordatorio de mensualidad
// al paciente ("por vencer" o "vencida"), staff-triggered desde Alertas (L1).
//
// Texto libre, SOLO dentro de la ventana de 24 h (mismo criterio que
// src/app/api/invoices/[id]/anticipo/route.ts): fuera de ella no se manda
// nada — ni plantilla, ni texto que Meta rechazaría — y el llamador ofrece
// "Copiar texto". Sin plantilla aprobada por Meta: "opcional, apagado por
// default, igual que anticipos" (decisión de Rafael para este bloque).
//
// clinicId SIEMPRE de la sesión. No usa _helpers.ts (Acceso y permisos,
// exclusivo de esa parte): getAuthContext + denyIfMissingPermission directo,
// mismo patrón que la ruta de anticipo.

import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { cargarCobranzaDelCaso } from "@/lib/orthodontics/cobranza-db";
import { textoMensualidadPorVencer, textoMensualidadVencida } from "@/lib/orthodontics/mensaje-mensualidad";
import { formatDateHuman } from "@/lib/whatsapp/bot/booking-parse";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { fail, ok, type ActionResult } from "@/app/actions/orthodontics/result";

export interface SendMensualidadReminderInput {
  patientId: string;
  treatmentPlanId: string;
}

export interface SendMensualidadReminderResult {
  texto: string;
  enviado: boolean;
  motivoNoEnviado?: string;
}

export async function sendMensualidadReminder(
  input: SendMensualidadReminderInput,
): Promise<ActionResult<SendMensualidadReminderResult>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return fail("Sin permiso para enviar WhatsApp");

  const access = await canAccessModule(ctx.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) return fail("Módulo Ortodoncia no activo para esta clínica");

  const visibilidad = await assertPatientVisible(input.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visibilidad) return fail("Paciente no encontrado");

  const [patient, clinic] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: input.patientId, clinicId: ctx.clinicId, deletedAt: null },
      select: { firstName: true, lastName: true, phone: true },
    }),
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, timezone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true },
    }),
  ]);
  if (!patient) return fail("Paciente no encontrado");
  if (!patient.phone) return fail("El paciente no tiene teléfono registrado.");
  if (!clinic) return fail("Clínica no encontrada");

  const resumen = await cargarCobranzaDelCaso({
    clinicId: ctx.clinicId,
    patientId: input.patientId,
    treatmentPlanId: input.treatmentPlanId,
    zonaHoraria: clinic.timezone,
  });
  if (!resumen) return fail("Este caso todavía no tiene factura de tratamiento con mensualidades.");

  const vencido = resumen.vencidas.reduce((s, q) => s + q.falta, 0);
  const proxima = resumen.cuotaDeHoy ?? resumen.proximas[0] ?? null;
  if (vencido <= 0 && !proxima) return fail("Este caso está al día: no hay nada que recordar.");

  const paciente = `${patient.firstName} ${patient.lastName}`.trim();
  const texto =
    vencido > 0
      ? textoMensualidadVencida({
          paciente,
          clinica: clinic.name,
          fechaHumana: resumen.vencidas[0]?.vencimiento
            ? formatDateHuman(resumen.vencidas[0].vencimiento, clinic.timezone)
            : "—",
          montoMxn: Math.round(vencido),
        })
      : textoMensualidadPorVencer({
          paciente,
          clinica: clinic.name,
          fechaHumana: proxima!.vencimiento ? formatDateHuman(proxima!.vencimiento, clinic.timezone) : "—",
          montoMxn: Math.round(proxima!.falta),
        });

  if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return ok({ texto, enviado: false, motivoNoEnviado: "WhatsApp no está conectado en esta clínica." });
  }

  const abierta = isWithin24hWindow(await lastInboundAtForPhone(ctx.clinicId, patient.phone).catch(() => null), new Date());
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
      kind: "payment_notice",
    });
    return ok({ texto, enviado: true });
  } catch (e) {
    const motivo = e instanceof WhatsAppBlockedError ? e.message : "No se pudo enviar el WhatsApp.";
    return ok({ texto, enviado: false, motivoNoEnviado: motivo });
  }
}
