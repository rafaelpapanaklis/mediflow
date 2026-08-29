import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId } from "@/lib/edu/agenda-core";
import {
  createEduRecord,
  getEduClinicalPatient,
  listEduPatientCaseOptions,
  listEduPatientRecords,
} from "@/lib/edu/expediente";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/expediente — las notas clínicas.
 *
 * 🔴 CAJA NO LEE EXPEDIENTES aunque alguien le encienda "expediente.view"
 * por error: el alcance del expediente es el del recurso "cases", y para
 * caja ese recurso devuelve "none". La respuesta sale vacía y con un 404
 * en el paciente — que es lo que debe verse desde fuera.
 *
 * Los casos del paciente viajan en la MISMA respuesta porque la pantalla
 * los necesita para el desplegable de "¿a qué caso va esta nota?": dos
 * viajes para abrir una pestaña se notan en el teléfono del piso clínico.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.view");
  if ("response" in g) return g.response;

  try {
    const paciente = await getEduClinicalPatient(g.ctx, params.id);
    if (!paciente) {
      return NextResponse.json(
        { error: "Ese paciente no existe o su expediente no te toca." },
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const [rows, cases] = await Promise.all([
      listEduPatientRecords(g.ctx, paciente.id, g.ctx.institution.timezone, {
        caseId: eduCleanId(url.searchParams.get("caso")),
      }),
      listEduPatientCaseOptions(g.ctx, paciente.id),
    ]);

    return NextResponse.json({ rows, cases });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/expediente");
  }
}

/**
 * POST /api/instituto/pacientes/[id]/expediente — escribe una nota.
 *
 * Nace SIEMPRE en BORRADOR: firmar es un acto aparte (PATCH), con su
 * propio sello de tiempo. Si se pudiera crear firmada, un doble clic
 * dejaría dos notas firmadas idénticas en un expediente que ya no se
 * puede editar.
 *
 * 🔴 El paciente y el alumno de la nota salen del CASO, y el autor de la
 * SESIÓN. Ninguno del body: si vinieran del cliente, se podría escribir en
 * el expediente de una persona atribuyéndolo a otra.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;

  try {
    const paciente = await getEduClinicalPatient(g.ctx, params.id);
    if (!paciente) {
      return NextResponse.json(
        { error: "Ese paciente no existe o su expediente no te toca." },
        { status: 404 },
      );
    }

    const body = await eduReadJson(request);
    // El paciente va como argumento y no se saca del caso: `createEduRecord`
    // comprueba que el caso del body sea de ESTE paciente. Sin esa
    // comprobación, un caseId de otra persona (que quien escribe sí puede
    // ver) pondría la nota en el expediente equivocado.
    const created = await createEduRecord(g.ctx, paciente.id, body);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/expediente");
  }
}
