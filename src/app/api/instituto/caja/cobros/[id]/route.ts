import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { cancelEduCharge, getEduCharge } from "@/lib/edu/caja";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/caja/cobros/[id] — el recibo.
 *
 * Un cobro de otra escuela se ve exactamente igual que uno que no existe
 * (404): el recorte va en el `where`, no en un `if` después de leer. Un
 * 403 confirmaría que ese folio existe.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;

  try {
    // 🔴 H-63 · EL ALCANCE POR SEDE. La lista ya lo respetaba y esta
    // lectura por id no: con el id en la mano se abría el recibo de otra
    // sede entero. Mismo patrón que facturación (H-69).
    const cctx = eduWithCampus(g.ctx, await getEduCampusScope(g.ctx));
    const cobro = await getEduCharge(cctx, params.id, {
      timeZone: g.ctx.institution.timezone,
    });
    if (!cobro) {
      return NextResponse.json({ error: "Ese cobro no existe." }, { status: 404 });
    }
    return NextResponse.json({ charge: cobro });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/caja/cobros/[id]");
  }
}

/**
 * PATCH — cancela el cobro.
 *
 * Exige `caja.refund` y no `caja.charge`: anular dinero ya emitido es la
 * misma clase de acto que devolverlo, no la de cobrarlo. Y exige que no
 * haya un peso pagado — primero se devuelve, después se cancela.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.refund");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    // 🔴 H-63 · y anular tampoco se hace sobre la sede de al lado.
    const cctx = eduWithCampus(g.ctx, await getEduCampusScope(g.ctx));
    const res = await cancelEduCharge(cctx, params.id, { reason: body.reason });
    return NextResponse.json({ ok: true, id: res.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/caja/cobros/[id]");
  }
}
