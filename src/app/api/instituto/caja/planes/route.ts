import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { parseEduPlanFilters } from "@/lib/edu/pagos-core";
import { listEduPlanes } from "@/lib/edu/pagos";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/caja/planes — los planes de pago del instituto.
 *
 * `caja.view` abre la puerta y el alcance del dinero (visibility.ts,
 * recurso "charges") decide las filas: para DOCENTE y ALUMNO no hay
 * ninguna, ni con el permiso encendido a mano.
 *
 * Los estados VENCIDA de cada mensualidad viajan YA derivados contra el
 * hoy del instituto: la pantalla pinta, no decide.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const page = await listEduPlanes(
      g.ctx,
      g.ctx.institution.timezone,
      parseEduPlanFilters(params),
    );
    return NextResponse.json(page);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/caja/planes");
  }
}
