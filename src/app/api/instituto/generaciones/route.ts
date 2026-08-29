import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduCohort, listEduCohorts } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/** GET /api/instituto/generaciones — para los filtros del padrón. */
export async function GET() {
  const g = await eduApiGuard("padron.view");
  if ("response" in g) return g.response;

  try {
    return NextResponse.json({ rows: await listEduCohorts(g.ctx) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/generaciones");
  }
}

/**
 * POST /api/instituto/generaciones — una generación cuelga SIEMPRE de un
 * programa, y ese programa tiene que ser de este instituto (lo comprueba
 * createEduCohort antes de escribir).
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("padron.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduCohort(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/generaciones");
  }
}
