import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { presupuestoDesdeElPlan } from "@/lib/treatments/presentar.server";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ id: string }> }

/**
 * POST /api/treatments/[id]/presentar — «Guardar y presentar al paciente» de la ventana del plan
 * (ws1-t12 · fase 2). El plan ES el presupuesto (decisión de Rafael, 20-oct-2026): de sus filas sale
 * el presupuesto y se presenta con la liga de firma de siempre, sin abrir el editor. Es lo mismo que
 * `POST …/presupuesto {presentar:true}` (P4), con la respuesta que espera la ventana
 * (`RUTA_PRESENTAR` en plan-tratamiento-rediseno/guardar-plan.ts): `{ quoteId, folio, enlaceFirma }`.
 *
 * Sin cuerpo. Idempotente: presentar otra vez un plan sin firmar reescribe el MISMO presupuesto (misma
 * liga y folio); uno ya aceptado no se toca (`aviso: "ya_aceptado"`).
 *
 * Permisos: `treatments.view` (se lee el plan) + `billing.create` y `billing.edit` (se crea y se
 * presenta un presupuesto), los mismos que `…/presupuesto`. El doctor, solo sus planes. Tenant y
 * paciente: los de la sesión.
 */
export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const denied =
    denyIfMissingPermission(ctx, "treatments.view") ??
    denyIfMissingPermission(ctx, "billing.create") ??
    denyIfMissingPermission(ctx, "billing.edit");
  if (denied) return denied;
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, ...(ctx.isDoctor ? { doctorId: ctx.userId } : {}) },
    select: { id: true, patientId: true, name: true, description: true, totalCost: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;

  const r = await presupuestoDesdeElPlan({ clinicId: ctx.clinicId, userId: ctx.userId, plan, presentar: true });
  if (r.error) return NextResponse.json({ error: r.error.mensaje || "No se pudo presentar el presupuesto del plan.", quoteId: r.quote.id }, { status: r.error.http });
  revalidateAfter("treatments");
  return NextResponse.json(
    {
      quoteId: r.quote.id,
      folio: r.quote.folio,
      enlaceFirma: r.quote.liga,
      presentado: r.presentado,
      regenerado: r.regenerado,
      aviso: r.aviso,
      deFilas: r.deFilas,
    },
    { status: r.already ? 200 : 201 },
  );
}
