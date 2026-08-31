import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduDirFiltrosDeQuery } from "@/lib/edu/direccion-core";
import { eduDirContextFrom, getEduDireccionAhora } from "@/lib/edu/direccion";
import { getEduCampusScope } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/direccion/ahora — LA CLÍNICA EN ESTE MOMENTO.
 *
 * Es el único endpoint del vertical que se consulta SOLO: la pantalla lo
 * vuelve a pedir cada pocos segundos para que la rejilla de sillones no se
 * quede pegada mientras el tablero está proyectado en una junta.
 *
 * 🔴 Por eso es un endpoint APARTE y no el panel entero. Refrescar el
 * tablero completo cada 25 segundos volvería a cruzar casi todas las
 * tablas del vertical —casos, cobros, pagos, requisitos— para actualizar
 * cuatro cifras que caben en una consulta de citas de hoy. Lo que cambia
 * en el piso clínico cambia aquí; lo del periodo no cambia solo.
 *
 * 🔴 EXIGE "direccion.panel" igual que la pantalla. Un endpoint que se
 * consulta cada 25 segundos es exactamente el que alguien deja sin guard
 * "porque solo devuelve un resumen" — y este resumen dice qué paciente
 * está en cada sillón de la escuela.
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
    const ahora = await getEduDireccionAhora(
      eduDirContextFrom(g.ctx, await getEduCampusScope(g.ctx)),
      eduDirFiltrosDeQuery(url.searchParams),
    );
    return NextResponse.json(ahora, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/direccion/ahora");
  }
}
