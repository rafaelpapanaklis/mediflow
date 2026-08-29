import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduFeeSchedule } from "@/lib/edu/tarifas";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/tarifarios/[id] — nombre, clave, regla, marca de
 * predeterminada, orden y alta/baja de una lista de precios.
 *
 * Marcar una lista como predeterminada apaga la marca en las demás, y lo
 * mismo con la regla automática — las dos cosas dentro de la MISMA
 * transacción, para que no exista un instante con dos listas
 * predeterminadas y un cobro en medio.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const updated = await updateEduFeeSchedule(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/tarifarios/[id]");
  }
}
