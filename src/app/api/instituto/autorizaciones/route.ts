import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import {
  getEduCaseApprovalState,
  listEduApprovalHistory,
  listEduApprovalInbox,
  listEduApprovalTargets,
  requestEduApproval,
} from "@/lib/edu/autorizaciones";
import { parseEduApprovalHistoryFilters } from "@/lib/edu/autorizaciones-core";

export const dynamic = "force-dynamic";

/**
 * Los `searchParams` que Next le pasa a una page, armados desde una URL.
 *
 * El parseo de los filtros es UNO SOLO (`parseEduApprovalHistoryFilters`,
 * en el módulo puro) y lo comparten la pantalla y este endpoint: dos
 * lectores de la misma query string terminan discrepando, y el día que
 * discrepan el enlace que alguien pegó en un correo deja de significar lo
 * que enseñaba.
 */
function queryToParams(url: URL): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  // `forEach` y no `for…of entries()`: el target de TypeScript del repo no
  // deja recorrer un iterador sin `--downlevelIteration`, y el build lo
  // corta con un error de tipos.
  url.searchParams.forEach((v, k) => {
    // Repetido en la URL (`?estado=A&estado=B`), manda el primero: es lo
    // mismo que hace `firstParam` del parseo.
    if (out[k] === undefined) out[k] = v;
  });
  return out;
}

/**
 * GET /api/instituto/autorizaciones — la bandeja, el HISTORIAL, o UN caso.
 *
 * Sin parámetros devuelve lo que está esperando firma y le toca a quien
 * pregunta (urgencias primero, después por orden de llegada). Con `?caso=`
 * devuelve las autorizaciones de ese caso, sus dos puertas y lo que se puede
 * mandar a autorizar — es lo que alimenta el "Enviar a autorización" de la
 * ficha, para no cargar los desplegables de todos los casos de un paciente
 * cada vez que alguien abre la pestaña. Con `?historial=1` devuelve lo que
 * YA se decidió, con los filtros de la propia query string.
 *
 * 🔴 CAJA NO VE NADA aquí aunque alguien le encienda "autorizaciones.view"
 * por error: el alcance del recurso "cases" le devuelve "none" y la
 * respuesta sale vacía. Es la misma línea del contrato que le cierra el
 * expediente, cerrada en dos sitios en vez de uno.
 *
 * 🔴 Y NINGÚN FILTRO ES UNA LLAVE. `?estudiante=<id ajeno>` no contesta 403
 * ni "no autorizado": entra al `where` DENTRO del recorte y la consulta
 * devuelve vacío. Un 403 con pista le confirmaría a quien lo teclea que ese
 * estudiante existe, que es media fuga.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("autorizaciones.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const tz = g.ctx.institution.timezone;
    const caseId = eduCleanId(url.searchParams.get("caso"));

    if (url.searchParams.get("historial") === "1") {
      const page = await listEduApprovalHistory(
        g.ctx,
        parseEduApprovalHistoryFilters(queryToParams(url)),
        tz,
      );
      return NextResponse.json({ rows: page.rows, truncated: page.truncated });
    }

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
