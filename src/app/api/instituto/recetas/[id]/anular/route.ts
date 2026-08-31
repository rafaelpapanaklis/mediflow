import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { voidEduReceta } from "@/lib/edu/recetas";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/recetas/[id]/anular — anular una EXPEDIDA.
 *
 * Exige "recetas.void" (DOCENTE y DIRECCIÓN). Lleva motivo obligatorio y
 * deja constancia de quién y cuándo; NUNCA borra la fila: el papel ya
 * salió de la escuela con una cédula encima y el PDF de la anulada sigue
 * saliendo, marcado, para poder enseñar la constancia.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.void");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await voidEduReceta(g.ctx, params.id, { reason: body.reason });
    return NextResponse.json({ ok: true, id: out.id });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/recetas/[id]/anular");
  }
}
