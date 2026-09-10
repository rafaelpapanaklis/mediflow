import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { updateEduReceta } from "@/lib/edu/recetas";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/recetas/[id] — editar el contenido.
 *
 * Exige "recetas.propose", y encima del permiso, dos cosas que un permiso
 * no puede saber y comprueba updateEduReceta:
 *   · que la receta le TOQUE a quien edita (alcance clínico; 404 si no);
 *   · que esté en un estado editable (BORRADOR o PENDIENTE) y que quien
 *     edita sea QUIEN LA PROPUSO — su nombre es el que va congelado en el
 *     papel, y nadie escribe bajo el nombre de otro.
 *
 * Una EXPEDIDA jamás pasa por aquí: se anula y se hace otra. Y desde
 * WS2-T3 la escritura lleva el ESTADO en el `where` (H-16): si la receta
 * dejó de estar en el estado que se leyó —porque el docente la firmó en
 * esa misma ventana— la edición no cae encima, contesta 409.
 *
 * El cuerpo acepta también `caseId`: MOVER un borrador al caso correcto.
 * La pantalla lo mandaba desde el primer día y el servidor lo tiraba en
 * silencio, así que el usuario creía haber movido la receta. El caso se
 * comprueba dentro del alcance, tiene que ser del mismo paciente y estar
 * abierto; una PENDIENTE no se mueve (su petición ya está en la bandeja
 * del docente del caso viejo).
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.propose");
  if ("response" in g) return g.response;

  try {
    const out = await updateEduReceta(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: out.id });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/recetas/[id]");
  }
}
