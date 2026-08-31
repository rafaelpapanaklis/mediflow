import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduDirFiltrosDeQuery } from "@/lib/edu/direccion-core";
import { eduDirContextFrom, getEduDireccionPanel } from "@/lib/edu/direccion";
import { getEduCampusScope } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/direccion — el tablero del periodo, en JSON.
 *
 * La pantalla se pinta en el SERVIDOR (la página lo llama directo), así que
 * este endpoint no es lo que la carga: existe para el botón "Actualizar"
 * —volver a pedir los números sin recargar la página entera ni perder el
 * sitio donde estaba el scroll— y para que el CSV y la pantalla salgan de
 * la MISMA función. Dos caminos distintos para el mismo tablero es cómo se
 * llega a que el archivo de la acreditación diga otra cosa que la pantalla.
 *
 * 🔴 EXIGE "direccion.panel". Y `getEduDireccionPanel` vuelve a comprobar
 * el ALCANCE por dentro: con la key encendida sobre un docente, contesta
 * 403 con el motivo en vez de enseñarle medio instituto.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("direccion.panel");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    // 🔴 Ola 11 · LA SEDE. Sin esto el tablero sumaria los dos campus como
    // si fueran uno: los sillones, las citas y el dinero cuelgan de un
    // edificio, y "ocupacion promedio" cruzando el norte con el sur no es
    // un numero de ninguna de las dos sedes.
    const panel = await getEduDireccionPanel(
      eduDirContextFrom(g.ctx, await getEduCampusScope(g.ctx)),
      eduDirFiltrosDeQuery(url.searchParams),
    );
    return NextResponse.json(panel, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/direccion");
  }
}
