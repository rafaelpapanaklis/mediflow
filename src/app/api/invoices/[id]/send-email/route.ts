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
// del trato). No adjunta el PDF: `lib/email` no admite adjuntos y ese archivo
// es compartido — queda anotado en el reporte.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { CHARGEABLE_INVOICE_STATUSES } from "@/components/dashboard/billing/invoice-status";
import { buildCorreoFactura } from "@/lib/invoices/correo-factura";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";

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

  const correo = invoice.patient?.email?.trim() ?? "";
  if (!correo) {
    return NextResponse.json(
      { error: "El paciente no tiene correo registrado. Agrégalo en su expediente para poder enviarle la factura." },
      { status: 409 },
    );
  }
  if (!CORREO_VALIDO.test(correo)) {
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

  const { subject, html, text } = buildCorreoFactura({
    patient: invoice.patient,
    clinicName: invoice.clinic?.name ?? "",
    clinicPhone: invoice.clinic?.phone ?? null,
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    paid: invoice.paid,
    balance: invoice.balance,
    items: invoice.items,
    condiciones: porFactura.get(invoice.id) ?? null,
  });

  const { delivered } = await sendEmail({ to: correo, subject, html, text });
  if (!delivered) {
    return NextResponse.json(
      { error: "El correo no salió: el servicio de correo no está configurado o rechazó el envío. La factura no se le mandó al paciente." },
      { status: 502 },
    );
  }

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "update",
    before: { sentVia: null },
    after: { sentVia: "email" },
  });

  return NextResponse.json({ ok: true, patientId: invoice.patientId ?? null });
}
