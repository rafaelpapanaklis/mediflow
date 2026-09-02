import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { getEduCampusScope } from "@/lib/edu/campus";
import { getEduPlanoSede, saveEduPlano } from "@/lib/edu/plano";

export const dynamic = "force-dynamic";

/**
 * EL PLANO DE UNA SEDE — leerlo y guardarlo.
 *
 *   GET  /api/instituto/clinica/plano?sede=<id>   → clinica.view
 *   PUT  /api/instituto/clinica/plano             → clinica.edit
 *
 * 🔴 DOS KEYS Y NO UNA, y es la línea de esta ola: mirar el piso lo hace
 * todo el que entra a la clínica en vivo (dirección y docentes); ACOMODARLO
 * cambia el plano que ven los otros treinta docentes y los ciento veinte
 * estudiantes de la escuela. `clinica.edit` la lleva DIRECCION y nadie más
 * por default.
 *
 * 🔴 Y LAS DOS PASAN ADEMÁS POR EL ALCANCE (`eduLiveFloorVisibility`, en
 * visibility.ts, el punto único): ALUMNO y CAJA reciben 403 aunque alguien
 * les encienda la casilla. Es el mismo doble candado del tablero en vivo, y
 * está en `src/lib/edu/plano.ts` para que no dependa de que un endpoint
 * futuro se acuerde.
 *
 * ⚠️ La SEDE nunca se toma "porque vino en el body": se resuelve contra
 * `getEduCampusScope`, que valida el id contra el ACCESO de la persona. Un
 * id de una sede ajena —o de otra escuela— devuelve 403/404, no un plano.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("clinica.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const pedida = url.searchParams.get("sede");
    // `undefined` (y no `null`) cuando no viene: es lo que hace que
    // getEduCampusScope lea la cookie en vez de forzar el consolidado.
    const scope = await getEduCampusScope(g.ctx, pedida ?? undefined);
    // Un plano es de UNA sede: la consolidada no existe aquí. Sin sede
    // elegida manda la primera a la que esa persona entra.
    const campusId = scope.activeId ?? scope.options[0]?.id ?? "";

    const sede = await getEduPlanoSede({ ...g.ctx, campusIds: scope.campusIds }, campusId);
    return NextResponse.json(sede, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/clinica/plano");
  }
}

export async function PUT(request: Request) {
  const g = await eduApiGuard("clinica.edit");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const campusId = typeof body.campusId === "string" ? body.campusId : "";
    // El acceso a esa sede se comprueba dos veces y a propósito: aquí, para
    // que `campusIds` viaje recortado, y dentro de `saveEduPlano` contra la
    // fila real de la sede.
    const scope = await getEduCampusScope(g.ctx, campusId || undefined);

    const sede = await saveEduPlano(
      { ...g.ctx, campusIds: scope.campusIds, eduUserId: g.ctx.eduUserId },
      {
        campusId: campusId || scope.activeId || scope.options[0]?.id || "",
        elements: body.elements,
        metadata: body.metadata,
      },
    );
    return NextResponse.json(sede, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/clinica/plano");
  }
}
