import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient, updateEduPatient } from "@/lib/edu/pacientes";
import { listEduPatientCases } from "@/lib/edu/casos";
import { listEduPatientAppointments } from "@/lib/edu/agenda";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id] — la ficha, SI le toca a quien pregunta.
 *
 * El id de la URL NO basta: `getEduPatient` busca la fila con el `where`
 * del alcance, así que un paciente de otra escuela —o de otro alumno— se ve
 * exactamente igual que uno que no existe. Es lo que debe pasar: un 403
 * confirmaría que ese folio existe.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;

  try {
    const row = await getEduPatient(g.ctx, params.id);
    if (!row) {
      return NextResponse.json({ error: "Ese paciente no existe o no te toca." }, { status: 404 });
    }

    // Los casos y las citas van en la MISMA respuesta porque la ficha los
    // pinta juntos: tres viajes para abrir un modal se notan en el
    // teléfono del piso clínico. Cada bloque exige SU permiso — quien no
    // tiene casos.view recibe una lista vacía, no un 403 que le cerraría
    // la ficha entera.
    const perm = { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride };
    const [cases, appointments] = await Promise.all([
      hasEduPermission(perm, "casos.view") ? listEduPatientCases(g.ctx, row.id) : Promise.resolve([]),
      hasEduPermission(perm, "agenda.view")
        ? listEduPatientAppointments(g.ctx, row.id, g.ctx.institution.timezone)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({ row, cases, appointments });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]");
  }
}

/**
 * PATCH /api/instituto/pacientes/[id] — datos de la ficha.
 *
 * El ORIGEN no se toca aquí: tiene su propio endpoint y su propio permiso
 * (/origen), porque no es un dato más de la ficha sino el que decide el
 * precio. Un `referredByStudentId` que llegue en este body se ignora.
 *
 * Un paciente no se BORRA: cambia de estado. Por eso este archivo no tiene
 * un handler DELETE — sus citas y sus casos ocurrieron.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const updated = await updateEduPatient(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/pacientes/[id]");
  }
}
