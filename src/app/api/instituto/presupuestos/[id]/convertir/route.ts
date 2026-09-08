import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduCampusForCharge } from "@/lib/edu/campus-core";
import { convertirEduQuote } from "@/lib/edu/presupuestos";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * POST — CONVIERTE un presupuesto ACEPTADO en cobro (y, si se pide, en un
 * plan de pagos sobre ese mismo cobro).
 *
 * 🔴 IDEMPOTENTE POR COLUMNA, no por clave del cliente: la llave es
 * `EduQuote.chargeId`. Si ya está llena, esta ruta devuelve el cobro que
 * ya existe con `duplicado: true` y no emite un segundo. Un presupuesto
 * de $18,000 convertido dos veces son dos cobros que hay que cancelar
 * delante del paciente.
 *
 * 🔴 LA SEDE la pone el servidor (`eduCampusForCharge`), NUNCA el body:
 * es el mismo camino que emitir un cobro a mano, porque es exactamente lo
 * que esto hace. Con varias sedes y ninguna elegida se rebota con el
 * motivo escrito, igual que en Caja.
 *
 * Permiso: `caja.charge`. Sin key nueva — quien cobra es quien convierte.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const sede = eduCampusForCharge(await getEduCampusScope(g.ctx));
    if (!sede.ok && sede.reason) {
      return NextResponse.json({ error: sede.reason }, { status: 409 });
    }
    const r = await convertirEduQuote(
      g.ctx,
      params.id,
      body,
      { campusId: sede.campusId, timeZone: g.ctx.institution.timezone },
      eduAuditRequestMeta(request),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/presupuestos/${params.id}/convertir`);
  }
}
