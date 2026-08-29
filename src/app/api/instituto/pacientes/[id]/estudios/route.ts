import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { listEduPatientStudies } from "@/lib/edu/estudios";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/estudios — radiografías, tomografías,
 * fotos y PDFs del paciente, cada uno con su URL FIRMADA recién generada.
 *
 * La URL nunca se guarda en la base: caduca. Se firma al leer, y por eso
 * esta ruta es force-dynamic — cachearla serviría enlaces muertos.
 *
 * 🔴 CAJA NO VE ESTUDIOS. Igual que el odontograma: la tabla cuelga del
 * paciente, la lectura va con el alcance del recurso "cases".
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.view");
  if ("response" in g) return g.response;

  try {
    const paciente = await getEduClinicalPatient(g.ctx, params.id);
    if (!paciente) {
      return NextResponse.json(
        { error: "Ese paciente no existe o su expediente no te toca." },
        { status: 404 },
      );
    }
    const rows = await listEduPatientStudies(g.ctx, paciente.id, g.ctx.institution.timezone);
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/estudios");
  }
}
