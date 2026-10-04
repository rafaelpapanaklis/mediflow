import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { isUsableWhereId } from "@/lib/validations";
import { resolveTaxMode, type CfdiTaxMode } from "@/lib/invoice-totals";
import { avisoDeConceptos } from "@/lib/cfdi/fiscal-concepto";
import { conceptosFiscalesDeFactura } from "@/lib/cfdi/fiscal-concepto.server";

export const dynamic = "force-dynamic";

/**
 * GET /api/cfdi/conceptos?invoiceId=…[&taxMode=exento|iva16]  (ws1-t4, auditoría de uso C-40)
 *
 * Con qué clave SAT e IVA va a salir cada concepto si se timbra AHORA, y el aviso de los que
 * no se pudieron ligar a su procedimiento (antes un blanqueamiento marcado con 16% salía
 * exento sin que nadie se enterara). La MISMA resolución que POST /api/cfdi. Solo lectura;
 * mismo permiso y visibilidad que abrir la factura; el clinicId sale de la sesión.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  if (!isUsableWhereId(invoiceId)) return NextResponse.json({ error: "Falta indicar la factura." }, { status: 400 });
  const taxModeIn = req.nextUrl.searchParams.get("taxMode");

  const [invoice, clinic] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId: ctx.clinicId },
      select: { patientId: true, items: true, taxRate: true, taxIncluded: true },
    }),
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { cfdiTaxMode: true, locale: true } }),
  ]);
  if (!invoice) return NextResponse.json({ conceptos: [], aviso: null });
  if (invoice.patientId) {
    const vis = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (vis) return vis;
  }

  const items = Array.isArray(invoice.items) ? (invoice.items as any[]) : [];
  const taxMode: CfdiTaxMode = taxModeIn === "iva16" || taxModeIn === "exento" ? taxModeIn : resolveTaxMode(invoice, clinic?.cfdiTaxMode);
  const { conceptos, catalogo } = await conceptosFiscalesDeFactura(prisma, {
    clinicId: ctx.clinicId, invoiceId, items, ivaDeLaFactura: taxMode,
  });
  const filas = conceptos.map((c, i) => ({
    descripcion: String(items[i]?.description ?? ""),
    claveSat: c.claveSat, ivaModo: c.ivaModo, origenIva: c.origenIva, ligado: c.ligado, ambiguo: c.ambiguo,
  }));
  return NextResponse.json({
    conceptos: filas,
    aviso: avisoDeConceptos(filas.map((f, i) => ({ descripcion: f.descripcion, resuelto: conceptos[i] })), catalogo, clinic?.locale),
  });
}
