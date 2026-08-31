import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
import { updateEduAppointment } from "@/lib/edu/agenda";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/agenda/[id] — REAGENDAR: hora, sillón, alumno,
 * supervisor, tipo y notas.
 *
 * Exige "agenda.manage". El ESTADO de la cita (llegó, se sentó, terminó) NO
 * se toca aquí: tiene su propio endpoint (/estado) porque lo mueve quien
 * está en el sillón, que solo trae agenda.view.
 *
 * 🔴 Una cita terminada, cancelada o marcada "no llegó" no se mueve:
 * reagendarla reescribiría algo que ya ocurrió. Se agenda otra.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("agenda.manage");
  if ("response" in g) return g.response;

  try {
    // 🔴 Ola 11 · el ctx lleva LA SEDE (mover una cita a un sillón de una
    // sede ajena se rebota) y la zona con la que se lee la hora es la de la
    // SEDE DEL SILLÓN de destino, no la del instituto.
    const sede = await getEduCampusScope(g.ctx);
    const updated = await updateEduAppointment(
      eduWithCampus(g.ctx, sede),
      params.id,
      await eduReadJson(request),
      sede.timezone,
    );
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/agenda/[id]");
  }
}
