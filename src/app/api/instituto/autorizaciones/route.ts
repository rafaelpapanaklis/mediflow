import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import {
  getEduCaseApprovalState,
  listEduApprovalInbox,
  listEduApprovalTargets,
  requestEduApproval,
} from "@/lib/edu/autorizaciones";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/autorizaciones — la bandeja, o el estado de UN caso.
 *
 * Sin parámetros devuelve lo que está esperando firma y le toca a quien
 * pregunta (urgencias primero, después por orden de llegada). Con `?caso=`
 * devuelve las autorizaciones de ese caso, sus dos puertas y lo que se puede
 * mandar a autorizar — es lo que alimenta el "Enviar a autorización" de la
 * ficha, para no cargar los desplegables de todos los casos de un paciente
 * cada vez que alguien abre la pestaña.
 *
 * 🔴 CAJA NO VE NADA aquí aunque alguien le encienda "autorizaciones.view"
 * por error: el alcance del recurso "cases" le devuelve "none" y la
 * respuesta sale vacía. Es la misma línea del contrato que le cierra el
 * expediente, cerrada en dos sitios en vez de uno.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("autorizaciones.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const tz = g.ctx.institution.timezone;
    const caseId = eduCleanId(url.searchParams.get("caso"));

    if (caseId) {
      const [estado, targets] = await Promise.all([
        getEduCaseApprovalState(g.ctx, caseId, tz),
        listEduApprovalTargets(g.ctx, caseId, tz),
      ]);
      return NextResponse.json({ ...estado, targets });
    }

    const page = await listEduApprovalInbox(g.ctx, tz);
    return NextResponse.json({ rows: page.rows, truncated: page.truncated });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/autorizaciones");
  }
}

/**
 * POST /api/instituto/autorizaciones — "Enviar a autorización".
 *
 * Exige "autorizaciones.request", que es del ALUMNO y de la DIRECCIÓN. El
 * DOCENTE no la tiene: quien firma no pide, y ésa es la separación de
 * funciones que sostiene toda la ola.
 *
 * ⚠️ El `caseId` viene del body y NO es un agujero: `requestEduApproval` lo
 * busca dentro del ALCANCE, así que un caso de otra escuela —o de otro
 * alumno— contesta 404 igual que uno que no existe. El institutionId, ése
 * sí, sale SIEMPRE de la sesión.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("autorizaciones.request");
  if ("response" in g) return g.response;

  try {
    const created = await requestEduApproval(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/autorizaciones");
  }
}
