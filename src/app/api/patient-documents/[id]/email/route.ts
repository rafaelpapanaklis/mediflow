// POST /api/patient-documents/[id]/email — manda la nota FIRMADA al correo que
// el paciente tiene en su expediente. El destinatario NO viene del cliente: una
// nota clínica no se manda a una dirección escrita a mano en un cuadro de texto.
//
// `sendEmail` (src/lib/email.ts) no sabe adjuntar archivos, así que el correo
// lleva el documento mismo, como carta, y no el PDF. Y `sendEmail` no lanza: si
// no hay transporte configurado o el proveedor falla devuelve
// `delivered: false`, y aquí eso se DICE en pantalla en vez de darlo por enviado.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { correoDelDocumento, enmascararCorreo } from "@/lib/patient-documents/envio";
import { entrar, VER } from "../../_lib/http";
import { cargarNotaParaSalida, soloFirmadas } from "../../_lib/salida";

export const dynamic = "force-dynamic";

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrar(req, VER, 10);
  if ("res" in e) return e.res;
  const { ctx } = e;

  try {
    const s = await cargarNotaParaSalida(ctx, params.id);
    if ("res" in s) return s.res;
    const sinFirmar = soloFirmadas(s.nota);
    if (sinFirmar) return sinFirmar;

    const patient = await prisma.patient.findFirst({
      where: { id: s.patientId, clinicId: ctx.clinicId },
      select: { email: true },
    });
    const correo = patient?.email?.trim() ?? "";
    if (!CORREO_VALIDO.test(correo)) {
      return NextResponse.json(
        { error: "El paciente no tiene un correo válido registrado. Agrégalo en su expediente para poder enviarle la nota.", code: "SIN_CORREO" },
        { status: 409 },
      );
    }

    const { subject, html, text } = correoDelDocumento(s.doc);
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
      entityType: "record", entityId: s.nota.id, action: "update",
      before: { documento: "NOTA_EVOLUCION", enviadoPor: null },
      after: { documento: "NOTA_EVOLUCION", enviadoPor: "correo", destino },
    });
    return NextResponse.json({ ok: true, destino });
  } catch (err) {
    console.error("Patient document email error:", err);
    return NextResponse.json({ error: "No se pudo enviar la nota por correo" }, { status: 500 });
  }
}
