import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { signEduStudyUpload } from "@/lib/edu/estudios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PASO 1 de la subida DIRECTA de estudios.
 *
 * POST /api/instituto/pacientes/[id]/estudios/sign
 *   body: { name, size, contentType? }
 *   → { path, signedUrl, contentType, maxBytes }
 *
 * 🔴 EL BINARIO NO PASA POR AQUÍ. Una tomografía CBCT pesa cientos de MB y
 * el cuerpo de una petición en Vercel se corta muy por debajo de eso
 * (~4.5 MB); subir una constante del handler no mueve ese techo, no es
 * nuestro. El navegador pide permiso aquí, sube directo al bucket con la
 * signed upload URL, y luego llama a /confirm.
 *
 * Lo que se valida (todo en el servidor, nada se cree del cliente):
 *   · sesión + permiso + ALCANCE clínico del paciente
 *   · extensión dentro de la lista blanca
 *   · tamaño DECLARADO <= 2 GB
 *   · el PATH lo compone el servidor con el institutionId de la SESIÓN
 *
 * Lo que NO se puede validar aquí: la firma real del contenido, porque los
 * bytes nunca pasan por el servidor. El tamaño declarado es una PISTA — un
 * cliente puede mentir — y por eso /confirm vuelve a medir el objeto real.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const firmada = await signEduStudyUpload(g.ctx, params.id, body);
    return NextResponse.json(firmada);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/estudios/sign");
  }
}
