import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { decideEduApprovalBatch } from "@/lib/edu/autorizaciones";
import { EDU_APPROVAL_BATCH_SKIP_LABELS } from "@/lib/edu/autorizaciones-core";
import { eduRequestSignature } from "@/lib/edu/firma";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/autorizaciones/lote — autorizar varias de un alumno.
 *
 * 🔴 EXISTE PARA QUE EL GATE NO SE VUELVA UN SELLO DE GOMA. Un docente con
 * quince alumnos recibe decenas de peticiones al día; sin lote firma sin leer
 * en dos semanas y el gate deja de gatear nada.
 *
 * 🔴 Y POR ESO MISMO NO SE LO TRAGA TODO. Se quedan fuera —y se devuelven con
 * su motivo, para pintarlo— las URGENCIAS (las únicas que ya ocurrieron sin
 * firma), las que el alumno editó después de mandarlas, las que pidió el
 * propio firmante y las que dejaron de estar pendientes. Si el lote se
 * llevara justo lo que hay que leer, el sello de goma lo habríamos construido
 * nosotros.
 *
 * Solo AUTORIZA. Pedir cambios y rechazar llevan motivo escrito y van una por
 * una: un "no" en lote es un "no" que nadie explicó.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("autorizaciones.decide");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const firma = eduRequestSignature(request);
    const out = await decideEduApprovalBatch(g.ctx, body.ids, firma);

    // El motivo viaja YA traducido: la pantalla no vuelve a decidir cómo se
    // llama en español un "no-pendiente".
    return NextResponse.json({
      ok: true,
      approved: out.approved,
      skipped: out.skipped.map((s) => ({
        id: s.id,
        reason: s.reason,
        detail: EDU_APPROVAL_BATCH_SKIP_LABELS[s.reason],
      })),
    });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/autorizaciones/lote");
  }
}
