import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduRubric } from "@/lib/edu/rubricas";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/rubricas/[id] — editar, reordenar o desactivar.
 *
 * 🔴 Una rúbrica NO SE BORRA: se desactiva (`isActive: false`). Hay
 * calificaciones colgando de ella y borrarla se las llevaría por delante
 * — el Cascade del schema existe para poder borrar un instituto entero,
 * no para que el panel tire un criterio de evaluación con todo lo que se
 * midió con él.
 *
 * ⚠️ Cambiar los criterios NO recalcula lo ya calificado, y es a
 * propósito: cada calificación guarda el nombre del criterio, su peso y la
 * escala CONGELADOS. Un 8 puesto en octubre sobre 10 tiene que seguir
 * leyéndose 8/10 aunque la escuela pase la rúbrica a 100 en noviembre.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("rubricas.manage");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduRubric(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/rubricas/[id]");
  }
}
