import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduDirFiltrosDeQuery, parseEduDirDetalle } from "@/lib/edu/direccion-core";
import { eduDirContextFrom, getEduDireccionDetalle } from "@/lib/edu/direccion";
import { getEduCampusScope } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/direccion/detalle?que=<lista> — LO QUE HAY DETRÁS DE
 * UNA CIFRA.
 *
 * 🔴 ES LA MITAD DE LA PANTALLA. Un tablero de números que no se pueden
 * abrir no sirve para decidir: "hay 7 casos esperando firma" no es
 * accionable, "estos siete, y el más viejo lleva dos horas" sí. Cada cifra
 * del panel apunta a una key de este endpoint.
 *
 * 🔴 SE PIDE CUANDO SE ABRE, NO ANTES. Si el panel cargara las quince
 * listas por si acaso, sería una pantalla de ocho segundos — y un tablero
 * que tarda ocho segundos deja de abrirse a la semana.
 *
 * 🔴 MISMOS FILTROS Y MISMO ALCANCE QUE LA PANTALLA. Un endpoint de
 * detalle es justo donde se olvida el recorte ("total, es una listita"), y
 * por eso no consulta por su cuenta: `getEduDireccionDetalle` arma sus
 * `where` con visibility.ts y con la misma ventana de periodo.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("direccion.panel");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const key = parseEduDirDetalle(url.searchParams.get("que"));
    if (!key) {
      return NextResponse.json(
        { error: "Esa lista no existe. Ábrela tocando una cifra del tablero." },
        { status: 400 },
      );
    }

    // 🔴 Ola 11 · LA MISMA SEDE QUE LA CIFRA. Una lista que trae las filas
    // de los dos campus debajo de una cifra de uno solo no cuadra, y quien
    // la abre cuenta a mano y le sale otro numero.
    const page = await getEduDireccionDetalle(
      eduDirContextFrom(g.ctx, await getEduCampusScope(g.ctx)),
      key,
      eduDirFiltrosDeQuery(url.searchParams),
    );
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/direccion/detalle");
  }
}
