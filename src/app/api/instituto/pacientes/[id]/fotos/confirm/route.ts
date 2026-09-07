import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { confirmEduPhotoUpload } from "@/lib/edu/fotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Medir el objeto en Storage puede tardar un par de reintentos cortos, y
 *  después se descarga para comprobar su número mágico. */
export const maxDuration = 60;

/**
 * PASO 3 de la subida DIRECTA: el objeto YA está en el bucket (lo subió el
 * navegador). Aquí el servidor decide si esa subida se convierte en una
 * fila del expediente.
 *
 * POST /api/instituto/pacientes/[id]/fotos/confirm
 *   body: { path, thumbPath?, etapa, vista, capturedAt?, caseId?, notas?,
 *           width?, height? }
 *   → { ok, id, alreadyRegistered }
 *
 * 🔴 NO SE CREE NADA DE LO QUE DIGA EL CLIENTE:
 *   · el `path` debe caer EXACTAMENTE en la carpeta de este instituto y
 *     este paciente — sin esto, conociendo un path ajeno se podría
 *     registrar el archivo de otra escuela dentro del expediente propio;
 *   · la MINIATURA tiene que ser la de ESA foto (mismo uuid), no cualquier
 *     objeto que caiga en la carpeta;
 *   · el TAMAÑO se le pregunta a Storage, jamás al cliente;
 *   · el CONTENIDO se comprueba por NÚMERO MÁGICO. Es lo único que la
 *     tubería directa podía haber perdido, y no se perdió: se descarga el
 *     objeto (ya medido, así que acotado) y se miran sus primeros bytes.
 *
 * Es IDEMPOTENTE: un reintento o un doble toque devuelven la fila que ya
 * existe en vez de duplicar la foto (índice único sobre el path, que ya
 * estaba en el esquema y en `sql/edu-ola-b.sql`).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await confirmEduPhotoUpload(g.ctx, params.id, {
      path: body.path,
      thumbPath: body.thumbPath,
      stage: body.etapa,
      photoType: body.vista,
      capturedAt: body.capturedAt,
      caseId: body.caseId,
      notes: body.notas,
      width: body.width,
      height: body.height,
    });
    return NextResponse.json(
      { ok: true, ...res },
      { status: res.alreadyRegistered ? 200 : 201 },
    );
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/fotos/confirm");
  }
}
