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
//
// Revisión cruzada (REPORTE-ws1-t1.md, «## Revisión cruzada»):
//   · [bloquea] usaba `canAccessModule` (abre TODOS los módulos de cualquier
//     clínica dental EN PRUEBA) — cambiado a `hasActiveOrthodonticsModule`.
//   · [menor] sin candado de doble envío — ahora pregunta a `whatsapp-dedupe`
//     si ya salió un recordatorio a este teléfono en las últimas 24 h.

import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { cargarCobranzaDelCaso } from "@/lib/orthodontics/cobranza-db";
import { textoMensualidadPorVencer, textoMensualidadVencida } from "@/lib/orthodontics/mensaje-mensualidad";
import { loadOrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import {
  CLAVE_MENSUALIDAD_VENCIDA,
  plantillaUsable,
  renderAvisoMensualidadVencida,
} from "@/lib/orthodontics/plantillas-mensaje";
import { formatoPesos } from "@/lib/anticipos/core";
import { reservarAvisoDeCobro, ultimoAvisoDeCobro } from "@/lib/whatsapp/aviso-cobro-tope";
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

  const activo = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!activo) return fail("Módulo Ortodoncia no activo para esta clínica");
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);

  const visibilidad = await assertPatientVisible(input.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visibilidad) return fail("Paciente no encontrado");

  const [patient, clinic, responsable] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: input.patientId, clinicId: ctx.clinicId, deletedAt: null },
      select: { firstName: true, lastName: true, phone: true },
    }),
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, timezone: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true },
    }),
    // ws1-t10 (H·F "Menor con tutor") — si el caso tiene responsable de pago
    // (Guardian, A11), el recordatorio va a SU teléfono, no al del niño.
    // Best-effort: sin la columna todavía aplicada, o sin responsable, cae al
    // teléfono del paciente, como siempre.
    prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: input.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      select: { responsibleGuardian: { select: { phone: true } } },
    }).catch((e) => { console.error("[ortho] sendMensualidadReminder: responsibleGuardian no disponible:", e); return null; }),
  ]);
  if (!patient) return fail("Paciente no encontrado");
  const telefonoDestino = responsable?.responsibleGuardian?.phone || patient.phone;
  if (!telefonoDestino) return fail("El paciente no tiene teléfono registrado.");
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

  // ws1-t5 (ronda 6): si la clínica redactó su «Aviso de mensualidad vencida»
  // en Configuración de Ortodoncia, ESE es el texto (para enviar y para
  // copiar). Sin plantilla —o si no se pudo leer— sale el de siempre.
  const plantillaVencida =
    vencido > 0
      ? await loadOrthoClinicSettings(ctx.clinicId)
          .then((cfg) => plantillaUsable(cfg.messageTemplates, CLAVE_MENSUALIDAD_VENCIDA))
          .catch(() => null)
      : null;
  const datosVencida = {
    paciente,
    clinica: clinic.name,
    fechaHumana: resumen.vencidas[0]?.vencimiento
      ? formatDateHuman(resumen.vencidas[0].vencimiento, clinic.timezone)
      : "—",
    montoMxn: Math.round(vencido),
  };

  const texto =
    vencido > 0
      ? plantillaVencida
        ? renderAvisoMensualidadVencida(plantillaVencida, {
            paciente: datosVencida.paciente,
            clinica: datosVencida.clinica,
            fecha: datosVencida.fechaHumana,
            monto: formatoPesos(datosVencida.montoMxn),
          })
        : textoMensualidadVencida(datosVencida)
      : textoMensualidadPorVencer({
          paciente,
          clinica: clinic.name,
          fechaHumana: proxima!.vencimiento ? formatDateHuman(proxima!.vencimiento, clinic.timezone) : "—",
          montoMxn: Math.round(proxima!.falta),
        });

  const ahora = new Date();
  // Cuenta cualquier aviso de cobro de las últimas 24 h a ese teléfono, incluido el AUTOMÁTICO de mensualidad.
  const yaEnviado = await ultimoAvisoDeCobro(ctx.clinicId, telefonoDestino, ahora).catch(() => null);
  if (yaEnviado) {
    return ok({
      texto,
      enviado: false,
      motivoNoEnviado: `Ya se le mandó un recordatorio hoy (${yaEnviado.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}). Si de verdad hace falta otro, cópialo.`,
    });
  }

  if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return ok({ texto, enviado: false, motivoNoEnviado: "WhatsApp no está conectado en esta clínica." });
  }

  const abierta = isWithin24hWindow(await lastInboundAtForPhone(ctx.clinicId, telefonoDestino).catch(() => null), ahora);
  if (!abierta) {
    const quien = responsable?.responsibleGuardian?.phone ? "El responsable de pago" : "El paciente";
    return ok({
      texto,
      enviado: false,
      motivoNoEnviado: `${quien} no ha escrito en las últimas 24 h: copia el texto y compártelo por otro medio.`,
    });
  }

  // Reserva antes de enviar (dos clics o dos pestañas a la vez mandaban dos): ver aviso-cobro-tope.ts.
  const reserva = await reservarAvisoDeCobro({ clinicId: ctx.clinicId, userId: ctx.userId, telefonos: [telefonoDestino] });
  if (!reserva.ok) {
    return ok({ texto, enviado: false, motivoNoEnviado: "Ya se está enviando un aviso de cobro a este teléfono. Espera unos segundos antes de reintentar." });
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
      kind: "payment_notice",
    });
    return ok({ texto, enviado: true });
  } catch (e) {
    const motivo = e instanceof WhatsAppBlockedError ? e.message : "No se pudo enviar el WhatsApp.";
    return ok({ texto, enviado: false, motivoNoEnviado: motivo });
  } finally {
    await reserva.liberar();
  }
}
