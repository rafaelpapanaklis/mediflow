import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { listEduTransferableCases, transferEduCase } from "@/lib/edu/traspasos";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/traspasos?alumno= — qué casos hay que repartir.
 *
 * Los casos ABIERTOS de un alumno, con cuántas citas futuras trae cada uno
 * — que es el dato que decide el orden en que se reparten: un caso con
 * cita el martes no puede esperar.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("traspaso.manage");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const studentId = eduCleanId(url.searchParams.get("alumno"));
    if (!studentId) {
      return NextResponse.json({ error: "Dime de qué alumno (?alumno=)." }, { status: 400 });
    }
    return NextResponse.json({ rows: await listEduTransferableCases(g.ctx, studentId) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/traspasos");
  }
}

/**
 * POST /api/instituto/traspasos — traspasa UN caso.
 *
 * 🔴 Esto no reasigna: CIERRA el caso viejo como TRANSFERRED y ABRE uno
 * nuevo que apunta a él. El expediente, los estudios y las calificaciones
 * del viejo se quedan donde ocurrieron.
 *
 * 🔴 Y el alumno saliente PIERDE el acceso al paciente en el mismo acto.
 * Eso no se decide aquí sino en src/lib/edu/visibility.ts, que es el punto
 * único: si se decidiera en esta ruta, el segundo camino que traspase un
 * caso nacería sin ello y funcionaría perfectamente — para el alumno que
 * ya se fue.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("traspaso.manage");
  if ("response" in g) return g.response;

  try {
    const done = await transferEduCase(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, ...done }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/traspasos");
  }
}
