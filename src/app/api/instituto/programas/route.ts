import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduProgram, listEduPrograms } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/programas — las especialidades del instituto.
 *
 * Basta con "padron.view": los programas son el esqueleto de los filtros
 * del padrón, y quien puede ver el padrón necesita poder leerlos para
 * filtrar. CREARLOS es otra cosa y pide "padron.manage".
 */
export async function GET() {
  const g = await eduApiGuard("padron.view");
  if ("response" in g) return g.response;

  try {
    return NextResponse.json({ rows: await listEduPrograms(g.ctx) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/programas");
  }
}

export async function POST(request: Request) {
  const g = await eduApiGuard("padron.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduProgram(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/programas");
  }
}
