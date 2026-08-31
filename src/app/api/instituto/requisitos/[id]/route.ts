import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduRequirement } from "@/lib/edu/evaluacion";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/requisitos/[id] — editar o desactivar.
 *
 * 🔴 Un requisito NO SE BORRA: se desactiva. El avance NO está guardado en
 * ningún lado (se cuenta al preguntar), así que desactivarlo no borra nada
 * de lo que el alumno hizo — deja de exigírselo, y si se vuelve a activar,
 * los casos que ya tenía vuelven a contar solos. Ésa es justamente la
 * ventaja de contar en vez de guardar un contador.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("requisitos.manage");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduRequirement(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/requisitos/[id]");
  }
}
