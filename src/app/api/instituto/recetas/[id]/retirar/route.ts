import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { withdrawEduReceta } from "@/lib/edu/recetas";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/recetas/[id]/retirar — sacarla de la bandeja.
 *
 * PENDIENTE → BORRADOR, y solo QUIEN LA PROPUSO. Es lo que le faltaba al
 * alumno (H-24): podía mandar una receta a firmar y no podía deshacerlo,
 * ni siquiera habiéndose equivocado de paciente, porque `recetas.void` no
 * es suya y aun teniéndola solo abre lo EXPEDIDA.
 *
 * Exige "recetas.propose", la key de quien la armó: no hace falta ninguna
 * key nueva. Y no es "anular": una receta sin firmar nunca fue documento —
 * la razón larga está en `withdrawEduReceta` (src/lib/edu/recetas.ts).
 *
 * Una EXPEDIDA jamás pasa por aquí: ésa se anula con motivo, y la anula
 * quien tiene la cédula.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.propose");
  if ("response" in g) return g.response;

  try {
    const out = await withdrawEduReceta(g.ctx, params.id);
    return NextResponse.json({ ok: true, id: out.id });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/recetas/[id]/retirar");
  }
}
