import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { listarCfdiDePagos } from "@/lib/invoices/cfdi-pago-db";

// GET /api/payments/cfdi?invoiceId=… — el CFDI (vigente o apartado) de CADA
// pago de una factura, en una sola consulta. Lo usa el detalle de factura
// para pintar la insignia "Facturado" junto a cada pago sin una petición por
// fila (ws1-t1, sep-2026).
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  if (!invoiceId) return NextResponse.json({ error: "Falta invoiceId" }, { status: 400 });

  const invoice = await prisma.invoice.findFirst({
    where:  { id: invoiceId, clinicId: ctx.clinicId },
    select: { patientId: true },
  });
  if (!invoice) return NextResponse.json({ items: {} });
  if (invoice.patientId) {
    const visDenied = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  const mapa = await listarCfdiDePagos(prisma, { clinicId: ctx.clinicId, invoiceId });
  const items: Record<string, { uuid: string; status: string; total: number; xmlUrl: string | null; pdfUrl: string | null }> = {};
  for (const [paymentId, f] of mapa) items[paymentId] = { uuid: f.uuid, status: f.status, total: f.total, xmlUrl: f.xmlUrl, pdfUrl: f.pdfUrl };
  return NextResponse.json({ items });
}
