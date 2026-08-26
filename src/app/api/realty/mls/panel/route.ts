import { NextResponse } from "next/server";
import { getMlsDashboard } from "@/lib/realty/mls";
import { gateMls, mlsApiError } from "../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/realty/mls/panel — el tablero de "Mis colaboraciones".
 *
 * Las cuatro listas de la pestaña E en una sola llamada: lo que comparto,
 * lo que tomé, los acuerdos y las comisiones por cobrar. Va junto y no en
 * cuatro rutas porque la pantalla las pinta a la vez y partirlas serían
 * cuatro viajes para pintar un tablero.
 *
 * Todo lo que sale de aquí es MÍO o es de una relación en la que mi cuenta
 * es una de las dos partes. Los datos de la contraparte que viajan son los
 * de `RealtyMlsAgencyDTO` —nombre, slug, ciudad, logo, teléfono y correo
 * DEL NEGOCIO— y ni un campo más: sin id, sin plan, sin cupos.
 */
export async function GET() {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await getMlsDashboard(gate.ctx));
  } catch (e) {
    return mlsApiError("panel:GET", e);
  }
}
