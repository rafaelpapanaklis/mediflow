import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { cancelarEduRotacionProgramada } from "@/lib/edu/docente";

export const dynamic = "force-dynamic";

/**
 * DELETE — CANCELA una rotación que todavía no arrancó.
 *
 * 🔴 EL VERBO ES DELETE Y LA ESCRITURA NO BORRA NADA. Es lo mismo que hacen
 * los bloqueos de agenda: DELETE es lo que el navegador entiende por
 * «quítala de la lista», y lo que pasa por debajo es escribir
 * `endsAt = startsAt`, con lo que la asignación nunca llega a estar vigente
 * y la fila se queda con sus fechas. Dentro de un año hay que poder
 * contestar «esto se programó y se dio marcha atrás», que no es lo mismo
 * que «nunca se programó».
 *
 * 🔴 SOLO LO QUE NO HA ARRANCADO. Una asignación ya vigente se cierra con
 * PATCH /api/instituto/supervision/[id] (`endsAt = ahora`): eso es un hecho
 * del pasado, y borrar su vigencia reescribiría quién supervisaba cuando
 * ocurrió algo. Aquí se rebota con 409 y lo dice.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("supervision.assign");
  if ("response" in g) return g.response;
  try {
    const r = await cancelarEduRotacionProgramada(
      g.ctx,
      params.id,
      eduAuditRequestMeta(request),
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `DELETE /api/instituto/supervision/programadas/${params.id}`);
  }
}
