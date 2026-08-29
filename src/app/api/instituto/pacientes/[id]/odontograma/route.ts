import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import {
  listEduOdontogram,
  setEduOdontogramFinding,
  setEduOdontogramNote,
} from "@/lib/edu/odontograma";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/odontograma — los hallazgos del
 * paciente, cada uno con quién lo marcó y cuándo.
 *
 * 🔴 CAJA NO VE EL ODONTOGRAMA. La tabla cuelga del PACIENTE (la boca es
 * una sola) pero se LEE con el alcance del recurso "cases", que para caja
 * es "none". Con el alcance de "patients" —el que "parece" natural porque
 * es de donde cuelga— caja vería el odontograma de la escuela entera.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("odontograma.view");
  if ("response" in g) return g.response;

  try {
    const paciente = await getEduClinicalPatient(g.ctx, params.id);
    if (!paciente) {
      return NextResponse.json(
        { error: "Ese paciente no existe o su expediente no te toca." },
        { status: 404 },
      );
    }
    const rows = await listEduOdontogram(g.ctx, paciente.id, g.ctx.institution.timezone);
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/odontograma");
  }
}

/**
 * PUT /api/instituto/pacientes/[id]/odontograma — marca o quita UN
 * hallazgo. Body: { tooth, surface, condition, present }.
 *
 * Un solo verbo para poner y quitar (`present`) y no un PUT + un DELETE: el
 * odontograma se usa como interruptor —clic pone, clic quita— y partirlo en
 * dos obligaba a mandar los identificadores en el cuerpo de un DELETE, que
 * es de esas cosas que funcionan hasta que un proxy decide que no.
 *
 * El `condition` se valida CONTRA EL CATÁLOGO compartido de hallazgos: sin
 * eso, el odontograma es un campo de texto libre con forma de dibujo.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("odontograma.edit");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await setEduOdontogramFinding(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/pacientes/[id]/odontograma");
  }
}

/**
 * PATCH /api/instituto/pacientes/[id]/odontograma — la NOTA de un diente.
 * Body: { tooth, notes }. Vaciar el texto borra la nota.
 *
 * Va por su propio verbo porque no es un hallazgo: se guarda en la misma
 * tabla con una key RESERVADA ("__nota__") que el saneo del PUT rechaza a
 * propósito, para que el pincel no pueda pisar ni borrar una nota.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("odontograma.edit");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await setEduOdontogramNote(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/pacientes/[id]/odontograma");
  }
}
