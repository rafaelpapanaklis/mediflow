import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { createEduPlan, listEduPlanes } from "@/lib/edu/plan-tratamiento";

export const dynamic = "force-dynamic";

/**
 * EL PLAN DE TRATAMIENTO de un paciente (fila 25 del informe ws2-t1).
 *
 * 🔴 PERMISOS: `expediente.view` / `expediente.write`. El plan es parte del
 * expediente y quien escribe la nota de una sesión es quien la hizo.
 * ALCANCE: el CLÍNICO. Caja no ve planes: cobra, no planifica actos.
 */

/** GET — los planes del paciente, con sus sesiones y su avance calculado. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.view");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json({
      rows: await listEduPlanes(g.ctx, params.id, g.ctx.institution.timezone),
    });
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/pacientes/${params.id}/plan-tratamiento`);
  }
}

/** POST — crea un plan y sus sesiones vacías de una vez. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await createEduPlan(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/pacientes/${params.id}/plan-tratamiento`);
  }
}
