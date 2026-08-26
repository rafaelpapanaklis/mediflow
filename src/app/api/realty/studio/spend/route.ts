import { NextRequest, NextResponse } from "next/server";
import { isStudioGateOk, openStudioGate, studioServerError } from "../_server";
import { getStudioSpend, listStudioItems } from "@/lib/realty/studio/spend";

export const dynamic = "force-dynamic";

/**
 * E. El consumo del día y del mes, más lo que se ha generado.
 *
 * Con `?propertyId=` el historial se recorta a UN inmueble. El GASTO no: el
 * tope es de la CUENTA y por día, y enseñarlo recortado por inmueble haría
 * creer que cada ficha tiene su propio presupuesto.
 *
 * No hace falta comprobar que el inmueble sea de esta cuenta: el filtro se
 * aplica DENTRO de las filas de este accountId, así que un id ajeno no
 * devuelve nada en vez de devolver lo de alguien más.
 */
export async function GET(req: NextRequest) {
  const gate = await openStudioGate();
  if (!isStudioGateOk(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const propertyId = req.nextUrl.searchParams.get("propertyId") || null;
    const [spend, items] = await Promise.all([
      getStudioSpend(ctx.accountId, ctx.account.timezone),
      listStudioItems(ctx.accountId, 40, propertyId),
    ]);
    return NextResponse.json({ spend, items, propertyId });
  } catch (err) {
    return studioServerError("spend", err);
  }
}
