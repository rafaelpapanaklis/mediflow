import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildInvoicePrintPdf } from "@/lib/invoices/print-pdf";

export const runtime = "nodejs"; // @react-pdf/renderer no corre en edge
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Comprobante de pago A4 (CARTA) — NO fiscal. El documento y su query viven
// en lib/invoices/print-pdf, COMPARTIDOS con el aviso de saldo por WhatsApp
// (POST /api/invoices/[id]/send-whatsapp adjunta el mismo PDF). Esta ruta
// conserva la auth, el permiso y la visibilidad por paciente, que se verifican
// ANTES de generar nada. Multi-tenant por clinicId (getAuthContext).

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // El comprobante es un documento de facturación: exige "billing.view" además
  // del clinicId de sesión y de la visibilidad por paciente de abajo.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId }, // scope multi-tenant
    select: { patientId: true },
  });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // Visibilidad: el comprobante PDF renderiza nombre + RFC + razón social del
  // paciente. Si este usuario no puede verlo, 404 — no generar el PDF.
  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  try {
    const pdf = await buildInvoicePrintPdf(params.id, ctx.clinicId);
    if (!pdf) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

    return new NextResponse(new Uint8Array(pdf.buffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.fileName}"`,
        "Cache-Control":       "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Comprobante PDF error:", err);
    return NextResponse.json({ error: "Error generando el comprobante" }, { status: 500 });
  }
}
