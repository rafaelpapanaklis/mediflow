import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { createEduRubric, listEduRubrics } from "@/lib/edu/rubricas";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/rubricas — las rúbricas del instituto.
 *
 * Exige "rubricas.manage" y no una key de lectura aparte: la pantalla que
 * las lista es la misma que las edita (una lista de rúbricas que no se
 * pueden tocar no le sirve a nadie más que a quien las administra), y dos
 * interruptores para una pantalla es cómo se llega a que uno de los dos no
 * lo exija nadie.
 *
 * ⚠️ Quien CALIFICA no necesita este endpoint: la pantalla de calificar
 * recibe las rúbricas ya resueltas desde el servidor, filtradas por la
 * especialidad y el procedimiento del caso.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("rubricas.manage");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const rows = await listEduRubrics(g.ctx, {
      onlyActive: url.searchParams.get("activas") === "1",
      programId: eduCleanId(url.searchParams.get("especialidad")),
      procedureId: eduCleanId(url.searchParams.get("procedimiento")),
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/rubricas");
  }
}

/**
 * POST /api/instituto/rubricas — crea una rúbrica con sus criterios.
 *
 * 🔴 Los pesos tienen que sumar 100 y se valida AQUÍ, al guardar, no al
 * calificar: el error tiene que salirle a quien diseña la rúbrica sentado,
 * no al docente de pie con el paciente ya atendido.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("rubricas.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduRubric(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/rubricas");
  }
}
