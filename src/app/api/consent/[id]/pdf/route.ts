// GET /api/consent/[id]/pdf — la carta en PDF, generada on-demand.
//
// Mismo patrón que /api/quotes/[id]/pdf: runtime nodejs (el render de
// @react-pdf no corre en edge), force-dynamic y Content-Disposition inline para
// que se abra en el visor del navegador en vez de descargarse. El PDF NO se
// guarda en ninguna parte: se arma cada vez con las firmas que haya en ese
// momento.

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildConsentPdf } from "@/lib/consent/consent-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.view");
  if (denied) return denied;

  // El PDF lleva el nombre del paciente y su historia: se resuelve el
  // consentimiento a su patientId y se verifica la visibilidad antes de armarlo.
  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { patientId: true },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(form.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const out = await buildConsentPdf(params.id, ctx.clinicId);
  if (!out) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${out.fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
