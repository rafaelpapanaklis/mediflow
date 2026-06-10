import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { sendEmail } from "@/lib/email";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/prescriptions/[id]/send — envía la receta al paciente.
 *
 * Body: { via: "whatsapp" | "email" }
 *
 * Comparte el enlace de verificación pública (desde ahí el paciente ve la
 * receta y descarga el PDF). WhatsApp usa la conexión Meta per-clínica;
 * email usa el transport central (Resend).
 *
 * Multi-tenant: la receta debe pertenecer a la clínica del usuario.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as Role, "prescription.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const via = body?.via;
  if (via !== "whatsapp" && via !== "email") {
    return NextResponse.json({ error: "via_invalid", detail: "via debe ser whatsapp o email" }, { status: 400 });
  }

  const rx = await prisma.prescription.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: {
      id: true,
      issuedAt: true,
      verifyUrl: true,
      patient: { select: { firstName: true, lastName: true, phone: true, email: true } },
      clinic: { select: { name: true, waPhoneNumberId: true, waAccessToken: true } },
    },
  });
  if (!rx) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });

  // Fallback por si la receta quedó sin verifyUrl persistida.
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "mediflow.app";
  const verifyUrl = rx.verifyUrl || `${proto}://${host}/portal/prescription/${rx.id}/verify`;

  const issuedDate = rx.issuedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  if (via === "whatsapp") {
    if (!rx.clinic.waPhoneNumberId || !rx.clinic.waAccessToken) {
      return NextResponse.json(
        { error: "whatsapp_not_configured", detail: "Conecta WhatsApp en Configuración antes de enviar recetas." },
        { status: 422 },
      );
    }
    if (!rx.patient.phone) {
      return NextResponse.json(
        { error: "patient_no_phone", detail: "El paciente no tiene teléfono registrado." },
        { status: 422 },
      );
    }
    const message =
      `Hola ${rx.patient.firstName}, te enviamos tu receta médica de ${rx.clinic.name}, ` +
      `emitida el ${issuedDate}. Puedes verla, verificar su validez y descargar el PDF aquí: ${verifyUrl}`;
    try {
      await sendWhatsAppMessage(rx.clinic.waPhoneNumberId, rx.clinic.waAccessToken, rx.patient.phone, message);
    } catch (err) {
      return NextResponse.json(
        { error: "send_failed", detail: err instanceof Error ? err.message : "Error al enviar por WhatsApp" },
        { status: 502 },
      );
    }
  } else {
    if (!rx.patient.email) {
      return NextResponse.json(
        { error: "patient_no_email", detail: "El paciente no tiene correo registrado." },
        { status: 422 },
      );
    }
    const html = `<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #f4f2f8; margin: 0; padding: 32px 16px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e7e3f2; border-radius: 14px; padding: 32px 28px;">
    <div style="font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #7c3aed; margin-bottom: 14px;">${rx.clinic.name}</div>
    <h1 style="font-size: 20px; margin: 0 0 10px 0; color: #14101f;">Tu receta médica</h1>
    <p style="font-size: 14px; color: #4b4760; line-height: 1.6; margin: 0 0 22px 0;">
      Hola ${rx.patient.firstName}, tu receta fue emitida el ${issuedDate}.
      Puedes consultarla, verificar su validez y descargar el PDF en el siguiente enlace:
    </p>
    <a href="${verifyUrl}" style="display: inline-block; padding: 12px 22px; background: #7c3aed; color: #ffffff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 14px;">Ver y verificar receta</a>
    <p style="font-size: 11px; color: #9b96ad; margin-top: 26px; line-height: 1.5;">
      Si no esperabas este correo, puedes ignorarlo.<br />Enlace directo: ${verifyUrl}
    </p>
    <hr style="border: none; border-top: 1px solid #eeeaf6; margin: 22px 0;" />
    <div style="font-size: 11px; color: #9b96ad;">Enviado con DaleControl</div>
  </div>
</body>
</html>`;
    const text =
      `Hola ${rx.patient.firstName}, tu receta médica de ${rx.clinic.name} fue emitida el ${issuedDate}.\n\n` +
      `Consúltala, verifica su validez y descarga el PDF aquí: ${verifyUrl}\n\n` +
      `Enviado con DaleControl`;
    const { delivered } = await sendEmail({
      to: rx.patient.email,
      subject: `Tu receta médica — ${rx.clinic.name}`,
      html,
      text,
    });
    if (!delivered) {
      return NextResponse.json(
        { error: "send_failed", detail: "El transporte de correo no está configurado o rechazó el envío." },
        { status: 502 },
      );
    }
  }

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "prescription",
    entityId: rx.id,
    action: "update",
    before: { sentVia: null },
    after: { sentVia: via },
  });

  return NextResponse.json({ success: true, via });
}
