import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { cerrarPlan, type ResultadoCierre } from "@/lib/treatments/cerrar-plan.server";
import { motivoDeCierre } from "@/lib/treatments/cerrar-plan";
import { cuentaDeUnPlanParaLaFicha } from "@/lib/treatments/cuenta-para-la-ficha.server";

export const dynamic = "force-dynamic";

interface Params { params: Promise<{ id: string }> }

/**
 * POST /api/treatments/[id]/cerrar — «Cerrar plan» (plan abandonado; decisión de Rafael, 26-oct-2026).
 * Cuerpo: `{ motivo }` (obligatorio, va a la bitácora).
 *
 * La nota del plan se queda en lo HECHO: lo no hecho sale de la nota y sus filas se cancelan (nada se
 * borra de la base). Lo pagado de más queda como saldo a favor del paciente; devolverlo en efectivo es
 * aparte (Reembolsar, a mano). El plan pasa a Abandonado. Ver `lib/treatments/cerrar-plan.server.ts`.
 *
 * Permisos: `treatments.edit` (es el plan) + `billing.edit` (cambia su nota). El doctor, solo sus
 * planes (como PATCH). Tenant y paciente: los de la sesión. 409 `nota_timbrada` si una nota con algo
 * por hacer ya está timbrada entera: se ajusta en Facturación.
 */
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const denied = denyIfMissingPermission(ctx, "treatments.edit") ?? denyIfMissingPermission(ctx, "billing.edit");
  if (denied) return denied;
  if (!esIdDeLaBase(params.id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const body = await req.json().catch(() => null);
  const motivo = motivoDeCierre(body?.motivo);
  if (!motivo) return NextResponse.json({ error: "Escribe el motivo del cierre (al menos 3 letras).", code: "sin_motivo" }, { status: 400 });

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, doctorId: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const r = await cerrarPlan({ clinicId: ctx.clinicId, planId: plan.id, userId: ctx.userId, motivo });
  if (!r.ok) {
    // `strict: false` no estrecha la unión por `ok`: se nombra el lado del fallo.
    const fallo = r as Extract<ResultadoCierre, { ok: false }>;
    if (fallo.codigo === "nota_timbrada") {
      return NextResponse.json(
        {
          code: "nota_timbrada",
          error: `La nota ${(fallo.folios ?? []).join(", ")} ya está timbrada entera: sus conceptos no se cambian aquí. Ajústala en Facturación y vuelve a cerrar el plan.`,
          folios: fallo.folios ?? [],
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  }
  revalidateAfter("treatments");
  revalidateAfter("invoices");
  // v14 (QA de Claude): la cuenta del plan ya cerrado va en la respuesta; la tarjeta la pinta al momento.
  // v15 (t5 de la v14, M3): solo si se pide (`conCuenta: true`), igual que en «Hecho».
  const cuenta = body?.conCuenta !== true || denyIfMissingPermission(ctx, "billing.view") || denyIfMissingPermission(ctx, "treatments.view")
    ? null
    : await cuentaDeUnPlanParaLaFicha(ctx.clinicId, plan.id);
  return NextResponse.json(cuenta ? { ...r, cuenta } : r);
}
