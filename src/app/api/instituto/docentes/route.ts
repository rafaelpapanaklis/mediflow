import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduCurrentAssignments, listEduTeachers } from "@/lib/edu/padron";
import { eduPadronScope } from "@/lib/edu/padron-core";

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
 *
 * 🔴 P1-4 DE LA AUDITORÍA — `?detalle=1` SE RECORTA CON EL ALCANCE DEL
 * PADRÓN, igual que la pantalla. Arreglar solo `/instituto/docentes` habría
 * sido cerrar la puerta dejando la ventana abierta: la lista nominal de los
 * alumnos de todos los colegas está a un `fetch` de distancia.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("docentes.view");
  if ("response" in g) return g.response;

  try {
    const detalle = new URL(request.url).searchParams.get("detalle") === "1";
    const now = new Date();
    const rows = await listEduTeachers(g.ctx, now);
    if (!detalle) return NextResponse.json({ rows });
    const alcance = eduPadronScope(g.ctx);
    return NextResponse.json({
      rows,
      assignments:
        alcance.kind === "all"
          ? await listEduCurrentAssignments(g.ctx, now)
          : alcance.kind === "supervised"
            ? await listEduCurrentAssignments(g.ctx, now, alcance.supervisorUserId)
            : [],
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/docentes");
  }
}
