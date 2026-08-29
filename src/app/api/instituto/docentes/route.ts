import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduCurrentAssignments, listEduTeachers } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/docentes — los docentes del instituto y su carga de HOY.
 *
 * `?detalle=1` agrega las asignaciones vigentes (quién lleva a quién). Se
 * pide aparte porque la lista simple es lo que necesita un desplegable y no
 * tiene por qué arrastrar el nombre de cada alumno.
 *
 * Las dos consultas comparten un MISMO `now`: con dos `new Date()`
 * distintos, el conteo y el detalle podrían discrepar sobre una asignación
 * que se cerró justo en medio.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("docentes.view");
  if ("response" in g) return g.response;

  try {
    const detalle = new URL(request.url).searchParams.get("detalle") === "1";
    const now = new Date();
    const rows = await listEduTeachers(g.ctx, now);
    if (!detalle) return NextResponse.json({ rows });
    return NextResponse.json({
      rows,
      assignments: await listEduCurrentAssignments(g.ctx, now),
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/docentes");
  }
}
