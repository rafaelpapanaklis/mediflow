import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduReceta, listEduPatientRecetas } from "@/lib/edu/recetas";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/recetas — las recetas del paciente
 * (y sus casos abiertos, para el formulario de "Nueva receta").
 *
 * 🔴 CAJA NO VE NADA aquí aunque alguien le encienda "recetas.view" por
 * error: la receta se lee con el alcance CLÍNICO ("cases"), que para caja
 * es "none". Una receta es un documento clínico, no un cobro — la misma
 * línea del contrato que le cierra el expediente, cerrada en dos sitios.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.view");
  if ("response" in g) return g.response;

  try {
    const data = await listEduPatientRecetas(g.ctx, params.id, g.ctx.institution.timezone);
    return NextResponse.json(data);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/recetas");
  }
}

/**
 * POST /api/instituto/pacientes/[id]/recetas — PROPONER una receta.
 *
 * Exige "recetas.propose" (ALUMNO, DOCENTE y DIRECCIÓN). Nace en
 * BORRADOR: no está en ninguna bandeja ni produce papel hasta que se
 * manda a autorización, y no produce papel HASTA que el docente la firma.
 *
 * ⚠️ El `caseId` viene del body y NO es un agujero: createEduReceta lo
 * busca dentro del ALCANCE, así que un caso de otra escuela —o de otro
 * alumno— contesta 404 igual que uno que no existe. El institutionId,
 * ése sí, sale SIEMPRE de la sesión.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.propose");
  if ("response" in g) return g.response;

  try {
    const created = await createEduReceta(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/recetas");
  }
}
