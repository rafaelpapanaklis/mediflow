import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { parseEduPadronFilters } from "@/lib/edu/padron-core";
import { createEduStudent, listEduStudents } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/padron — los alumnos que le tocan a quien pregunta.
 *
 * 🔴 El institutionId sale de la sesión, NUNCA de la query. Lo único que se
 * lee de la URL son los filtros (?programa=&generacion=&estado=&q=), y
 * `parseEduPadronFilters` descarta cualquier otra cosa que venga ahí.
 *
 * El recorte del DOCENTE (solo sus alumnos vigentes) lo aplica
 * `listEduStudents` por dentro: este endpoint no puede pedir "todos" ni
 * aunque quisiera, porque el alcance no es un parámetro.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("padron.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const filters = parseEduPadronFilters(params);
    const page = await listEduStudents(g.ctx, filters);
    return NextResponse.json({
      rows: page.rows,
      truncated: page.truncated,
      scope: page.scope.kind,
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/padron");
  }
}

/**
 * POST /api/instituto/padron — inscribe a alguien que YA tiene cuenta.
 *
 * Esta ola no crea logins: inscribir es colgarle matrícula, programa y
 * generación a un EduUser con rol ALUMNO que todavía no tiene ficha.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("padron.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const created = await createEduStudent(g.ctx, body);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/padron");
  }
}
