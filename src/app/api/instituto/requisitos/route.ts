import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { createEduRequirement, listEduRequirements } from "@/lib/edu/evaluacion";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/requisitos — el plan de estudios, en números.
 *
 * Exige "requisitos.manage" por lo mismo que las rúbricas: la pantalla que
 * los lista es la que los captura. Lo que el ALUMNO ve —su avance contra
 * estos requisitos— no sale de aquí sino de /instituto/evaluacion, que
 * exige "evaluacion.view" y va recortado a lo suyo.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("requisitos.manage");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const rows = await listEduRequirements(g.ctx, {
      onlyActive: url.searchParams.get("activos") === "1",
      programId: eduCleanId(url.searchParams.get("especialidad")),
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/requisitos");
  }
}

/**
 * POST /api/instituto/requisitos — captura un requisito.
 *
 * Lo captura la DIRECCIÓN: cada escuela tiene su plan de estudios y el
 * producto no trae uno de fábrica. Un catálogo de requisitos "sugeridos"
 * sería el plan de otra escuela con el nombre de ésta.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("requisitos.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduRequirement(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/requisitos");
  }
}
