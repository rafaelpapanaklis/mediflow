// POST /api/consent/[id]/send-whatsapp — le manda al paciente su carta de
// consentimiento informado.
//
// Clon del patrón de /api/quotes/[id]/send-whatsapp:
//   · con la ventana de 24 h abierta sale texto libre con la liga + el PDF
//     adjunto como segundo mensaje;
//   · cerrada, sendWhatsAppLogged resuelve la plantilla `consent`
//     (dc_consentimiento_listo) —que lleva la liga DENTRO, porque fuera de la
//     ventana no hay segundo mensaje que valga— o bloquea con motivo legible.
//
// Dos redacciones según el estado: si todavía no está firmado, se invita a
// firmarlo; si ya lo está, se le manda su copia. Prometerle "fírmalo aquí" a
// quien ya firmó es la clase de detalle que hace que el paciente deje de leer
// los mensajes de la clínica.
//
// Multi-tenant: clinicId de la sesión; consentimiento y credenciales de
// WhatsApp verificados contra ESA clínica.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildConsentPdf } from "@/lib/consent/consent-pdf";
import { consentPublicUrl, ensureConsentLinkFresh } from "@/lib/consent/link";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";

export const runtime = "nodejs"; // genera el PDF con el stack de consent-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Dos permisos: el del canal (mandar WhatsApp) y el del módulo (mover
  // consentimientos). Quien solo puede ver no manda nada al paciente.
  const deniedWa = denyIfMissingPermission(ctx, "whatsapp.send");
  if (deniedWa) return deniedWa;
  const deniedConsent = denyIfMissingPermission(ctx, "consents.create");
  if (deniedConsent) return deniedConsent;

  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true, patientId: true, procedure: true, token: true,
      expiresAt: true, signedAt: true, revokedAt: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
      clinic: {
        select: {
          id: true, name: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true,
        },
      },
    },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const deniedPatient = await assertPatientVisible(form.patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (deniedPatient) return deniedPatient;

  if (form.revokedAt) {
    return NextResponse.json(
      { error: "Este consentimiento está revocado: no hay nada que enviarle al paciente." },
      { status: 409 },
    );
  }

  const patientPhone = form.patient?.phone?.trim();
  if (!patientPhone) {
    return NextResponse.json(
      { error: "El paciente no tiene teléfono registrado. Agrégalo en su expediente para poder enviarle el consentimiento." },
      { status: 409 },
    );
  }

  const clinic = form.clinic;
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json(
      { error: "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp." },
      { status: 409 },
    );
  }

  // Mandar una liga vencida es lo mismo que no mandar nada: se estira la
  // vigencia conservando el token (el paciente puede tener el enlace abierto).
  await ensureConsentLinkFresh(form.id, ctx.clinicId, form.expiresAt);
  const link = consentPublicUrl(form.token, req.nextUrl.origin);

  const patientName =
    `${form.patient?.firstName ?? ""} ${form.patient?.lastName ?? ""}`.trim() || "Paciente";

  const body = form.signedAt
    ? `Hola ${patientName}, te compartimos tu documento firmado: la carta de consentimiento ` +
      `informado de «${form.procedure}» en ${clinic.name}. Te adjuntamos el PDF y aquí puedes ` +
      `consultarla cuando quieras: ${link}. Cualquier duda respóndenos por este medio. ¡Gracias!`
    : `Hola ${patientName}, en ${clinic.name} preparamos tu carta de consentimiento informado ` +
      `de «${form.procedure}». Léela con calma y fírmala aquí: ${link}. ` +
      `Si algo no te queda claro, respóndenos por este medio antes de firmar. ¡Gracias!`;

  // PDF — solo sale con la ventana abierta (en modo plantilla el helper lo
  // ignora: las plantillas de DaleControl son de solo texto). Best-effort: lo
  // esencial es la liga.
  let attachment: WhatsAppOutboundAttachment | null = null;
  try {
    const pdf = await buildConsentPdf(form.id, ctx.clinicId);
    if (pdf) {
      attachment = {
        buffer: pdf.buffer,
        filename: pdf.fileName,
        caption: `Consentimiento informado · ${form.procedure}`,
      };
    }
  } catch (e) {
    console.error("[consent/send-whatsapp] no se pudo generar el PDF:", e);
  }

  try {
    await sendWhatsAppLogged({
      clinic: {
        id: clinic.id,
        waPhoneNumberId: clinic.waPhoneNumberId,
        waAccessToken: clinic.waAccessToken,
        waConnected: clinic.waConnected,
        waTemplates: clinic.waTemplates,
      },
      to: patientPhone,
      body,
      kind: "consent",
      // Orden del spec dc_consentimiento_listo: paciente, clínica,
      // procedimiento, liga. Meta sustituye por POSICIÓN, no por nombre.
      templateParams: [patientName, clinic.name, form.procedure, link],
      attachment,
    });
  } catch (e) {
    if (e instanceof WhatsAppBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : "No se pudo enviar el mensaje.";
    console.error(`[consent/send-whatsapp] fallo al enviar (${form.id}):`, e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ ok: true, patientId: form.patientId });
}
