import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduCase } from "@/lib/edu/casos";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/casos/[id] — estado, supervisor y notas.
 *
 * 🔴 El ALUMNO del caso NO se cambia aquí. Cambiar de alumno es
 * TRANSFERRED + un caso nuevo: si se pudiera reescribir el `studentId`, se
 * borraría la respuesta a "¿quién lo atendía en marzo?", que es justo la
 * pregunta que se hace cuando algo sale mal. Misma regla que la supervisión
 * de la Ola 1A, que se cierra en vez de editarse.
 *
 * `closedAt` se deriva del estado; no se captura. Y el caso se busca dentro
 * del ALCANCE: uno que no le toca a quien pregunta contesta 404, igual que
 * uno que no existe.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("casos.assign");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduCase(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/casos/[id]");
  }
}
