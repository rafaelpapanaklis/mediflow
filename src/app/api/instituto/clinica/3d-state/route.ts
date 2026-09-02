import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduCampusScope } from "@/lib/edu/campus";
import { getEduPlanoEstado } from "@/lib/edu/plano";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/clinica/3d-state?sede=<id> — EL PISO DE UNA SEDE, AHORA.
 *
 * Es la ruta que el mundo 3D consulta en bucle (cada 20 s) y la que pinta
 * la tarjeta que se abre al clicar una figura. Devuelve TRES cosas de una
 * sola lectura:
 *   · `chairs`  — el estado por sillón en la forma que entiende el visor
 *     del dental (`Chair3DState[]`, mismo nombre de campo que su payload);
 *   · `board`   — el tablero completo (tarjetas con folio, caso, docente…)
 *     y el HORARIO de hoy sillón por sillón, que es lo que se lee debajo
 *     del plano y lo que se enseña en el respaldo de celular;
 *   · de qué sede es y cuándo se armó.
 *
 * 🔴 UNA sola consulta para las tres. El visor recibe cada payload y se lo
 * pasa a la pantalla (prop `host.onState`), así que el plano y lo que se
 * lee al lado son SIEMPRE la misma foto — y no hay dos sondeos contra las
 * mismas tablas cada veinte segundos.
 *
 * 🔴 LAS DOS CERRADURAS, LAS MISMAS DEL TABLERO:
 *  1. el PERMISO — `clinica.view`. Ni CAJA ni el ALUMNO lo llevan.
 *  2. el ALCANCE — `getEduPlanoEstado` pasa por `eduLiveFloorVisibility`
 *     (visibility.ts, el punto único) y lanza 403 si devuelve "none".
 *     Ésta es la que cierra el caso de que alguien le encienda la casilla a
 *     un alumno desde la pantalla de permisos.
 *
 * Un endpoint que se consulta cada veinte segundos es exactamente el que
 * alguien deja sin guard "porque solo devuelve colores". Estos colores
 * dicen qué paciente está sentado en cada unidad de la escuela.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("clinica.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const pedida = url.searchParams.get("sede");
    // `undefined` (y no `null`) cuando no viene: así getEduCampusScope lee
    // la cookie en vez de forzar el consolidado.
    const scope = await getEduCampusScope(g.ctx, pedida ?? undefined);
    // Un plano es de UNA sede: aquí no existe la vista consolidada. Sin
    // sede elegida manda la primera a la que esa persona entra.
    const campusId = scope.activeId ?? scope.options[0]?.id ?? "";

    const estado = await getEduPlanoEstado({ ...g.ctx, campusIds: scope.campusIds }, campusId);
    return NextResponse.json(estado, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/clinica/3d-state");
  }
}
