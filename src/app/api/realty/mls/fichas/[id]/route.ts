import { NextResponse } from "next/server";
import { getBolsaListing } from "@/lib/realty/mls";
import { gateMls, mlsApiError, mlsNotFound } from "../../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/realty/mls/fichas/[id] — UNA ficha de la bolsa.
 *
 * 🔴 Es la ruta que un atacante probaría con ids al azar, así que
 * `getBolsaListing` vuelve a comprobar TODO en cada llamada y no se fía de
 * que la ficha viniera de un listado anterior: que la ficha siga activa,
 * que el inmueble siga siendo de quien la comparte, que esa cuenta siga
 * viva, que el inmueble no sea mío y que su estatus siga vendible.
 *
 * Los tres "no" —no existe, ya no se comparte, es de otra cuenta— dan el
 * MISMO 404 con el MISMO texto. Distinguirlos convertiría esta ruta en un
 * oráculo de qué ids existen.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const ficha = await getBolsaListing(gate.ctx, params.id);
    if (!ficha) return mlsNotFound();
    return NextResponse.json({ ficha });
  } catch (e) {
    return mlsApiError("fichas/[id]:GET", e);
  }
}
