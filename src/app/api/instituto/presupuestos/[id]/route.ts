import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { cambiarEstadoEduQuote } from "@/lib/edu/presupuestos";

export const dynamic = "force-dynamic";

/**
 * PATCH — cambia el estado del presupuesto a mano (rechazar, cancelar,
 * volver a borrador).
 *
 * 🔴 UN ACEPTADO NO SE DES-ACEPTA. Lo dice la tabla de transiciones y lo
 * repite el mensaje del 409: un presupuesto aceptado que se revierte
 * dejaría el cobro que generó colgando de una aceptación que ya no existe.
 * Lo que se cancela es el cobro, en caja.
 *
 * 🔴 Y NO HAY DELETE en esta ruta. Un presupuesto rechazado no se borra:
 * la propuesta existió.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await cambiarEstadoEduQuote(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `PATCH /api/instituto/presupuestos/${params.id}`);
  }
}
