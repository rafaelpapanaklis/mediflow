import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { cambiarEstadoEduPlan } from "@/lib/edu/plan-tratamiento";

export const dynamic = "force-dynamic";

/**
 * PATCH — cambia el ESTADO de un plan (pausar, terminar, abandonar).
 *
 * ⚠️ La carpeta se llama `planes-tratamiento` y no `planes` porque
 * `/api/instituto/caja/planes` ya existe y es OTRA cosa: los planes de
 * PAGO a meses. Dos rutas con el mismo nombre para dos conceptos
 * distintos es cómo se llega a que alguien cancele el equivocado.
 *
 * 🔴 Las transiciones válidas son un DATO (`EDU_PLAN_TRANSITIONS`), y un
 * plan cerrado NO se reabre: se abre otro. Reabrirlo dejaría un `closedAt`
 * mintiendo.
 *
 * 🔴 `updateMany` con el estado LEÍDO en el `where` y 409 si `count === 0`:
 * si alguien lo cambió entre la lectura y la escritura, no se pisa su
 * decisión.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await cambiarEstadoEduPlan(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `PATCH /api/instituto/planes-tratamiento/${params.id}`);
  }
}
