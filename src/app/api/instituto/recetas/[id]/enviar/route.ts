import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { sendEduRecetaToApproval } from "@/lib/edu/recetas";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/recetas/[id]/enviar — mandarla a autorización.
 *
 * Exige "recetas.propose". Es el "Enviar a autorización" de la receta:
 * BORRADOR → PENDIENTE y una fila de EduCaseApproval (etapa RECETA) en la
 * bandeja del docente — EL MECANISMO DE LA OLA 4, no uno nuevo. Desde ese
 * momento no se imprime ni se entrega hasta que el docente la firme.
 *
 * ⚠️ No pasa por el POST genérico de /api/instituto/autorizaciones a
 * propósito: mandar una receta también la MUEVE, y las dos escrituras van
 * en una sola transacción (src/lib/edu/recetas.ts).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.propose");
  if ("response" in g) return g.response;

  try {
    const out = await sendEduRecetaToApproval(g.ctx, params.id);
    return NextResponse.json({ ok: true, id: out.id, approvalId: out.approvalId });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/recetas/[id]/enviar");
  }
}
