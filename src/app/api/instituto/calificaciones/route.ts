import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { createEduGrade, listEduCaseGrades, listEduStudentGrades } from "@/lib/edu/rubricas";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/calificaciones?caso= | ?alumno=
 *
 * Exige "evaluacion.view", que TIENEN LOS CUATRO ROLES menos caja —
 * incluido el ALUMNO. Ver su propia calificación y los comentarios que le
 * escribió el docente es la mitad de para qué existe esta ola: una
 * evaluación que el alumno no puede leer no enseña nada.
 *
 * 🔴 Lo que cada quien ve lo decide el ALCANCE, no este endpoint: las
 * calificaciones se leen a través del caso, y el caso se busca con el
 * `where` del recurso "cases". El alumno alcanza los suyos, el docente los
 * de sus alumnos VIGENTES, caja ninguno.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("evaluacion.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const tz = g.ctx.institution.timezone;
    const caseId = eduCleanId(url.searchParams.get("caso"));
    if (caseId) {
      return NextResponse.json({ rows: await listEduCaseGrades(g.ctx, caseId, tz) });
    }
    const studentId = eduCleanId(url.searchParams.get("alumno"));
    if (studentId) {
      return NextResponse.json({ rows: await listEduStudentGrades(g.ctx, studentId, tz) });
    }
    return NextResponse.json(
      { error: "Dime de qué caso (?caso=) o de qué alumno (?alumno=)." },
      { status: 400 },
    );
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/calificaciones");
  }
}

/**
 * POST /api/instituto/calificaciones — calificar, o CORREGIR.
 *
 * Exige "evaluacion.grade", que el ALUMNO no tiene: ve su calificación y
 * no la escribe. Y aunque alguien se la encendiera por override, dentro
 * está la regla que no depende de ningún permiso — nadie puede calificar su
 * propio caso.
 *
 * 🔴 CORREGIR ES INSERTAR, NO EDITAR. Se manda `correctsId` con la
 * calificación anterior y queda una fila nueva que la referencia: las dos
 * con su autor y su hora, la vigente es la que nadie corrige. No hay PATCH
 * en esta ruta, y esa ausencia es la regla — la misma que la nota firmada
 * del expediente.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("evaluacion.grade");
  if ("response" in g) return g.response;

  try {
    const created = await createEduGrade(g.ctx, await eduReadJson(request));
    return NextResponse.json(
      { ok: true, id: created.id, finalScoreX100: created.finalScoreX100 },
      { status: 201 },
    );
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/calificaciones");
  }
}
