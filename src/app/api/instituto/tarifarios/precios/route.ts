import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { setEduProcedurePrices } from "@/lib/edu/tarifas";

export const dynamic = "force-dynamic";

/**
 * PUT /api/instituto/tarifarios/precios — los precios de UN procedimiento
 * en TODAS las listas, de golpe.
 *
 * Body: { procedureId, precios: [{ feeScheduleId, priceCents }] }
 * Un `priceCents` nulo o vacío BORRA el precio de esa lista: la lista deja
 * de cubrir ese procedimiento, que no es lo mismo que costar cero.
 *
 * 🔴 Esto NO reescribe cobros ya emitidos. El precio de un cobro vive
 * congelado en su línea; esta tabla decide lo que costará el PRÓXIMO.
 */
export async function PUT(request: Request) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const precios = Array.isArray(body.precios) ? body.precios : [];
    const res = await setEduProcedurePrices(g.ctx, String(body.procedureId ?? ""), precios);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/tarifarios/precios");
  }
}
