import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
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
  // ISO-03: "Ver recetas" del modal, override incluido (antes capa por rol).
  const denied = denyIfMissingPermission(ctx, "prescription.view");
  if (denied) return denied;

  // Visibilidad por paciente: el PDF renderiza el nombre del paciente. Resolvemos
  // la receta a su patientId y verificamos que este usuario pueda verlo (un staff
  // con prescription.read pero excluido de visibleUserIds no debe descargarlo).
  const rx = await prisma.prescription.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { patientId: true },
  });
  if (!rx) return NextResponse.json({ error: "Receta no encontrada" }, { status: 404 });
  if (rx.patientId) {
    const denied = await assertPatientVisible(rx.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (denied) return denied;
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
