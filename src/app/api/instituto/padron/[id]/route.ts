import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduStudent } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/padron/[id] — matrícula, semestre, estado, programa
 * y generación de un alumno.
 *
 * El id de la URL NO basta para tocar la fila: `updateEduStudent` la busca
 * con `{ id, institutionId }` y contesta 404 si no es de este instituto.
 * Un id ajeno se ve exactamente igual que uno inexistente, que es lo que
 * debe pasar.
 *
 * Dar de baja es un cambio de `status`, nunca un DELETE: el padrón es un
 * registro histórico y los actos clínicos de ese alumno siguieron
 * ocurriendo. Por eso este archivo no tiene un handler DELETE.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("padron.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const updated = await updateEduStudent(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/padron/[id]");
  }
}
