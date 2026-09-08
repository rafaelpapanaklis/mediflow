import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { listEduFusionCandidatos, mergeEduPatients } from "@/lib/edu/fusion";

export const dynamic = "force-dynamic";

/**
 * LA FUSIÓN DE DUPLICADOS (H-05).
 *
 * 🔴 MUEVE, NO BORRA. El perdedor queda con `mergedIntoId` apuntando al
 * ganador, en INACTIVE, y sus ocho colecciones se reasignan en UNA
 * transacción. Su fila sobrevive: ese folio se imprimió en un
 * consentimiento y está escrito en una hoja de papel en un archivero.
 *
 * 🔴 Las mismas dos llaves que el resto de ARCO (`pacientes.manage` +
 * `direccion.panel`), comprobadas en la capa de datos.
 */

/** GET — los CANDIDATOS a duplicado de esta ficha. Sugiere; no decide. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json({ rows: await listEduFusionCandidatos(g.ctx, params.id) });
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/pacientes/${params.id}/fusion`);
  }
}

/**
 * POST — FUSIONA. La ficha de la URL es la GANADORA; en el cuerpo viaja el
 * `perdedorId`.
 *
 * Cuál gana lo decide quien fusiona y no el sistema: cuál de las dos tiene
 * el folio bueno y la historia más larga es un juicio humano.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await mergeEduPatients(
      g.ctx,
      { ganadorId: params.id, perdedorId: body.perdedorId, reason: body.reason },
      eduAuditRequestMeta(request),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/pacientes/${params.id}/fusion`);
  }
}
