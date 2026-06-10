import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { hasPermission } from "@/lib/auth/permissions";
import { buildPrescriptionPdf } from "@/lib/pdf/prescription-pdf";

export const dynamic = "force-dynamic";

/**
 * GET /api/prescriptions/[id]/pdf — PDF de la receta para el dashboard.
 *
 * Multi-tenant: la receta debe pertenecer a la clínica del usuario.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as Role, "prescription.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const out = await buildPrescriptionPdf(params.id, ctx.clinicId);
  if (!out) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });

  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${out.fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
