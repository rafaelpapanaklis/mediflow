// POST /api/invoices/[id]/send-email — manda la factura al CORREO del paciente.
//
// Hermana de POST /api/invoices/[id]/send-whatsapp: mismas comprobaciones
// (sesión, clínica, visibilidad del paciente, estados que se pueden mandar) y
// mismo contrato de error (`{ error }` con un motivo legible que el panel
// enseña tal cual). El transporte es el central (`lib/email` → Resend), el
// mismo con el que ya salen las recetas.
//
// ⛔ Sale al PACIENTE. Por eso:
//  · sin correo registrado → 409 con el motivo (la pantalla ya deshabilita el
//    botón; esto cierra el POST directo);
//  · si el transporte no está configurado o rechaza el envío → 502. NUNCA se
//    contesta `ok` por un correo que no salió: `sendEmail` no lanza, devuelve
//    `delivered: false`, y aquí eso es un error.
//
// El correo lleva el detalle en el cuerpo (conceptos, total, saldo y la frase
// del trato) y, con body `{ linkPago: true }` y permiso de cobrar (ws1-t1:
// la factura se cobra por Mercado Pago), el link y el monto. No adjunta el PDF: `lib/email` no admite adjuntos y ese archivo
// es compartido — queda anotado en el reporte.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { CODIGO_NO_CONTACTAR } from "@/lib/patients/paciente-de-prueba";
import { CHARGEABLE_INVOICE_STATUSES } from "@/components/dashboard/billing/invoice-status";
import { buildCorreoFactura } from "@/lib/invoices/correo-factura";
import { contactoDelResponsableDeLaFactura } from "@/lib/orthodontics/responsable-telefono-db";
import { destinatariosDeEnvio, esDestinoDeEnvio, type Destinatario } from "@/lib/invoices/destinatarios";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { linkParaEnviar } from "@/lib/factura-mp/envio.server";

export const dynamic = "force-dynamic";

// Mismos estados que el aviso por WhatsApp, más PAID: a una factura ya pagada sí
// tiene sentido mandarle su comprobante por correo (el WhatsApp es un aviso de
// SALDO y por eso allá no entra). Borrador y cancelada, no.
const SENDABLE_STATUSES: string[] = [
  ...CHARGEABLE_INVOICE_STATUSES.filter((s) => s !== "DRAFT"),
  "PAID",
];

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.create");
  if (denied) return denied;
  if (!ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: {
      id: true, invoiceNumber: true, status: true, total: true, paid: true, balance: true,
      items: true, patientId: true,
      patient: { select: { firstName: true, lastName: true, email: true } },
      clinic: { select: { name: true, phone: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  if (invoice.patientId) {
    const deniedPatient = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
  }

  if (!SENDABLE_STATUSES.includes(invoice.status)) {
    return NextResponse.json(
      { error: "Solo se puede enviar por correo una factura emitida (pendiente, parcial, vencida o pagada). Un borrador o una cancelada, no." },
      { status: 409 },
    );
  }

  // ws1-t10: si el caso tiene RESPONSABLE DE PAGO con correo, la factura va a él (y al paciente si se
  // pide o si el responsable no tiene); sin responsable, al paciente, como siempre. El aviso de «no
  // tiene correo» solo sale si ninguno de los dos tiene uno válido.
  const pedido = await req.json().catch(() => null);
  const destino = esDestinoDeEnvio(pedido?.destino) ? pedido.destino : "auto";
  const responsable = await contactoDelResponsableDeLaFactura(ctx.clinicId, invoice.id);
  const nombrePaciente = `${invoice.patient?.firstName ?? ""} ${invoice.patient?.lastName ?? ""}`.trim() || "Paciente";
  const correoPaciente = invoice.patient?.email?.trim() ?? "";
  const { destinatarios, sinContacto, motivo } = destinatariosDeEnvio({
    paciente: { nombre: nombrePaciente, correo: correoPaciente },
    responsable: responsable ? { nombre: responsable.nombre, parentesco: responsable.parentesco, correo: responsable.correo } : null,
    canal: "correo",
    destino,
  });
  if (sinContacto) {
    if (responsable) return NextResponse.json({ error: motivo }, { status: 409 });
    if (!correoPaciente) {
      return NextResponse.json(
        { error: "El paciente no tiene correo registrado. Agrégalo en su expediente para poder enviarle la factura." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "El correo registrado del paciente no parece válido. Corrígelo en su expediente." },
      { status: 409 },
    );
  }

  // Best-effort: sin condiciones (o sin tabla) el correo sale igual, sin la frase.
  const { porFactura } = await leerCondicionesDeFacturas(prisma, {
    clinicId: ctx.clinicId,
    invoiceIds: [invoice.id],
  });

  // Link de Mercado Pago (ws1-t1). Nunca lanza: sin link, el correo de siempre.
  const { link, aviso: avisoLink } = await linkParaEnviar({
    clinicId: ctx.clinicId,
    invoiceId: invoice.id,
    userId: ctx.userId,
    pedido: pedido?.linkPago === true,
    puedeCobrar: denyIfMissingPermission(ctx, "billing.charge") === null,
  });

  const enviados: Destinatario[] = [];
  const fallos: Destinatario[] = [];
  for (const d of destinatarios) {
    const { subject, html, text } = buildCorreoFactura({
      // Al responsable se le saluda a él.
      patient: d.rol === "responsable" ? { firstName: d.nombre, lastName: "" } : invoice.patient,
      clinicName: invoice.clinic?.name ?? "",
      clinicPhone: invoice.clinic?.phone ?? null,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      paid: invoice.paid,
      balance: invoice.balance,
      items: invoice.items,
      condiciones: porFactura.get(invoice.id) ?? null,
      linkPago: link,
    });
    // ws1-t11 (11d): el freno mira al PACIENTE de la factura, también cuando
    // el correo va a su responsable de pago.
    const { delivered, bloqueado } = await sendEmail({
      to: d.valor, subject, html, text,
      paciente: { clinicId: ctx.clinicId, patientId: invoice.patientId ?? null },
    });
    if (bloqueado) {
      return NextResponse.json({ error: bloqueado, code: CODIGO_NO_CONTACTAR }, { status: 409 });
    }
    (delivered ? enviados : fallos).push(d);
  }
  if (enviados.length === 0) {
    return NextResponse.json(
      { error: `El correo no salió: el servicio de correo no está configurado o rechazó el envío. La factura no se le mandó ${destinatarios[0].rol === "responsable" ? "al responsable de pago" : "al paciente"}.` },
      { status: 502 },
    );
  }
  const parcial = fallos.length > 0
    ? `Salió a ${enviados.map((d) => d.nombre).join(" y ")}, pero no a ${fallos.map((d) => d.nombre).join(" ni a ")}.`
    : null;

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "update",
    before: { sentVia: null },
    after: { sentVia: "email", to: enviados.map((d) => d.rol), ...(link ? { paymentLink: "mercadopago" } : {}) },
  });

  return NextResponse.json({
    ok: true,
    patientId: invoice.patientId ?? null,
    enviadoA: enviados.map((d) => ({ rol: d.rol, nombre: d.nombre })),
    avisoParcial: parcial,
    linkPago: link ? { ...link, enMensaje: true } : null,
    avisoLink,
  });
}
