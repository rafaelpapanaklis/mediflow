import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { revokeEduConsent } from "@/lib/edu/consentimientos";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/consentimientos/[id]/revocar — deja constancia de
 * que el paciente retiró su consentimiento.
 *
 * 🔴 NO BORRA NADA. La carta sigue existiendo, con su firma y su fecha, y
 * queda marcada como revocada con quién lo registró, cuándo y por qué. Un
 * consentimiento que desaparece es un consentimiento que nadie puede
 * demostrar que existió — ni a favor ni en contra.
 *
 * ⚠️ El ALUMNO tiene este permiso, y es deliberado. El paciente se
 * retracta en el sillón, delante de él. El estado peligroso no es una
 * revocación registrada de más: es un consentimiento VIVO para un
 * procedimiento que el paciente ya rechazó, porque el alumno tuvo que ir a
 * buscar a su docente para poder anotarlo. Lo que puede revocar está
 * recortado a SUS pacientes por el alcance, como todo lo demás.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("consentimientos.revoke");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await revokeEduConsent(g.ctx, params.id, body);
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/consentimientos/[id]/revocar");
  }
}
