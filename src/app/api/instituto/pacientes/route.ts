import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { parseEduPatientFilters } from "@/lib/edu/pacientes-core";
import { createEduPatient, listEduPatients } from "@/lib/edu/pacientes";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes — los pacientes que le tocan a quien pregunta.
 *
 * 🔴 El institutionId sale de la sesión, NUNCA de la query. Lo único que se
 * lee de la URL son los filtros (?estado=&origen=&q=), y
 * `parseEduPatientFilters` descarta cualquier otra cosa que venga ahí.
 *
 * El recorte (alumno → los suyos; docente → los de sus alumnos VIGENTES;
 * caja y dirección → todos) lo aplica `listEduPatients` por dentro con el
 * helper de visibilidad: este endpoint no puede pedir "todos" ni aunque
 * quisiera, porque el alcance no es un parámetro.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const page = await listEduPatients(g.ctx, parseEduPatientFilters(params));
    return NextResponse.json({ rows: page.rows, truncated: page.truncated });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes");
  }
}

/**
 * POST /api/instituto/pacientes — registra a un paciente.
 *
 * 🔴 El ORIGEN (cuál alumno lo trajo) solo se guarda si quien registra
 * tiene "pacientes.origen". Que el campo venga en el body no basta: ese
 * dato decide el precio en la Ola 5, así que se ignora en silencio para
 * quien no puede ponerlo — y queda registrado quién lo puso.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("pacientes.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const canSetOrigin = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "pacientes.origen",
    );
    const created = await createEduPatient(g.ctx, body, { canSetOrigin });
    return NextResponse.json({ ok: true, id: created.id, folio: created.folio }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes");
  }
}
