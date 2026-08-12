// POST /api/invoices/[id]/send-whatsapp — aviso de saldo pendiente al paciente.
//
// Con la ventana de 24 h abierta sale como texto libre (resumen con folio,
// saldo y conceptos) + el comprobante PDF adjunto en el mismo hilo. Con la
// ventana cerrada, sendWhatsAppLogged resuelve la plantilla `payment_notice`
// (dc_aviso_saldo) o bloquea con un motivo legible que aquí se propaga tal
// cual al panel. NO existe pago online: el aviso dirige a pagar EN la clínica
// o por teléfono, por eso el teléfono de la clínica es obligatorio.
//
// Multi-tenant: clinicId de la sesión; la factura se verifica contra él y las
// credenciales de WhatsApp son las de ESA clínica.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { CHARGEABLE_INVOICE_STATUSES } from "@/components/dashboard/billing/invoice-status";
import { buildInvoicePrintPdf } from "@/lib/invoices/print-pdf";
import { sendWhatsAppLogged, type WhatsAppOutboundAttachment } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";

export const runtime = "nodejs"; // genera el PDF con @react-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cobrables SIN el borrador: un DRAFT todavía no es un saldo exigible y el
// aviso le cobraría al paciente algo que la clínica no ha confirmado.
const SENDABLE_STATUSES = CHARGEABLE_INVOICE_STATUSES.filter((s) => s !== "DRAFT");

function fmtMXN(n: number): string {
  const v = new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return `${v} MXN`;
}

/** "Limpieza, Resina y 2 más" — resumen corto de los conceptos para el texto. */
function summarizeItems(raw: unknown): string {
  const items = Array.isArray(raw) ? (raw as any[]) : [];
  const names = items
    .map((it) => String(it?.description ?? it?.name ?? "").trim())
    .filter((s) => s.length > 0);
  if (names.length === 0) return "";
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.join(", ");
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return denied;

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: {
      id: true, invoiceNumber: true, status: true, balance: true, items: true, patientId: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
      clinic: {
        select: {
          id: true, name: true, phone: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true,
        },
      },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // El aviso lleva nombre y saldo del paciente: mismo gate de visibilidad que
  // el comprobante impreso.
  if (invoice.patientId) {
    const deniedPatient = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
  }

  if (!SENDABLE_STATUSES.includes(invoice.status as (typeof SENDABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: "Solo se puede enviar el aviso de una factura con saldo por cobrar (pendiente, parcial o vencida)." },
      { status: 409 },
    );
  }

  const patientPhone = invoice.patient?.phone?.trim();
  if (!patientPhone) {
    return NextResponse.json(
      { error: "El paciente no tiene teléfono registrado. Agrégalo en su expediente para poder avisarle por WhatsApp." },
      { status: 409 },
    );
  }

  const clinic = invoice.clinic;
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json(
      { error: "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp." },
      { status: 409 },
    );
  }

  // {{4}} de dc_aviso_saldo: sin teléfono de la clínica el aviso no tiene a
  // dónde dirigir el pago.
  const clinicPhone = clinic.phone?.trim();
  if (!clinicPhone) {
    return NextResponse.json(
      { error: "Falta el teléfono de la clínica: regístralo en Configuración → Clínica para poder enviar el aviso de saldo." },
      { status: 409 },
    );
  }

  const patientName =
    `${invoice.patient?.firstName ?? ""} ${invoice.patient?.lastName ?? ""}`.trim() || "Paciente";
  const monto = fmtMXN(invoice.balance);
  const conceptos = summarizeItems(invoice.items);
  const body =
    `Hola ${patientName}, te saludamos de ${clinic.name}. ` +
    `Tienes un saldo pendiente de ${monto} de tu nota ${invoice.invoiceNumber}` +
    `${conceptos ? ` (${conceptos})` : ""}. ` +
    `Puedes pagar en la clínica o llamarnos al ${clinicPhone} para coordinarlo. ¡Gracias!`;

  // Comprobante PDF — solo sale con la ventana abierta (en modo plantilla el
  // helper lo ignora). Best-effort: sin PDF el aviso sigue valiendo.
  let attachment: WhatsAppOutboundAttachment | null = null;
  try {
    const pdf = await buildInvoicePrintPdf(invoice.id, ctx.clinicId);
    if (pdf) {
      attachment = { buffer: pdf.buffer, filename: pdf.fileName, caption: `Comprobante ${invoice.invoiceNumber}` };
    }
  } catch (e) {
    console.error("[invoices/send-whatsapp] no se pudo generar el comprobante PDF:", e);
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
      kind: "payment_notice",
      // Orden del spec dc_aviso_saldo: paciente, clínica, monto, teléfono.
      templateParams: [patientName, clinic.name, monto, clinicPhone],
      attachment,
    });
  } catch (e) {
    // Bloqueo decidido ANTES de llamar a Meta (fuera de ventana sin plantilla
    // utilizable): el motivo ya viene en español para el panel.
    if (e instanceof WhatsAppBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : "No se pudo enviar el mensaje.";
    console.error(`[invoices/send-whatsapp] fallo al enviar (${invoice.id}):`, e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ ok: true, patientId: invoice.patientId ?? null });
}
