import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { softDeleteEduPatientPhoto, updateEduPatientPhoto } from "@/lib/edu/fotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/pacientes/[id]/fotos/[fotoId] — corrige la ETAPA,
 * la VISTA, la FECHA DE TOMA o la NOTA de una foto.
 *
 *   body: { etapa?, vista?, capturedAt?, notas? }
 *
 * 🔴 EXISTE PORQUE EL ERROR QUE SE COMETE ES ÉSE. Marcar "Antes" lo que
 * era "Después" rompe el comparador en silencio: enseña dos "antes" y
 * parece que no hubo tratamiento. Hoy en los estudios eso solo se puede
 * corregir si el archivo es un `.zip` (H-14), que es justo lo que no es
 * una foto.
 *
 * Un campo que no viene NO se toca. `notas` en vacío BORRA la nota.
 *
 * El permiso es `estudios.upload` y no uno de lectura: corregir la etapa
 * de una foto cambia lo que enseña el comparador, o sea el expediente.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; fotoId: string } },
) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await updateEduPatientPhoto(g.ctx, params.fotoId, {
      stage: body.etapa,
      photoType: body.vista,
      capturedAt: body.capturedAt,
      notes: body.notas,
    });
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/pacientes/[id]/fotos/[fotoId]");
  }
}

/**
 * DELETE /api/instituto/pacientes/[id]/fotos/[fotoId] — DA DE BAJA la
 * foto. Baja SUAVE, con autor y con MOTIVO OBLIGATORIO.
 *
 *   body: { motivo: string }
 *
 * 🔴 NO BORRA NADA: ni la fila ni el binario. La fila queda con
 * `deletedAt`, `deletedById` y `deleteReason`, y deja de salir en la
 * galería y de contar para la cuota. Es la misma línea que el resto del
 * vertical — una carta se revoca con motivo, una receta se anula con
 * motivo — y lo contrario de lo único que hoy destruye rastro, que es la
 * goma del odontograma (H-17).
 *
 * Sin motivo se contesta 400 con palabras: sin él, "dar de baja" y
 * "borrar" son la misma cosa con distinto nombre.
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; fotoId: string } },
) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await softDeleteEduPatientPhoto(g.ctx, params.fotoId, body.motivo);
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "DELETE /api/instituto/pacientes/[id]/fotos/[fotoId]");
  }
}
