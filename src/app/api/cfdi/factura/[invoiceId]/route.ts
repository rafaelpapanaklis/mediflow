import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { adminConPermiso } from "@/lib/auth/admin-con-permiso";
import { hasPermission } from "@/lib/auth/permissions";
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
export async function GET(_req: NextRequest, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const inv = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, clinicId: ctx.clinicId },
    select: { patientId: true, cfdiUuid: true, paid: true, balance: true },
  });
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (inv.patientId) {
    const deniedP = await assertPatientVisible(inv.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (deniedP) return deniedP;
  }
  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const r = await cfdisDeLaFactura({ clinicId: ctx.clinicId, invoiceId: params.invoiceId, timeZone: clinic?.timezone });
  // C-42: con lo cobrado, el diálogo de cancelar no ofrece el motivo 03.
  // ws1-t11 v5: lo que la pantalla ofrece sale del MISMO criterio que cada ruta de cambio, no solo del rol:
  //   · cancelar (POST /api/cfdi/[id]/cancelar): administrador + «Reembolsar / cancelar»; el dueño siempre;
  //   · timbrar / sustituir y nota de crédito como bonificación (POST /api/cfdi, …/nota-credito): administrador;
  //   · nota de crédito DEVOLVIENDO dinero (…/nota-credito): administrador + «Reembolsar / cancelar».
  return NextResponse.json({
    ...r,
    invoiceCfdiUuid: inv.cfdiUuid,
    puedeCancelar: adminConPermiso(ctx, "billing.refund"),
    puedeTimbrar: ctx.isAdmin,
    puedeDevolver: ctx.isAdmin && hasPermission(ctx, "billing.refund"),
    cobrado: inv.paid ?? 0,
    saldo: inv.balance ?? 0,
  });
}
