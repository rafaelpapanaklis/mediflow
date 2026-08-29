import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { endEduSupervisorAssignment } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/supervision/[id] — cierra una asignación.
 *
 * Escribe endsAt = ahora. NO borra la fila, y por eso el verbo es PATCH y
 * no DELETE: "quitar el docente" en la pantalla significa "ya no lo
 * supervisa DESDE HOY", no "nunca lo supervisó". Toda la razón de que esta
 * tabla tenga vigencia es poder contestar la segunda pregunta.
 *
 * No lee cuerpo: la fecha de cierre la pone el servidor. Si la pusiera el
 * cliente, se podrían cerrar asignaciones en el pasado y reescribir quién
 * supervisaba cuando ocurrió algo.
 */
export async function PATCH(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("supervision.assign");
  if ("response" in g) return g.response;

  try {
    const updated = await endEduSupervisorAssignment(g.ctx, params.id);
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/supervision/[id]");
  }
}
