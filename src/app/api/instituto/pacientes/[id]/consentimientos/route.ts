import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduConsent, listEduPatientConsents } from "@/lib/edu/consentimientos";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/consentimientos — las cartas del
 * paciente.
 *
 * 🔴 CAJA SÍ LEE ESTO, y es la única cosa del expediente que lee. No es un
 * agujero: es el contrato de la ola. La carta se imprime, se entrega en el
 * mostrador y se recoge firmada, así que recepción tiene que poder verla.
 * Lo que NO ve caja sigue siendo todo lo demás — notas, odontograma,
 * estudios— porque eso se lee con el alcance del expediente ("cases") y
 * esto con el del paciente ("patients"). La razón larga está en la
 * cabecera de src/lib/edu/consentimientos.ts.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("consentimientos.view");
  if ("response" in g) return g.response;

  try {
    const rows = await listEduPatientConsents(g.ctx, params.id, g.ctx.institution.timezone);
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/consentimientos");
  }
}

/**
 * POST /api/instituto/pacientes/[id]/consentimientos — emite una carta.
 *
 * CAJA no tiene este permiso: recepción entrega la carta, no la emite.
 * Quien la emite es quien va a tratar (el alumno), su docente o la
 * dirección.
 *
 * 🔴 El ALUMNO y el DOCENTE de la carta salen del CASO, nunca del cuerpo:
 * si vinieran del cliente, se podría emitir un consentimiento diciendo que
 * responde un docente que no ha visto al paciente.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("consentimientos.create");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const created = await createEduConsent(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/consentimientos");
  }
}
