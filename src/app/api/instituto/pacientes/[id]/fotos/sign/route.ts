import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { signEduPhotoUpload } from "@/lib/edu/fotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PASO 1 de la subida DIRECTA de una FOTO CLÍNICA (N-2).
 *
 * POST /api/instituto/pacientes/[id]/fotos/sign
 *   body: { name, size, contentType }
 *   → { path, thumbPath, signedUrl, thumbSignedUrl, contentType,
 *       thumbContentType, maxBytes }
 *
 * 🔴 EL BINARIO NO PASA POR AQUÍ, y ésa es toda la corrección. Pasaba, por
 * `request.formData()` en `../route.ts`, y el `bodySizeLimit` de
 * `next.config.mjs` solo cubre las server actions: en producción el cuerpo
 * de un route handler se corta muy por debajo de lo que la pantalla
 * prometía. El navegador pide permiso aquí, sube directo al bucket con la
 * signed upload URL, y luego llama a /confirm.
 *
 * Lo que se valida (todo en el servidor, nada se cree del cliente):
 *   · sesión + permiso + ALCANCE clínico del paciente
 *   · que lo que se va a subir sea el JPEG ya comprimido por el navegador
 *     (la compresión dejó de ser best-effort: es obligatoria)
 *   · tamaño DECLARADO <= 25 MB
 *   · que quepa en la CUOTA DEL INSTITUTO — 507 con el mensaje escrito
 *   · el PATH lo compone el servidor con el institutionId de la SESIÓN
 *
 * Lo que NO se puede validar aquí: el contenido real, porque los bytes
 * nunca pasan por el servidor. Por eso /confirm mide el objeto en Storage y
 * comprueba su número mágico antes de crear la fila.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const firmada = await signEduPhotoUpload(g.ctx, params.id, body);
    return NextResponse.json(firmada);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/fotos/sign");
  }
}
