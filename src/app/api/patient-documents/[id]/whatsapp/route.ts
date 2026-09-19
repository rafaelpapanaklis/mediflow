// POST /api/patient-documents/[id]/whatsapp — manda la nota FIRMADA al WhatsApp
// del paciente: un texto y, detrás, el PDF adjunto.
//
// Mismo patrón que /api/quotes/[id]/send-whatsapp (rate limit, permiso,
// visibilidad del paciente, credenciales de ESTA clínica, WhatsAppBlockedError).
//
// PERMISO: "medicalRecord.edit", el mismo que firmar. A propósito NO se exige
// "whatsapp.send": el doctor no lo tiene por defecto y se quedaría sin mandar su
// propia nota (mismo criterio que /api/prescriptions/[id]/send). Y "view" a
// secas no basta: sacar un documento clínico de la clínica es más que leerlo.
//
// LA VENTANA DE 24 HORAS: fuera de ella Meta solo deja plantillas, que cuestan
// dinero y no pueden llevar adjunto. Una nota clínica no tiene plantilla, así
// que se manda con kind "system" —el único sin plantilla—: con la ventana
// cerrada `sendWhatsAppLogged` BLOQUEA antes de llamar a Meta (no se gasta nada)
// y aquí se contesta 409 con el motivo y qué hacer. Nunca falla en silencio.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { construirPdfDeDocumento } from "@/lib/patient-documents/pdf";
import { enmascararTelefono, explicarFalloDeWhatsApp, mensajeDeWhatsApp } from "@/lib/patient-documents/envio";
import { entrar, ESCRIBIR } from "../../_lib/http";
import { cargarNotaParaSalida, soloFirmadas } from "../../_lib/salida";

export const runtime = "nodejs"; // genera el PDF
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrar(req, ESCRIBIR, 10);
  if ("res" in e) return e.res;
  const { ctx } = e;

  try {
    const s = await cargarNotaParaSalida(ctx, params.id);
    if ("res" in s) return s.res;
    const sinFirmar = soloFirmadas(s.nota);
    if (sinFirmar) return sinFirmar;

    const [patient, clinic] = await Promise.all([
      prisma.patient.findFirst({
        where: { id: s.patientId, clinicId: ctx.clinicId },
        select: { phone: true },
      }),
      prisma.clinic.findUnique({
        where: { id: ctx.clinicId },
        select: { id: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true },
      }),
    ]);
    const telefono = patient?.phone?.trim();
    if (!telefono) {
      return NextResponse.json(
        { error: "El paciente no tiene teléfono registrado. Agrégalo en su expediente para poder enviarle la nota.", code: "SIN_TELEFONO" },
        { status: 409 },
      );
    }
    if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
      return NextResponse.json(
        { error: "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp.", code: "WA_SIN_CONECTAR" },
        { status: 409 },
      );
    }

    // Aquí el PDF no es un extra (como en presupuestos, donde lo esencial es la
    // liga): ES el documento. Si no se puede generar, no se manda nada.
    const pdf = await construirPdfDeDocumento(s.doc);

    try {
      await sendWhatsAppLogged({
        clinic,
        to: telefono,
        body: mensajeDeWhatsApp({ ...s.doc, cuerpoHtml: "" }),
        kind: "system",
        // "system" no liga el hilo al paciente por defecto; aquí sí es a él.
        linkPatient: true,
        patientId: s.patientId,
        sentById: ctx.userId,
        attachment: { buffer: pdf.buffer, filename: pdf.fileName, caption: s.doc.titulo },
      });
    } catch (err) {
      const fallo = explicarFalloDeWhatsApp(err);
      if (fallo.code === "WA_FALLO") console.error(`[patient-documents/whatsapp] fallo al enviar (${s.nota.id}):`, err);
      return NextResponse.json({ error: fallo.error, code: fallo.code }, { status: fallo.status });
    }

    const destino = enmascararTelefono(telefono);
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId,
      entityType: "record", entityId: s.nota.id, action: "update",
      before: { documento: "NOTA_EVOLUCION", enviadoPor: null },
      after: { documento: "NOTA_EVOLUCION", enviadoPor: "whatsapp", destino },
    });
    return NextResponse.json({ ok: true, destino });
  } catch (err) {
    console.error("Patient document whatsapp error:", err);
    return NextResponse.json({ error: "No se pudo enviar la nota por WhatsApp" }, { status: 500 });
  }
}
