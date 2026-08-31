import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { transferEduCasesBatch } from "@/lib/edu/traspasos";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/traspasos/lote — traspasar EN LOTE.
 *
 * Al cerrar una generación son decenas de casos, y hacerlos de uno en uno
 * es la diferencia entre repartirlos y no repartirlos.
 *
 * 🔴 CASO POR CASO Y NO TODO-O-NADA. Si el lote entero se cayera porque
 * uno de los cuarenta ya estaba cerrado, quien cierra la generación
 * tendría que ir a buscar cuál y volver a empezar; a la tercera vez lo
 * hace uno por uno y esta pantalla no sirvió para nada. Devuelve los que
 * pasaron y los que no, CON EL MOTIVO de cada fallo, y la pantalla los
 * pinta.
 *
 * Devuelve 200 aunque falle alguno: el lote se procesó. El 207 de HTTP
 * diría lo mismo con más precisión y menos clientes que lo entienden.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("traspaso.manage");
  if ("response" in g) return g.response;

  try {
    const res = await transferEduCasesBatch(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, traspasados: res.ok, fallidos: res.fallidos });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/traspasos/lote");
  }
}
