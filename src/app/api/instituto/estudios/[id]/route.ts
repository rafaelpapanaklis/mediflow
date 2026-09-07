import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { softDeleteEduStudy, updateEduStudy } from "@/lib/edu/estudios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/estudios/[id] — CORRIGE un estudio ya registrado.
 *
 *   body: { name?, kind?, caseId?, takenAt?, notes?, annotations? }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EXISTE PORQUE HASTA HOY UN ESTUDIO NO SE PODÍA CORREGIR (H-14).
 *
 * Lo único editable era la nota, y solo desde el visor. El alumno subía
 * `panoramica.jpg` con el nombre del paciente anterior, o marcaba una foto
 * de la sonrisa que el servidor registró como "Radiografía" —porque para
 * TODA imagen asume radiografía—, y no había forma de arreglarlo: ni
 * renombrar, ni reclasificar, ni mover de caso, ni fechar. Con un `.zip`
 * sí (el visor CBCT del dental trae su panel); con el `.jpg`, que es lo
 * que más se sube, no.
 *
 * 🔴 EL `kind` NO SE ACEPTA A CIEGAS. Pasa por `eduValidarReclasificacion`
 * → `eduResolveStudyKind`, la MISMA función que decide el tipo al
 * registrar: una imagen va y viene entre radiografía y foto, y un `.zip`
 * de 600 MB nunca se convierte en "Foto" (que es lo que haría que la
 * galería intentara pintarlo con un `<img>`).
 *
 * 🔴 PERMISO `estudios.upload`, no `estudios.view`: corregir el tipo o la
 * fecha cambia lo que enseña el expediente. Y el estudio se resuelve con
 * el institutionId de la SESIÓN y el alcance clínico del rol — uno de otra
 * escuela es 404, igual que uno inventado.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await updateEduStudy(g.ctx, params.id, {
      name: body.name,
      kind: body.kind,
      caseId: body.caseId,
      takenAt: body.takenAt,
      notes: body.notes,
      annotations: body.annotations,
    });
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/estudios/[id]");
  }
}

/**
 * DELETE /api/instituto/estudios/[id] — RETIRA el estudio del expediente.
 *
 *   body: { motivo: string }
 *
 * 🔴 NO BORRA NADA: ni la fila ni el binario. La fila queda con
 * `deletedAt`, `deletedById` y `deleteReason`, deja de salir en la galería
 * y deja de contar para la cuota. Es la misma línea que las fotos y que el
 * resto del vertical —una carta se revoca con motivo, una receta se anula
 * con motivo— y lo contrario de lo único que hoy destruye rastro, que es
 * la goma del odontograma (H-17).
 *
 * Sin motivo se contesta 400 con palabras: sin él, "retirar" y "borrar"
 * son la misma cosa con distinto nombre.
 *
 * ⚠️ Y por eso `abortEduStudyUpload` (POST …/estudios/abort) sigue
 * negándose a sacar un archivo YA registrado: aquella puerta borra el
 * binario y solo sirve para limpiar una subida a medias. Su 409 ahora
 * manda aquí en vez de acabarse en sí mismo.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await softDeleteEduStudy(g.ctx, params.id, body.motivo);
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "DELETE /api/instituto/estudios/[id]");
  }
}
