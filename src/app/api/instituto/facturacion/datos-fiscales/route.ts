import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import {
  getEduFiscalConfig,
  getEduFiscalReadiness,
  saveEduFiscalConfig,
} from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * GET — los datos fiscales del instituto y qué le falta para timbrar ante
 * el SAT (eso se lo pregunta a Facturapi, que es quien lo sabe).
 *
 * 🔴 La respuesta NUNCA trae la Live Secret Key ni el id de la
 * organización: son secretos de servidor y esta respuesta la lee un
 * navegador. La forma que sale es EduFiscalConfigView, que solo tiene
 * `hasOrg: boolean`.
 */
export async function GET() {
  const g = await eduApiGuard("facturacion.config");
  if ("response" in g) return g.response;

  try {
    const [config, readiness] = await Promise.all([
      getEduFiscalConfig(g.ctx),
      getEduFiscalReadiness(g.ctx),
    ]);
    return NextResponse.json({ config, readiness });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/facturacion/datos-fiscales");
  }
}

/**
 * PUT — guarda los datos fiscales y sincroniza la organización de
 * Facturapi.
 *
 * 🔴 Aquí es donde se decide si el instituto timbra EN PRUEBAS o EN VIVO, y
 * por eso pide su propia key ("facturacion.config") y no la de emitir. El
 * salto a EN VIVO no se guarda si Facturapi no confirma que la
 * organización ya puede emitir ante el SAT: encenderlo a ciegas es
 * descubrir que no se puede con el paciente en el mostrador.
 */
export async function PUT(request: Request) {
  const g = await eduApiGuard("facturacion.config");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const { config, aviso } = await saveEduFiscalConfig(g.ctx, body);
    return NextResponse.json({ ok: true, config, aviso });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/facturacion/datos-fiscales");
  }
}
