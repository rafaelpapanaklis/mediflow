import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduProcedure, listEduProcedures } from "@/lib/edu/tarifas";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/procedimientos — el catálogo.
 *
 * 🔴 El institutionId sale de la sesión, NUNCA de la query. Lo único que se
 * lee de la URL es `?activos=1`.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("tarifarios.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const soloActivos = url.searchParams.get("activos") === "1";
    const rows = await listEduProcedures(g.ctx, { soloActivos });
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/procedimientos");
  }
}

/** POST — da de alta un procedimiento. Sin precio: el precio es de la LISTA. */
export async function POST(request: Request) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const created = await createEduProcedure(g.ctx, body);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/procedimientos");
  }
}
