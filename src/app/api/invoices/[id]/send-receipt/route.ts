// POST /api/invoices/[id]/send-receipt — «Enviar recibo» (ws1-t3 fase 3).
//
// Confirma un pago YA RECIBIDO (cualquier método: efectivo, transferencia,
// terminal, Mercado Pago, anticipo…), NO pide dinero. Solo sale al pulsarlo
// — nunca automático. Dentro de la ventana de 24 h, texto libre + el
// comprobante PDF adjunto (mismo documento y query que print/route.tsx y el
// aviso de saldo). Fuera de ventana, la plantilla opcional `payment_receipt`
// (dc_recibo_pago) si la clínica la encendió en Configuración → Anticipos; si
// no, se bloquea con un motivo legible — nunca intenta una plantilla que no
// existe.
//
// Multi-tenant: clinicId de la sesión; visibilidad por paciente antes de
// tocar nada. Mismo permiso que el resto de envíos de WhatsApp del panel.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildInvoicePrintPdf } from "@/lib/invoices/print-pdf";
import { textoRecibo } from "@/lib/anticipos/mensaje-panel";
import { formatoPesos } from "@/lib/anticipos/core";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { contactoDelResponsableDeLaFactura } from "@/lib/orthodontics/responsable-telefono-db";
import { destinatariosDeEnvio, esDestinoDeEnvio, type Destinatario } from "@/lib/invoices/destinatarios";

export const runtime = "nodejs"; // genera el PDF con @react-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return denied;

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: {
      id: true, invoiceNumber: true, paid: true, patientId: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
      clinic: { select: { id: true, name: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.patientId) {
    const deniedPatient = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (deniedPatient) return deniedPatient;
  }
  if (!(invoice.paid > 0)) {
    return NextResponse.json({ error: "Esta factura todavía no tiene ningún pago registrado." }, { status: 409 });
  }

  // ws1-t10: el recibo va al RESPONSABLE DE PAGO del caso si tiene teléfono (y al paciente si se pide o
  // si el responsable no tiene); sin responsable, al paciente, como siempre.
  const pedido = await req.json().catch(() => null);
  const destino = esDestinoDeEnvio(pedido?.destino) ? pedido.destino : "auto";
  const responsable = await contactoDelResponsableDeLaFactura(ctx.clinicId, invoice.id);
  const paciente = invoice.patient ? `${invoice.patient.firstName} ${invoice.patient.lastName ?? ""}`.trim() : "Paciente";
  const { destinatarios, sinContacto, motivo } = destinatariosDeEnvio({
    paciente: { nombre: paciente, telefono: invoice.patient?.phone },
    responsable: responsable ? { nombre: responsable.nombre, parentesco: responsable.parentesco, telefono: responsable.telefono } : null,
    canal: "telefono",
    destino,
  });
  if (sinContacto) {
    return NextResponse.json({ error: responsable ? motivo : "El paciente no tiene teléfono registrado." }, { status: 409 });
  }
  const clinic = invoice.clinic;
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json({ error: "WhatsApp no está conectado en esta clínica." }, { status: 409 });
  }


  let attachment: WhatsAppOutboundAttachment | null = null;
  try {
    const pdf = await buildInvoicePrintPdf(invoice.id, ctx.clinicId);
    if (pdf) attachment = { buffer: pdf.buffer, filename: pdf.fileName, caption: `Comprobante ${invoice.invoiceNumber}` };
  } catch (e) {
    console.error("[invoices/send-receipt] no se pudo generar el comprobante PDF:", e);
  }

  const enviados: Destinatario[] = [];
  const fallos: { a: Destinatario; status: number; error: string }[] = [];
  for (const d of destinatarios) {
    // Al responsable se le saluda a él; el recibo lleva el folio de la factura.
    const texto = textoRecibo({ paciente: d.nombre, clinica: clinic.name, monto: invoice.paid, folio: invoice.invoiceNumber });
    try {
      await sendWhatsAppLogged({
        clinic: {
          id: clinic.id,
          waPhoneNumberId: clinic.waPhoneNumberId,
          waAccessToken: clinic.waAccessToken,
          waConnected: clinic.waConnected,
          waTemplates: clinic.waTemplates,
        },
        to: d.valor,
        body: texto,
        kind: "payment_receipt",
        templateParams: [d.nombre, clinic.name, formatoPesos(invoice.paid), invoice.invoiceNumber],
        attachment,
      });
      enviados.push(d);
    } catch (e) {
      if (e instanceof WhatsAppBlockedError) {
        fallos.push({ a: d, status: 409, error: e.message });
      } else {
        console.error(`[invoices/send-receipt] fallo al enviar (${invoice.id}):`, e);
        fallos.push({ a: d, status: 502, error: e instanceof Error ? e.message : "No se pudo enviar el mensaje." });
      }
    }
  }
  if (enviados.length === 0) return NextResponse.json({ error: fallos[0].error }, { status: fallos[0].status });
  const parcial = fallos.length > 0
    ? `Salió a ${enviados.map((d) => d.nombre).join(" y ")}, pero no a ${fallos.map((f) => `${f.a.nombre} (${f.error})`).join(" ni a ")}.`
    : null;

  return NextResponse.json({ ok: true, enviadoA: enviados.map((d) => ({ rol: d.rol, nombre: d.nombre })), avisoParcial: parcial });

}
