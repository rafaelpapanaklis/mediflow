import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { leerCuentaDelPlan } from "@/lib/treatments/cobro.server";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ id: string }> }

/**
 * GET /api/treatments/[id]/cuenta — la cuenta del plan (ws1-t12 · P6): total, facturado, pagado
 * (anticipo incluido: es un pago), saldo, lo que falta por facturar y sus notas. Es lo que fue
 * `pagosDelPlan` (commit 36c1cbf5), ahora sobre la nota ligada al plan. NO va en el PDF del plan
 * (decisión del gerente, t8): es para la tarjeta del plan en la ficha.
 *
 * Permisos: `treatments.view` + `billing.view` (es dinero). Tenant y paciente: los de la sesión.
 * La ficha no acota al doctor a sus planes, y esto tampoco (como el PDF).
 */
export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const denied = denyIfMissingPermission(ctx, "treatments.view") ?? denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const plan = await prisma.treatmentPlan.findFirst({ where: { id: params.id, clinicId: ctx.clinicId }, select: { id: true, patientId: true } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;

  const cuenta = await leerCuentaDelPlan({ clinicId: ctx.clinicId, planId: plan.id });
  if (!cuenta) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  return NextResponse.json(cuenta);
}
