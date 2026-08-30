import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { parseEduStudentStatus } from "@/lib/edu/padron-core";
import { parseEduSemaforo } from "@/lib/edu/evaluacion-core";
import { getEduBitacora, listEduEvaluacion } from "@/lib/edu/evaluacion";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/evaluacion — el avance de los alumnos que me tocan.
 *
 * Con `?alumno=` devuelve la BITÁCORA de uno solo.
 *
 * 🔴 El ALUMNO también entra aquí, y ve UNA fila: la suya. No hay una
 * pantalla ni un endpoint aparte para él — lo recorta el alcance
 * (visibility.ts, recurso "cases"), igual que la bandeja de
 * autorizaciones de la Ola 4. Un alumno que pregunta por el id de un
 * compañero recibe null, exactamente igual que si ese alumno no existiera.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("evaluacion.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const tz = g.ctx.institution.timezone;

    const studentId = eduCleanId(url.searchParams.get("alumno"));
    if (studentId) {
      const page = await getEduBitacora(g.ctx, studentId, tz);
      if (!page) {
        return NextResponse.json({ error: "Ese alumno no es de este instituto." }, { status: 404 });
      }
      return NextResponse.json(page);
    }

    const page = await listEduEvaluacion(g.ctx, {
      programId: eduCleanId(url.searchParams.get("especialidad")),
      cohortId: eduCleanId(url.searchParams.get("generacion")),
      status: parseEduStudentStatus(url.searchParams.get("estado")),
      estado: parseEduSemaforo(url.searchParams.get("semaforo")),
    });
    return NextResponse.json({ rows: page.rows, truncated: page.truncated });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/evaluacion");
  }
}
