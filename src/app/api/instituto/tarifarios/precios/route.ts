import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { getEduProcedurePrecioRastro, setEduProcedurePrices } from "@/lib/edu/tarifas";

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
 *
 * 🔴 Ola C · H-76 · Y VACIAR EL CAMPO YA NO BORRA LA FILA: es una BAJA
 * LÓGICA (`deletedAt`), así que el rastro de quién puso ese precio y
 * cuánto valía sobrevive. Se lee con el GET de abajo.
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

/**
 * GET ?procedimiento=<id> — 🔴 H-76 · QUIÉN PUSO CADA PRECIO Y CUÁNDO.
 *
 * «Nadie sabe quién cambió un precio ni cuándo, y borrar un precio es un
 * DELETE físico. En febrero la resina costaba $800 y hoy $1,200: no se
 * puede contestar quién lo subió.»
 *
 * ⚠️ Y lo que devuelve NO es un historial completo: es UNA fila por lista
 * con el último autor, la fecha del último cambio de IMPORTE
 * (`priceSetAt`, aparte de `updatedAt` a propósito) y, si el precio se
 * retiró, quién lo retiró. Contesta «¿quién puso el que está hoy?» y
 * «¿quién quitó éste?»; «¿cuánto costaba en febrero?» pide una tabla de
 * movimientos que esta ola no crea, y eso queda escrito en el reporte en
 * vez de simularse aquí con datos que no existen.
 *
 * Permiso `tarifarios.view`: leer quién puso un precio es leer el
 * tarifario, no gestionarlo.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("tarifarios.view");
  if ("response" in g) return g.response;

  try {
    const procedureId = new URL(request.url).searchParams.get("procedimiento") ?? "";
    return NextResponse.json({ rows: await getEduProcedurePrecioRastro(g.ctx, procedureId) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/tarifarios/precios");
  }
}
