import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { archivarEduReceta } from "@/lib/edu/recetas-archivo";

export const dynamic = "force-dynamic";

/**
 * POST — ARCHIVA una receta RECHAZADA (H-24).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ARCHIVAR NO ES ANULAR, Y POR ESO ESTA RUTA NO ES `/anular`.
 *
 * H-24 quedó a medias: mover de caso en BORRADOR y retirar lo propuesto se
 * arreglaron, pero RECHAZADA seguía sin salida y la receta se quedaba en
 * la lista del alumno para siempre.
 *
 * La casilla anterior se negó —con razón— a abrir RECHAZADA → ANULADA: una
 * ANULADA **se imprime** (marcada, con su motivo), así que ese camino
 * sacaría papel sin cédula de la escuela. ARCHIVADA no lo toca:
 * `eduRecetaPrintable("ARCHIVADA")` es `false`, y hay dos pruebas que lo
 * fijan.
 *
 * 🔴 PERMISO `recetas.propose`, no `recetas.void`. Quien armó la propuesta
 * es quien la guarda cuando el docente le dice que no; obligar a un
 * docente a archivar los rechazos de sus alumnos convertiría un gesto de
 * limpieza en un trámite. `recetas.void` es de anular lo EXPEDIDO.
 *
 * El motivo es OPCIONAL: el porqué del rechazo ya lo escribió el docente
 * en su autorización. Lo de aquí es el porqué de guardarla.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.propose");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await archivarEduReceta(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/recetas/${params.id}/archivar`);
  }
}
