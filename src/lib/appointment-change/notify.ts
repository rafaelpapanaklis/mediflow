// Notificaciones al PACIENTE sobre la resolución de un cambio de cita (WS1-T5).
// Best-effort: nunca lanza — cualquier fallo se loguea con console.error y se ignora.
//
// CONTRATO (no cambiar la firma — la importan el resolve de la clínica y el
// auto-aprobado del portal):
//   export async function notifyPatientChangeResolution(changeRequestId: string): Promise<void>
//
// Comportamiento:
//   - Carga el AppointmentChangeRequest + appointment + patient + clinic en UNA query.
//   - status APPROVED + type RESCHEDULE → "tu cita quedó reagendada: ahora es el
//     {fecha} a las {hora}" (la cita YA fue actualizada por el resolve:
//     appointment.startsAt ES la fecha nueva).
//   - status APPROVED + type CANCEL → "tu cita del {fecha} fue cancelada" (la cita
//     cancelada conserva su startsAt original).
//   - status REJECTED → "no fue posible {reagendar|cancelar} tu cita" + resolutionNote
//     si existe + "tu cita sigue en pie".
//   - PENDING o CR inexistente → return silencioso.
//   - WhatsApp: sendWhatsAppMessage de src/lib/whatsapp.ts (maneja descifrado del
//     token y normalización del teléfono) SOLO si clinic.waConnected &&
//     waPhoneNumberId && waAccessToken && patient.phone.
//   - Email: sendEmail de src/lib/email.ts SOLO si patient.email — HTML con el
//     estilo dark de src/lib/reminders/email.ts (sin CTA de confirmación).
//   - Fechas/hora en es-MX en el timezone de la clínica (formatApptDateParts,
//     mismo patrón que el encolador de recordatorios).
//   - Español neutro con tú. Nunca voseo.

import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { sendEmail } from "@/lib/email";
import { formatApptDateParts } from "@/lib/reminders/config";
import { createPatientNotification } from "@/lib/patient-notifications/create";

export async function notifyPatientChangeResolution(changeRequestId: string): Promise<void> {
  try {
    const cr = await prisma.appointmentChangeRequest.findUnique({
      where: { id: changeRequestId },
      select: {
        clinicId: true,
        patientId: true,
        accountId: true,
        type: true,
        status: true,
        resolutionNote: true,
        appointment: {
          select: {
            startsAt: true,
            type: true,
            doctor: { select: { firstName: true, lastName: true } },
          },
        },
        patient: { select: { firstName: true, phone: true, email: true } },
        clinic: {
          select: {
            name: true,
            logoUrl: true,
            phone: true,
            timezone: true,
            waConnected: true,
            waPhoneNumberId: true,
            waAccessToken: true,
          },
        },
      },
    });
    if (!cr || cr.status === "PENDING") return;

    const { appointment, patient, clinic } = cr;
    const { fecha, hora } = formatApptDateParts(appointment.startsAt, clinic.timezone);
    const doctorName = `Dr/a. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`.trim();

    let message: string;
    let subject: string;
    let showDoctor = false;
    let accent: "green" | "neutral" = "neutral";

    if (cr.status === "APPROVED" && cr.type === "RESCHEDULE") {
      // appointment.startsAt YA es la fecha nueva (el resolve actualizó la cita).
      message =
        `Hola ${patient.firstName} 👋. Tu cita en *${clinic.name}* quedó reagendada: ` +
        `ahora es el *${fecha}* a las *${hora}*. Te atiende: ${doctorName}. ` +
        `Si no puedes asistir, entra al portal o contáctanos.`;
      subject = `Tu cita fue reagendada — ${clinic.name}`;
      showDoctor = true;
      accent = "green";
    } else if (cr.status === "APPROVED" && cr.type === "CANCEL") {
      // La cita cancelada conserva su startsAt original.
      message =
        `Hola ${patient.firstName}. Tu cita en *${clinic.name}* del *${fecha}* a las *${hora}* ` +
        `fue cancelada como pediste. Cuando quieras otra cita, agéndala en línea o contáctanos.`;
      subject = `Tu cita fue cancelada — ${clinic.name}`;
    } else {
      // REJECTED — la cita sigue en pie con su fecha original.
      const action = cr.type === "CANCEL" ? "cancelar" : "reagendar";
      const motivo = cr.resolutionNote ? ` Motivo: ${cr.resolutionNote}.` : "";
      const contacto = clinic.phone ? ` al ${clinic.phone}` : "";
      message =
        `Hola ${patient.firstName}. No fue posible ${action} tu cita en *${clinic.name}* ` +
        `del *${fecha}* a las *${hora}*.${motivo} Tu cita sigue en pie. ` +
        `Si necesitas ayuda contáctanos${contacto}.`;
      subject = `Sobre tu solicitud de cambio de cita — ${clinic.name}`;
    }

    // Canal WhatsApp: solo con Meta conectado y teléfono del paciente.
    if (clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken && patient.phone) {
      try {
        await sendWhatsAppMessage(
          clinic.waPhoneNumberId,
          clinic.waAccessToken,
          patient.phone,
          message,
        );
      } catch (e) {
        console.error("[appointment-change notify]", e);
      }
    }

    // Canal email: solo si el paciente tiene correo.
    if (patient.email) {
      try {
        const html = buildResolutionEmailHtml({
          clinicName: clinic.name,
          logoUrl: clinic.logoUrl,
          message,
          fecha,
          hora,
          doctorName: showDoctor ? doctorName : null,
          accent,
        });
        await sendEmail({ to: patient.email, subject, html, text: message });
      } catch (e) {
        console.error("[appointment-change notify]", e);
      }
    }

    // Centro de notificaciones in-app del portal (además de WA/email).
    // createPatientNotification es best-effort: jamás lanza.
    await createPatientNotification({
      clinicId: cr.clinicId,
      patientId: cr.patientId,
      accountId: cr.accountId,
      type: "APPOINTMENT_CHANGE",
      title:
        cr.status === "APPROVED" && cr.type === "RESCHEDULE"
          ? "Tu cita fue reagendada"
          : cr.status === "APPROVED" && cr.type === "CANCEL"
            ? "Tu cita fue cancelada"
            : "Sobre tu solicitud de cambio",
      body: message.replace(/\*/g, ""),
    });
  } catch (e) {
    console.error("[appointment-change notify]", e);
  }
}

// ── Helpers internos (no exportados) ──────────────────────────────────────────

/** Escapa valores dinámicos para HTML (texto y atributos). */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Convierte el texto estilo WhatsApp (*negritas*) a HTML escapado con <strong>. */
function waMessageToHtml(message: string): string {
  return escapeHtml(message).replace(
    /\*([^*]+)\*/g,
    '<strong style="color: #f5f5f7;">$1</strong>',
  );
}

interface ResolutionEmailInput {
  clinicName: string;
  logoUrl?: string | null;
  /** Mismo contenido que el mensaje de WhatsApp (con *negritas*). */
  message: string;
  fecha: string;
  hora: string;
  /** Solo en reagendado aprobado; null oculta la línea del doctor. */
  doctorName?: string | null;
  accent: "green" | "neutral";
}

/**
 * HTML del email — misma estructura/estilos inline dark que el recordatorio de
 * cita (src/lib/reminders/email.ts: fondo #0b0815, card #121020, logo de la
 * clínica si hay) pero SIN botón CTA.
 */
function buildResolutionEmailHtml(input: ResolutionEmailInput): string {
  const clinicName = escapeHtml(input.clinicName);
  const logoUrl = input.logoUrl ? escapeHtml(input.logoUrl) : null;
  const fecha = escapeHtml(input.fecha);
  const hora = escapeHtml(input.hora);
  const doctorName = input.doctorName ? escapeHtml(input.doctorName) : null;
  const bodyHtml = waMessageToHtml(input.message);

  const cardStyle =
    input.accent === "green"
      ? "background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.3);"
      : "background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);";

  return `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="margin-bottom: 24px;">
      ${logoUrl ? `<img src="${logoUrl}" alt="${clinicName}" style="max-height: 48px; display: block; margin-bottom: 12px;" />` : ""}
      <div style="font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: #f5f5f7;">
        ${clinicName}
      </div>
      <div style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: #a78bfa; margin-top: 4px;">
        DaleControl
      </div>
    </div>

    <p style="font-size: 15px; color: rgba(245,245,247,0.85); line-height: 1.55; margin: 0 0 20px 0;">
      ${bodyHtml}
    </p>

    <div style="padding: 18px 20px; ${cardStyle} border-radius: 10px; margin: 0 0 28px 0;">
      <div style="font-size: 15px; color: #f5f5f7; line-height: 1.7;">
        <div>📅 <strong style="color: #f5f5f7;">${fecha}</strong></div>
        <div>🕐 <strong style="color: #f5f5f7;">${hora}</strong></div>
        ${doctorName ? `<div>👨‍⚕️ <strong style="color: #f5f5f7;">${doctorName}</strong></div>` : ""}
      </div>
    </div>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      Enviado por DaleControl — Software médico 🇲🇽
    </div>
  </div>
</body>
</html>`;
}
