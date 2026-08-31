import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { cancelEduInvoice } from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * POST — cancela una factura ante Facturapi (y ante el SAT, si el
 * instituto está EN VIVO), con su motivo del catálogo y con el texto de
 * quien la cancela.
 *
 * 🔴 Key PROPIA ("facturacion.cancel"), distinta de la de emitir. Un CFDI
 * timbrado ante el SAT no se deshace: la cancelación es un trámite fiscal
 * con motivo, plazo y —desde 2022— posibilidad de que el receptor la
 * rechace. Quien cobra en el mostrador emite todo el día; cancelar es otra
 * cosa y por eso es otra casilla.
 *
 * 🔴 NO BORRA NADA. La fila se queda con su UUID, su XML y sus conceptos;
 * lo único que cambia es que el cobro vuelve a quedar libre para
 * facturarse (`activeChargeId` a NULL).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("facturacion.cancel");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const invoice = await cancelEduInvoice(g.ctx, params.id, {
      motive: body.motive,
      reason: body.reason,
    });
    return NextResponse.json({ ok: true, invoice });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/facturacion/[id]/cancelar");
  }
}
