import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
import { getEduClinicaViva } from "@/lib/edu/clinica-viva";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/clinica — EL TABLERO DEL PISO, AHORA MISMO.
 *
 * Es el segundo endpoint del vertical que se consulta SOLO, en bucle: la
 * pantalla lo vuelve a pedir cada 20 s para que la rejilla no se quede
 * pegada mientras está proyectada en la pared del piso clínico. Por eso
 * devuelve el tablero y nada más — ni pacientes, ni casos, ni dinero.
 *
 * 🔴 LAS DOS CERRADURAS, Y LAS DOS AQUÍ (no solo en la pantalla):
 *
 *  1. el PERMISO — `eduApiGuard("clinica.view")`. Ni CAJA ni el ALUMNO lo
 *     llevan por defecto, así que un GET directo con su sesión contesta
 *     403 sin tocar la base.
 *  2. el ALCANCE — `getEduClinicaViva` llama a `eduLiveFloorVisibility`
 *     (visibility.ts, el punto único) y lanza 403 si devuelve "none".
 *     Ésta es la que cierra el caso raro: alguien le enciende
 *     "clinica.view" a un alumno desde la pantalla de permisos. Sigue sin
 *     ver un sillón.
 *
 * Un endpoint que se consulta cada veinte segundos es exactamente el que
 * alguien deja sin guard "porque solo devuelve un resumen". Este resumen
 * dice qué paciente está sentado en cada unidad de la escuela.
 *
 * 🔴 Ola 11 · LA SEDE. `?sede=<id>` es el filtro de la pantalla; si no
 * viene, manda la sede elegida en la barra superior (la cookie). Los dos
 * pasan por `getEduCampusScope`, que valida contra el ACCESO de la persona:
 * un id de una sede ajena —o de otra escuela— no amplía nada, se degrada
 * solo a la vista consolidada de lo suyo.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("clinica.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    // `undefined` (y no `null`) cuando no viene: es lo que hace que
    // getEduCampusScope lea la cookie en vez de forzar el consolidado.
    const pedida = url.searchParams.get("sede");
    const sede = await getEduCampusScope(g.ctx, pedida ?? undefined);

    const board = await getEduClinicaViva(eduWithCampus(g.ctx, sede));
    return NextResponse.json(board, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/clinica");
  }
}
