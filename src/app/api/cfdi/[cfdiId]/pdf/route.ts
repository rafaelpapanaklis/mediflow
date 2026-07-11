import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOrgApiKey, downloadInvoiceFile } from "@/lib/facturapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cfdi/[cfdiId]/pdf — proxy del PDF del CFDI desde Facturapi.
// Admin, aislado por clinicId. La org key nunca llega al cliente.
export async function GET(req: NextRequest, { params }: { params: { cfdiId: string } }) {
  const rl = rateLimit(req, 30, 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const record = await prisma.cfdiRecord.findFirst({
    where:  { id: params.cfdiId, clinicId: ctx!.clinicId },
    select: { facturapiId: true, uuid: true, clinic: { select: { facturApiOrgId: true } } },
  });
  if (!record?.facturapiId || !record.clinic?.facturApiOrgId) {
    return NextResponse.json({ error: "CFDI no encontrado" }, { status: 404 });
  }

  try {
    const orgApiKey = await getOrgApiKey(record.clinic.facturApiOrgId);
    const buf = await downloadInvoiceFile(orgApiKey, record.facturapiId, "pdf");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `inline; filename="CFDI-${record.uuid}.pdf"`,
        "Cache-Control":       "private, no-store",
      },
    });
  } catch (err: any) {
    console.error("CFDI pdf proxy error:", err);
    return NextResponse.json({ error: err.message ?? "Error descargando el PDF del CFDI" }, { status: 502 });
  }
}
