import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { assignEduSupervisor } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/supervision — asigna un docente a un alumno.
 *
 * Exige "supervision.assign". Repartir alumnos es administrar la escuela:
 * un docente que pudiera asignarse alumnos a sí mismo se estaría dando
 * acceso a fichas que no le tocan, porque el padrón del docente se recorta
 * justamente por sus asignaciones vigentes.
 *
 * Si `isPrimary` es true, el titular anterior se CIERRA (endsAt = ahora) en
 * vez de borrarse: dentro de un año hay que poder contestar quién
 * supervisaba a este alumno el día que pasó algo.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("supervision.assign");
  if ("response" in g) return g.response;

  try {
    const created = await assignEduSupervisor(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/supervision");
  }
}
