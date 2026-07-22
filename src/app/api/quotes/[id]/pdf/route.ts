import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildQuotePdf } from "@/lib/quotes/quote-pdf";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/** GET /api/quotes/[id]/pdf — descarga el PDF del presupuesto (clínica de la sesión). */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Visibilidad: el PDF renderiza el nombre del paciente. Resolvemos el quote a su
  // patientId y verificamos que este usuario pueda verlo antes de generarlo.
  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { patientId: true },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
  if (quote.patientId) {
    const denied = await assertPatientVisible(quote.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  const out = await buildQuotePdf(params.id, ctx.clinicId);
  if (!out) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${out.fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
