import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduFeeSchedule, getEduTarifario } from "@/lib/edu/tarifas";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/tarifarios — la tabla comparativa completa: N listas
 * de precios × M procedimientos, con el precio de cada celda.
 *
 * 🔴 Aquí NO hay un solo precio calculado en el navegador. La pantalla
 * pinta lo que devuelve esto y nada más.
 */
export async function GET() {
  const g = await eduApiGuard("tarifarios.view");
  if ("response" in g) return g.response;

  try {
    const tarifario = await getEduTarifario(g.ctx);
    return NextResponse.json(tarifario);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/tarifarios");
  }
}

/**
 * POST — crea una lista de precios.
 *
 * 🔴 Son N listas, no dos. El instituto arranca con "Público general" y
 * "Paciente de alumno" y mañana agrega convenios, personal y campañas sin
 * tocar una línea de código: una lista nueva es un INSERT.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const created = await createEduFeeSchedule(g.ctx, body);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/tarifarios");
  }
}
