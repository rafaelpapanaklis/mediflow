import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduTarifaDePaciente } from "@/lib/edu/tarifas";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/caja/tarifa?paciente=<id>
 *
 * 🔴 ÉSTE es el endpoint que hace que no haya un solo precio escrito en la
 * UI. La pantalla de caja elige un paciente y pregunta: qué lista le toca,
 * por qué, y cuánto cuesta cada procedimiento para ÉL. Todo resuelto en el
 * servidor, con el dato que decide la tarifa —quién trajo al paciente— que
 * el navegador no controla.
 *
 * Exige `caja.view` (es una lectura) y además el ALCANCE del dinero, que
 * `getEduTarifaDePaciente` comprueba por dentro: un alumno con caja.view
 * encendido por error sigue sin ver un peso.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const patientId = url.searchParams.get("paciente") ?? "";
    const tarifa = await getEduTarifaDePaciente(g.ctx, patientId);
    return NextResponse.json(tarifa);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/caja/tarifa");
  }
}
