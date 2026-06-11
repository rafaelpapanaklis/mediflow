import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { sendEmail } from "@/lib/email";
import { buildAuthorName, REVIEW_STATUS, REVIEW_TOKEN_TTL_DAYS } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Invitación a reseña verificada. Al cerrarse una cita (COMPLETED) se crea una
// fila pending con token de un solo uso (30 días) y se envía el link público
// /resena/<token> por WhatsApp y/o email. Best-effort: NUNCA lanza — se llama
// dentro de un try/catch en el cierre de cita y no debe romper esa respuesta.
// ═══════════════════════════════════════════════════════════════════════════

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com").replace(/\/+$/, "");

export function reviewUrl(token: string): string {
  return `${SITE_URL}/resena/${token}`;
}

function buildInviteEmailHtml(args: { firstName: string; clinicName: string; url: string }): string {
  const { firstName, clinicName, url } = args;
  const hi = firstName ? `Hola ${firstName}` : "Hola";
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:32px 16px;background:#f5f3ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e9e7f3;border-radius:16px;padding:32px 28px;">
    <div style="font-size:20px;font-weight:700;color:#7c3aed;margin-bottom:18px;">DaleControl</div>
    <h1 style="font-size:21px;font-weight:700;color:#0f172a;margin:0 0 10px;">${hi} 👋</h1>
    <p style="font-size:15px;line-height:1.55;color:#475569;margin:0 0 8px;">
      Gracias por tu visita a <strong style="color:#0f172a;">${clinicName}</strong>.
    </p>
    <p style="font-size:15px;line-height:1.55;color:#475569;margin:0 0 24px;">
      ¿Cómo fue tu experiencia? Déjanos una reseña — toma menos de un minuto y no necesitas registrarte.
    </p>
    <a href="${url}" style="display:inline-block;padding:14px 28px;background:linear-gradient(180deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-size:15px;">
      Calificar mi visita →
    </a>
    <p style="font-size:12px;color:#94a3b8;margin:26px 0 0;line-height:1.5;">
      Si el botón no funciona, copia este enlace en tu navegador:<br />
      <a href="${url}" style="color:#7c3aed;word-break:break-all;">${url}</a>
    </p>
    <hr style="border:none;border-top:1px solid #eef1f6;margin:24px 0;" />
    <div style="font-size:11px;color:#94a3b8;">DaleControl — reseñas verificadas de pacientes reales 🇲🇽</div>
  </div>
</body></html>`;
}

/**
 * Crea (si no existe) la invitación de reseña para una cita completada y envía
 * el link por WhatsApp y/o email. Dedupe por appointmentId @unique: si ya hay
 * reseña/invitación, no hace nada. Idempotente y best-effort.
 */
export async function sendReviewInvitation(appointmentId: string): Promise<void> {
  try {
    const existing = await prisma.clinicReview.findUnique({
      where: { appointmentId },
      select: { id: true },
    });
    if (existing) return; // ya invitada (o ya reseñada)

    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true, clinicId: true, patientId: true, status: true,
        patient: { select: { firstName: true, lastName: true, phone: true, email: true } },
        clinic: { select: { name: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true } },
      },
    });
    if (!appt || !appt.patient) return;
    if (appt.status !== "COMPLETED" && appt.status !== "CHECKED_OUT") return;
    // Sin canal de contacto no tiene sentido invitar.
    if (!appt.patient.phone && !appt.patient.email) return;

    const token = crypto.randomBytes(24).toString("base64url");
    const tokenExpiresAt = new Date(Date.now() + REVIEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const authorName = buildAuthorName(appt.patient.firstName, appt.patient.lastName);
    const clinicName = appt.clinic?.name ?? "tu clínica";
    const firstName = appt.patient.firstName ?? "";
    const url = reviewUrl(token);

    // Crear primero; el unique en appointmentId blinda contra carreras.
    try {
      await prisma.clinicReview.create({
        data: {
          clinicId: appt.clinicId,
          patientId: appt.patientId,
          appointmentId: appt.id,
          authorName,
          status: REVIEW_STATUS.PENDING,
          token,
          tokenExpiresAt,
        },
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "P2002") return; // otra corrida ganó
      throw e;
    }

    const channels: string[] = [];
    const message =
      `Hola ${firstName} 👋 Gracias por tu visita a ${clinicName}. ` +
      `¿Cómo fue tu experiencia? Déjanos tu reseña (1 min, sin registro): ${url}`;

    // WhatsApp si la clínica está conectada y hay teléfono.
    if (
      appt.clinic?.waConnected &&
      appt.clinic.waPhoneNumberId &&
      appt.clinic.waAccessToken &&
      appt.patient.phone
    ) {
      try {
        await sendWhatsAppMessage(
          appt.clinic.waPhoneNumberId,
          appt.clinic.waAccessToken,
          appt.patient.phone,
          message,
        );
        channels.push("whatsapp");
      } catch (e) {
        console.error("[reviews/invite] whatsapp", e);
      }
    }

    // Email si hay correo (sendEmail nunca lanza).
    if (appt.patient.email) {
      const { delivered } = await sendEmail({
        to: appt.patient.email,
        subject: `¿Cómo fue tu visita a ${clinicName}?`,
        html: buildInviteEmailHtml({ firstName, clinicName, url }),
        text: message,
      });
      if (delivered) channels.push("email");
    }

    if (channels.length > 0) {
      await prisma.clinicReview
        .update({ where: { appointmentId: appt.id }, data: { invitedChannels: channels } })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[reviews/invite] sendReviewInvitation", err);
  }
}
