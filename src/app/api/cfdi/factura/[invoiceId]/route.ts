import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { cfdisDeLaFactura } from "@/lib/invoices/cfdi-cancelacion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cfdi/factura/[invoiceId] — todos los CFDI de una factura (ingreso,
// por pago, sustitutos y notas de crédito) con su estado ante el SAT y la
// predicción de si cancelar pedirá aceptación del receptor (ws1-t3). Lo usa el
// bloque «CFDI ante el SAT» de la factura. `listo:false` = falta pegar
// sql/ws1-t3-cfdi-cancelacion.sql (los botones de cancelar y nota de crédito
// se ocultan; «Consultar estado» sigue).
export async function GET(_req: NextRequest, { params }: { params: { invoiceId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const inv = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, clinicId: ctx.clinicId },
    select: { patientId: true, cfdiUuid: true, paid: true },
  });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const deniedP = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (deniedP) return deniedP;
  }
  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const r = await cfdisDeLaFactura({ clinicId: ctx.clinicId, invoiceId: params.invoiceId, timeZone: clinic?.timezone });
  // C-42: con lo cobrado, el diálogo de cancelar no ofrece el motivo 03.
  return NextResponse.json({ ...r, invoiceCfdiUuid: inv.cfdiUuid, puedeCancelar: ctx.isAdmin, cobrado: inv.paid ?? 0 });
}
