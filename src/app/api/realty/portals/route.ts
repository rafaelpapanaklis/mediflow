import { NextResponse, type NextRequest } from "next/server";
import { getPortalMatrix, getPortalsOverview } from "@/lib/realty/portals";
import { requirePortalsAccess, serverError } from "@/app/api/realty/portals/_server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/realty/portals
 *   ?vista=panorama  → destinos, cupos y URLs del feed (default)
 *   ?vista=matriz    → la matriz inmueble × destino
 *   &q=              → busca por título, folio, colonia o ciudad
 *
 * El accountId sale de la sesión. Ni se lee ni se acepta del query: un
 * accountId que llegue del cliente es una fuga esperando a que alguien lo
 * pruebe.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePortalsAccess();
  if (guard instanceof NextResponse) return guard;

  try {
    const params = new URL(req.url).searchParams;
    const vista = params.get("vista") ?? "panorama";

    if (vista === "matriz") {
      const matrix = await getPortalMatrix(guard.accountId, {
        q: params.get("q") ?? undefined,
        limit: Number(params.get("limite")) || undefined,
      });
      return NextResponse.json(matrix);
    }

    const overview = await getPortalsOverview(guard.accountId);
    return NextResponse.json(overview);
  } catch (err) {
    return serverError("GET", err);
  }
}
