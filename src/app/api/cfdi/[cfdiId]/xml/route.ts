import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOrgApiKey, downloadInvoiceFile } from "@/lib/facturapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cfdi/[cfdiId]/xml — proxy del XML del CFDI desde Facturapi.
// Mismo gate que el PDF hermano: clinicId de sesión + permiso "billing.view" +
// visibilidad por paciente. Timbrar sigue admin-only. La org key nunca sale.
export async function GET(req: NextRequest, { params }: { params: { cfdiId: string } }) {
  const rl = rateLimit(req, 30, 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const record = await prisma.cfdiRecord.findFirst({
    where:  { id: params.cfdiId, clinicId: ctx.clinicId },
    select: { facturapiId: true, uuid: true, invoiceId: true, clinic: { select: { facturApiOrgId: true } } },
  });
  if (!record?.facturapiId || !record.clinic?.facturApiOrgId) {
    return NextResponse.json({ error: "CFDI no encontrado" }, { status: 404 });
  }

  // Visibilidad por paciente: el CFDI lleva su identidad fiscal. CfdiRecord no
  // tiene relación con Invoice (solo el FK escalar), así que se resuelve aparte.
  if (record.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where:  { id: record.invoiceId, clinicId: ctx.clinicId },
      select: { patientId: true },
    });
    if (invoice?.patientId) {
      const deniedPatient = await assertPatientVisible(invoice.patientId, {
        userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
      });
      if (deniedPatient) return deniedPatient;
    }
  }

  try {
    const orgApiKey = await getOrgApiKey(record.clinic!.facturApiOrgId!);
    const buf = await downloadInvoiceFile(orgApiKey, record.facturapiId, "xml");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":        "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="CFDI-${record.uuid}.xml"`,
        "Cache-Control":       "private, no-store",
      },
    });
  } catch (err: any) {
    console.error("CFDI xml proxy error:", err);
    return NextResponse.json({ error: err.message ?? "Error descargando el XML del CFDI" }, { status: 502 });
  }
}
