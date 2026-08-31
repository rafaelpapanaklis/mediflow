import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import {
  getEduPatientTaxProfile,
  saveEduPatientTaxProfile,
} from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * GET — los datos fiscales guardados de un paciente, para prellenar el
 * modal de facturación. `null` (con 200) cuando todavía no tiene: no es un
 * error, es lo normal la primera vez que ese paciente pide factura.
 */
export async function GET(
  _request: Request,
  { params }: { params: { patientId: string } },
) {
  const g = await eduApiGuard("facturacion.view");
  if ("response" in g) return g.response;

  try {
    const receptor = await getEduPatientTaxProfile(g.ctx, params.patientId);
    return NextResponse.json({ receptor });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/facturacion/receptores/[patientId]");
  }
}

/**
 * PUT — captura o corrige los datos fiscales del paciente.
 *
 * Exige "facturacion.emit": capturar el RFC de alguien es parte de
 * facturarle. Quien solo puede MIRAR facturas no escribe datos fiscales.
 *
 * ⚠️ Corregirlos NO reescribe ninguna factura ya emitida: el receptor se
 * congela en la factura al timbrar. Un CFDI dice a nombre de quién se
 * emitió, no a nombre de quién se emitiría hoy.
 */
export async function PUT(
  request: Request,
  { params }: { params: { patientId: string } },
) {
  const g = await eduApiGuard("facturacion.emit");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const receptor = await saveEduPatientTaxProfile(g.ctx, params.patientId, body);
    return NextResponse.json({ ok: true, receptor });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/facturacion/receptores/[patientId]");
  }
}
