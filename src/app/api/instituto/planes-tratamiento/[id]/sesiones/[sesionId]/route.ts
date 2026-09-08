import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { marcarEduPlanSesion } from "@/lib/edu/plan-tratamiento";

export const dynamic = "force-dynamic";

/**
 * PATCH — marca (o desmarca) una sesión del plan como hecha.
 *
 * `{ hecha: false }` la desmarca; sin ese campo, la marca. Es el mismo
 * gesto de ida y vuelta que una casilla, y por eso es un solo endpoint.
 *
 * 🔴 EL AVANCE NO SE GUARDA: se cuenta. La respuesta trae los KPI
 * recalculados para que la pantalla no tenga que volver a pedir la lista.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; sesionId: string } },
) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await marcarEduPlanSesion(
      g.ctx,
      params.id,
      params.sesionId,
      body,
      eduAuditRequestMeta(request),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(
      err,
      `PATCH /api/instituto/planes-tratamiento/${params.id}/sesiones/${params.sesionId}`,
    );
  }
}
