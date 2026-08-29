import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduChair, listEduChairs } from "@/lib/edu/sillones";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/sillones — las unidades dentales del instituto.
 *
 * No pasa por el helper de visibilidad porque no hay nada que recortar: un
 * sillón es infraestructura de la escuela, no la fila de nadie. Lo que sí
 * se cierra, como siempre, es el tenant.
 */
export async function GET() {
  const g = await eduApiGuard("sillones.view");
  if ("response" in g) return g.response;

  try {
    return NextResponse.json({ rows: await listEduChairs(g.ctx) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/sillones");
  }
}

/**
 * POST /api/instituto/sillones — da de alta una unidad.
 *
 * 🔴 CUÁNTOS HAY LO DECIDE CADA INSTITUTO: no hay un número por defecto ni
 * un seed. Una escuela tiene 40 y otra tiene 6.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("sillones.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduChair(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/sillones");
  }
}
