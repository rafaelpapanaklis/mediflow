import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { retirarEduBloqueo } from "@/lib/edu/agenda-bloqueos";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";

export const dynamic = "force-dynamic";

/**
 * DELETE — RETIRA un bloqueo.
 *
 * 🔴 EL VERBO ES DELETE Y LA ESCRITURA ES UN `updateMany` QUE PONE
 * `deletedAt`. No es incoherencia: DELETE es lo que el navegador entiende
 * por "quítalo de la agenda", y lo que pasa por debajo es una baja lógica.
 * La fila se queda: un bloqueo que existió explica por qué esa tarde no
 * hubo nadie en la clínica.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("sillones.manage");
  if ("response" in g) return g.response;
  try {
    // 🔴 S-5 · EL ALCANCE DE SEDE. Sin `eduWithCampus`, el
    // `eduCampusCovers` de `retirarEduBloqueo` recibía `undefined` y decía
    // que sí a todo: la coordinadora del Norte podía retirar el bloqueo de
    // dirección del Sur con solo tener el id en la URL.
    const cctx = eduWithCampus(g.ctx, await getEduCampusScope(g.ctx));
    const r = await retirarEduBloqueo(cctx, params.id, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `DELETE /api/instituto/bloqueos/${params.id}`);
  }
}
