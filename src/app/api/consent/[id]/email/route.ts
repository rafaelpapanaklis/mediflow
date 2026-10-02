// POST /api/consent/[id]/email — manda la carta FIRMADA al correo que el
// paciente tiene en su expediente. Es la cuarta acción de la barra común de los
// documentos (`DocumentoAcciones`) y responde con SU contrato: `{ ok, destino }`
// o `{ error, code }`, igual que /api/patient-documents/[id]/email.
//
// El destinatario NO viene del cliente. `sendEmail` no sabe adjuntar, así que el
// correo lleva la carta misma (`correoDelDocumento`, el común) y no el PDF; y
// como no lanza, un `delivered: false` se DICE en pantalla.
//
// Solo lo firmado y vigente sale de la clínica: una carta sin firmar se manda
// con su liga para firmar (send-whatsapp), y una revocada no se manda.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { correoDelDocumento, enmascararCorreo } from "@/lib/patient-documents/envio";
import { loadConsentDocumento } from "@/lib/consent/consent-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hasta cuatro firmas que bajar del bucket (4 s cada una como mucho).
export const maxDuration = 60;

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // El mismo permiso del módulo que pide el envío por WhatsApp: quien solo
  // puede ver no le manda nada al paciente.
  const denied = denyIfMissingPermission(ctx, "consents.create");
  if (denied) return denied;
  if (!ctx.clinicId) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  try {
    const form = await prisma.consentForm.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
      select: {
        id: true, patientId: true, signedAt: true, revokedAt: true,
        patient: { select: { email: true } },
      },
    });
    if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

    const hidden = await assertPatientVisible(form.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (hidden) return hidden;

    if (form.revokedAt) {
      return NextResponse.json(
        { error: "Este consentimiento está revocado: no hay nada que enviarle al paciente.", code: "REVOKED" },
        { status: 409 },
      );
    }
    if (!form.signedAt) {
      return NextResponse.json(
        { error: "Solo se puede enviar una carta firmada. Para que el paciente la firme, mándale la liga.", code: "NOT_SIGNED" },
        { status: 409 },
      );
    }

    const correo = form.patient?.email?.trim() ?? "";
    if (!CORREO_VALIDO.test(correo)) {
      return NextResponse.json(
        { error: "El paciente no tiene un correo válido registrado. Agrégalo en su expediente para poder enviarle la carta.", code: "SIN_CORREO" },
        { status: 409 },
      );
    }

    const doc = await loadConsentDocumento(form.id, ctx.clinicId);
    if (!doc) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

    const { subject, html, text } = correoDelDocumento({
      tipo: "Consentimiento informado",
      titulo: doc.titulo,
      fecha: doc.encabezado.fecha,
      clinicaNombre: doc.encabezado.clinicaNombre,
      pacienteNombre: doc.encabezado.pacienteNombre,
      doctorNombre: doc.encabezado.doctorNombre,
      cedula: doc.encabezado.cedula,
      cuerpoHtml: doc.html,
    });
    const { delivered } = await sendEmail({ to: correo, subject, html, text });
    if (!delivered) {
      return NextResponse.json(
        { error: "No se envió: el servicio de correo no aceptó el mensaje. Inténtalo más tarde o descarga el PDF.", code: "CORREO_NO_ENTREGADO" },
        { status: 502 },
      );
    }

    const destino = enmascararCorreo(correo);
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId,
      entityType: "consent", entityId: form.id, action: "update",
      before: { enviadoPor: null },
      after: { enviadoPor: "correo", destino },
    });
    return NextResponse.json({ ok: true, destino });
  } catch (err) {
    console.error("[consent/email] error:", err);
    return NextResponse.json({ error: "No se pudo enviar la carta por correo" }, { status: 500 });
  }
}
