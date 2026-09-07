import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { abortEduPhotoUpload } from "@/lib/edu/fotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LIMPIEZA de la subida directa: borra el objeto que se subió y NUNCA se
 * confirmó.
 *
 * POST /api/instituto/pacientes/[id]/fotos/abort
 *   body: { path, thumbPath? }  → { deleted }
 *
 * 🔴 EXISTE PORQUE LA TUBERÍA NUEVA LO PIDE. Con la subida en un solo
 * viaje, un fallo no dejaba nada atrás; con los tres pasos, un /confirm que
 * falla —o una cancelación— deja el binario en el bucket SIN fila que lo
 * registre, y la cuota se calcula con `SUM(sizeBytes)` de las filas: esos
 * bytes se pagarían y no aparecerían en el medidor. Es exactamente la
 * lección de H-26 en los estudios, aplicada aquí antes de que muerda.
 *
 * Solo borra HUÉRFANOS: si la foto ya es parte del expediente, contesta 409
 * y manda a «Retirar», que deja constancia y no destruye el archivo.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await abortEduPhotoUpload(g.ctx, params.id, {
      path: body.path,
      thumbPath: body.thumbPath,
    });
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/fotos/abort");
  }
}
