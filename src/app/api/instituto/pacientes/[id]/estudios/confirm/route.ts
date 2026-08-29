import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { confirmEduStudyUpload } from "@/lib/edu/estudios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Medir el objeto en Storage puede tardar un par de reintentos cortos. */
export const maxDuration = 60;

/**
 * PASO 3 de la subida DIRECTA: el objeto YA está en el bucket (lo subió el
 * navegador). Aquí el servidor decide si esa subida se convierte en una
 * fila del expediente.
 *
 * POST /api/instituto/pacientes/[id]/estudios/confirm
 *   body: { path, name, caseId?, notes? }  → { id, alreadyRegistered }
 *
 * 🔴 NO SE CREE NADA DE LO QUE DIGA EL CLIENTE:
 *   · el `path` debe caer EXACTAMENTE en la carpeta de este instituto y
 *     este paciente — sin esto, conociendo un path ajeno se podría
 *     registrar el archivo de otra escuela dentro del expediente propio;
 *   · el TAMAÑO se le pregunta a Storage, jamás al cliente: validar un
 *     tope con un número que el cliente controla es regalar el límite justo
 *     en los archivos más pesados del sistema;
 *   · el TIPO (radiografía / tomografía / PDF) sale de la extensión del
 *     path que compuso el servidor.
 *
 * Es IDEMPOTENTE: un reintento o un doble clic devuelven la fila que ya
 * existe en vez de duplicar el estudio (índice único sobre el path).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await confirmEduStudyUpload(g.ctx, params.id, body);
    return NextResponse.json(
      { ok: true, ...res },
      { status: res.alreadyRegistered ? 200 : 201 },
    );
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/estudios/confirm");
  }
}
