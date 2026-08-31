import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { decideEduApproval, getEduApprovalStage } from "@/lib/edu/autorizaciones";
import { assertEduPermission } from "@/lib/edu/permissions";
import { eduRequestSignature } from "@/lib/edu/firma";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/autorizaciones/[id] — autorizar, pedir cambios o
 * rechazar. Es lo que hacen los tres botones grandes de la bandeja.
 *
 * Exige "autorizaciones.decide" (DOCENTE y DIRECCIÓN). Y encima del permiso,
 * tres cosas que un permiso no puede saber y comprueba `decideEduApproval`:
 *   · que la fila le TOQUE — un docente que ya rotó no firma lo de los
 *     alumnos que entregó, y la respuesta es 404, igual que si no existiera;
 *   · que siga PENDIENTE — dos docentes mirando la misma bandeja es lo
 *     normal, no lo raro;
 *   · que no la haya pedido él mismo.
 *
 * 🔴 La IP y el user-agent salen de la PETICIÓN, jamás del body. Si vinieran
 * del cliente, el rastro de la firma sería un campo que firma el firmante — y
 * lo que se quiere poder contestar dentro de un año es desde dónde se firmó,
 * no desde dónde dijo alguien que firmaba.
 *
 * 🔴 Ola 14 · LA RECETA PIDE UNA SEGUNDA LLAVE. Si la fila es de la etapa
 * RECETA, decidirla exige ADEMÁS "recetas.issue": autorizarla EXPIDE un
 * documento con la cédula de quien firma, y eso no es lo mismo que
 * autorizar un avance. La etapa se lee ANTES de decidir con
 * getEduApprovalStage, que deliberadamente no recorta por alcance — solo
 * elige qué permiso se exige; una fila que no toca la rebota después
 * decideEduApproval con 404, igual que siempre.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("autorizaciones.decide");
  if ("response" in g) return g.response;

  try {
    const stage = await getEduApprovalStage(g.ctx, params.id);
    if (stage === "PRESCRIPTION") {
      assertEduPermission(g.ctx, "recetas.issue");
    }

    const body = await eduReadJson(request);
    const firma = eduRequestSignature(request);
    const out = await decideEduApproval(g.ctx, params.id, {
      decision: body.decision,
      note: body.note,
      signatureUrl: body.signatureUrl,
      cedula: body.cedula,
      ip: firma.ip,
      userAgent: firma.userAgent,
    });
    return NextResponse.json({ ok: true, id: out.id, status: out.status });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/autorizaciones/[id]");
  }
}
