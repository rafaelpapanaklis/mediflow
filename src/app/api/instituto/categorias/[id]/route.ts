import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { updateEduCategoria } from "@/lib/edu/categorias";

export const dynamic = "force-dynamic";

/**
 * PATCH — edita el nombre, el orden y si está activa.
 *
 * 🔴 LA CLAVE NO SE EDITA, Y ÉSE ES EL PUNTO ENTERO DE H-90: la clave es
 * lo que NO cambia cuando la dirección renombra la categoría. Si se
 * pudiera editar, renombrar volvería a romper lo que esto arregla.
 *
 * 🔴 Y NO HAY DELETE: una categoría se DESACTIVA (`isActive: false`), como
 * los sillones, las especialidades y las sedes. Desactivar la saca de los
 * selectores y deja intacto todo lo que ya apunta a ella.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await updateEduCategoria(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `PATCH /api/instituto/categorias/${params.id}`);
  }
}
