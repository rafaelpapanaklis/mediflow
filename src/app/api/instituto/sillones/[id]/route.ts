import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduChair } from "@/lib/edu/sillones";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/sillones/[id] — nombre, número, orden y alta/baja.
 *
 * ⚠️ Desactivar un sillón NO cancela sus citas ni las mueve: sería decidir
 * por la escuela dónde va a sentar a doce pacientes. Lo saca de los
 * desplegables de alta y ya; las citas agendadas se siguen viendo y se
 * reagendan a mano. La pantalla avisa cuántas hay antes de desactivar.
 *
 * Un sillón no se BORRA (el Cascade se llevaría su historia de citas), por
 * eso este archivo no tiene un handler DELETE.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("sillones.manage");
  if ("response" in g) return g.response;

  try {
    const updated = await updateEduChair(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/sillones/[id]");
  }
}
