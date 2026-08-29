import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduProcedure } from "@/lib/edu/tarifas";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/procedimientos/[id] — nombre, clave, categoría,
 * duración, orden y alta/baja.
 *
 * Un procedimiento NO se borra: se desactiva. Los cobros que lo
 * referencian ocurrieron, y su línea guarda la descripción congelada.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const updated = await updateEduProcedure(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/procedimientos/[id]");
  }
}
