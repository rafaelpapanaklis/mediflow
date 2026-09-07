import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduPhotoSignedUrl } from "@/lib/edu/fotos";

export const runtime = "nodejs";
// 🔴 force-dynamic obligatorio: lo que devuelve es una URL FIRMADA que
// caduca en una hora. Cachear esta respuesta serviría enlaces muertos.
export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/fotos/[fotoId]/url — una URL FIRMADA
 * recién generada para esa foto (y para su miniatura).
 *
 *   → { url, thumbUrl }
 *
 * Existe como ruta propia y no solo dentro del listado porque el visor a
 * pantalla completa y el comparador se abren mucho después de que la
 * galería se pintó, y para entonces la URL de la lista puede haber
 * caducado. Pedirla otra vez es un viaje; recargar la pestaña entera para
 * refrescar cuarenta enlaces es otra cosa.
 *
 * El path NUNCA sale de aquí: lo que viaja es la URL firmada. Y la foto se
 * busca dentro del ALCANCE clínico Y bajo el `[id]` de la URL (N-16), así
 * que ni un id de otra escuela ni la foto de otro paciente existen aquí:
 * los dos devuelven 404, igual que uno inventado.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string; fotoId: string } },
) {
  const g = await eduApiGuard("estudios.view");
  if ("response" in g) return g.response;

  try {
    const out = await getEduPhotoSignedUrl(g.ctx, params.fotoId, params.id);
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/fotos/[fotoId]/url");
  }
}
