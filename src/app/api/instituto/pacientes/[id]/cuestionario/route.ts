import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { createEduCuestionario, listEduCuestionarios } from "@/lib/edu/cuestionario";

export const dynamic = "force-dynamic";

/**
 * EL CUESTIONARIO DE SALUD VERSIONADO (fila 7 del informe ws2-t1).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PERMISOS: `expediente.view` para leer y `expediente.write` para
 * guardar. Ninguna key nueva — el cuestionario de salud ES la historia
 * clínica, y quien escribe una nota puede capturarla. Es el mismo criterio
 * con el que la Ola B resolvió las fotos.
 *
 * 🔴 EL ALCANCE ES EL CLÍNICO ("cases"), no el de "patients": para CAJA,
 * "patients" es `all` y "cases" es `none`. Con el alcance equivocado, el
 * mostrador leería los antecedentes médicos de toda la escuela.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET — el historial (20 versiones), más reciente primero. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.view");
  if ("response" in g) return g.response;
  try {
    const r = await listEduCuestionarios(g.ctx, params.id, eduAuditRequestMeta(request));
    return NextResponse.json(r);
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/pacientes/${params.id}/cuestionario`);
  }
}

/**
 * POST — guarda una VERSIÓN NUEVA y mezcla lo clínico en la ficha.
 *
 * Nunca un PUT ni un PATCH, y eso es toda la pieza: la pregunta clínica no
 * es «¿qué contesta?», es «¿qué contestó ANTES de la extracción?», y un
 * update la deja sin respuesta para siempre.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await createEduCuestionario(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/pacientes/${params.id}/cuestionario`);
  }
}
