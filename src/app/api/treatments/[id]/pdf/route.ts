import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { buildPlanTratamientoPdf } from "@/lib/treatments/plan-pdf.server";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ id: string }> }

/**
 * GET /api/treatments/[id]/pdf — «Descargar PDF» del plan de tratamiento, con precios (ws1-t12).
 *
 * Quién: el que ya ve el plan en la ficha del paciente. `treatments.view` (los cinco roles lo
 * tienen de fábrica) + que pueda ver a ese paciente (`assertPatientVisible`). La ficha no acota
 * al doctor a sus planes —ve todos los del paciente, con su costo—, así que aquí tampoco: el PDF
 * no enseña nada que la ficha no enseñe ya. La única parte extra, lo pagado y el saldo, sale
 * solo con `billing.view` (lo mismo que abre la pestaña Facturación).
 *
 * Tenant: `clinicId` SIEMPRE de la sesión. Un plan de otra clínica es 404, igual que uno que
 * no existe. Los ids importados no son uuid: se validan con `esIdDeLaBase` (uuid, cuid o siembra).
 */
export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const denied = denyIfMissingPermission(ctx, "treatments.view");
  if (denied) return denied;

  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, patientId: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;

  const out = await buildPlanTratamientoPdf({
    planId: plan.id,
    clinicId: ctx.clinicId,
    verPagos: hasPermission({ role: ctx.role, permissionsOverride: ctx.permissionsOverride ?? [] }, "billing.view"),
  });
  if (!out) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  // Bitácora (NOM-024 §6.3.5): un PDF es una copia que sale del sistema. Con action "view"
  // no cuenta como movimiento del paciente (`esAccionQueNoEsMovimiento`), pero queda quién y cuándo.
  await logAudit({
    patientId: out.patientId,
    texto: `Descargó el PDF del plan de tratamiento «${out.planNombre}»`,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "treatment",
    entityId: plan.id,
    action: "view",
    ...extractAuditMeta(req),
  });

  return new NextResponse(out.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${out.fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
