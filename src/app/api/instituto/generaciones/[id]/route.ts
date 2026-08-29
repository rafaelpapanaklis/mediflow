import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduCohort } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/generaciones/[id] — nombre, fechas y el interruptor
 * isActive ("cerrar" / "reabrir").
 *
 * El PROGRAMA de una generación no se puede cambiar aquí a propósito: los
 * alumnos ya inscritos quedarían en una especialidad que no cursaron, y esa
 * corrección no se hace moviendo la generación entera sino cambiando de
 * generación a cada alumno.
 *
 * Tampoco hay DELETE: se cierra, no se borra (ver el PATCH de programas).
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("padron.manage");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduCohort(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/generaciones/[id]");
  }
}
