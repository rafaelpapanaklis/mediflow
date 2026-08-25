import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import {
  RealtyAdminError,
  parseRealtyPlanConfigPatch,
  updateRealtyPlanConfig,
} from "@/lib/realty/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/inmobiliarias/planes/[planId] — EDITAR UN PLAN.
 *
 * Esta ruta es la que hace verdad la regla dura del vertical: cambiar un
 * precio es EDITAR UNA FILA de `realty_plan_configs`, no tocar código ni
 * volver a desplegar. La pantalla del cliente lee de ahí, y el checkout
 * resuelve el precio de Stripe por `lookup_key` derivada del importe — así
 * que subir el precio aquí crea automáticamente el precio nuevo en Stripe la
 * próxima vez que alguien contrate.
 *
 * Se valida con LISTA BLANCA de campos (nunca un spread del body).
 * La auditoría va por `logAdminGlobalEvent` y no por RealtyAdminAction porque
 * esto es configuración de PLATAFORMA: no tiene accountId, y esa tabla lo
 * exige como FK.
 */
export async function PATCH(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const patch = parseRealtyPlanConfigPatch(body as Record<string, unknown>);
    const { planId, before, after } = await updateRealtyPlanConfig(params.planId, patch);

    logAdminGlobalEvent({
      req,
      admin: { id: session.user.id, email: session.user.email },
      entity: "realty-plan-config",
      entityId: planId,
      action: "update",
      before,
      after,
    });

    return NextResponse.json({ ok: true, plan: after });
  } catch (err) {
    if (err instanceof RealtyAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/admin/inmobiliarias/planes/[planId] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
