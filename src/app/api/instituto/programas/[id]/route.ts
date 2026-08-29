import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduProgram } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/programas/[id] — nombre, clave, duración y el
 * interruptor isActive.
 *
 * NO hay DELETE, y no es un olvido: la FK de alumnos y generaciones va en
 * cascada, así que borrar un programa se llevaría por delante el padrón de
 * esa especialidad. Desactivar lo saca de los desplegables de alta y deja
 * todo lo demás en su sitio, que es lo que de verdad se quiere cuando una
 * escuela deja de ofrecer una especialidad.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("padron.manage");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduProgram(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/programas/[id]");
  }
}
