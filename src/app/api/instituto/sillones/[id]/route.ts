import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduChair } from "@/lib/edu/sillones";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";

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
    // 🔴 Ola 11 · el ctx que llega al módulo de datos lleva LA SEDE. Sin
    // esto, el endpoint devolvería (o tocaría) los sillones de todas las
    // sedes aunque quien pregunta solo entre a una — y la pantalla, que sí
    // filtra, no se enteraría de la diferencia.
    const cctx = eduWithCampus(g.ctx, await getEduCampusScope(g.ctx));
    const updated = await updateEduChair(cctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/sillones/[id]");
  }
}
