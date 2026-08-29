import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { setEduPatientOrigin } from "@/lib/edu/pacientes";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/pacientes/[id]/origen — CUÁL alumno trajo al paciente.
 *
 * Endpoint aparte y permiso aparte ("pacientes.origen", que por defecto solo
 * tienen Caja y Dirección) porque no es un campo más de la ficha: en la Ola
 * 5 decide el precio. Se guarda además QUIÉN lo marcó y CUÁNDO — si un día
 * no cuadra una cuenta, hay que poder preguntarlo.
 *
 * Mandar `referredByStudentId: null` BORRA el origen, y borra con él las
 * marcas de quién y cuándo: guardar "lo quitó fulano" sin origen sería un
 * dato sin dueño.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.origen");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const updated = await setEduPatientOrigin(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/pacientes/[id]/origen");
  }
}
