import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduCobrosFacturables } from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * GET — los cobros que se pueden facturar, para el buscador del modal.
 *
 * Devuelve TAMBIÉN los que ya tienen factura viva, con su folio al lado.
 * Esconderlos dejaría a quien busca "C-0042" mirando una lista vacía sin
 * saber si se equivocó de folio o si ya estaba facturado.
 *
 * Exige "facturacion.emit" y no "facturacion.view": esta lista solo sirve
 * para elegir qué timbrar.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("facturacion.emit");
  if ("response" in g) return g.response;

  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const rows = await listEduCobrosFacturables(g.ctx, q);
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/facturacion/cobros");
  }
}
