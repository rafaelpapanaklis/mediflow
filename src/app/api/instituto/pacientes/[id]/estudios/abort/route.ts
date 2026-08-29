import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { abortEduStudyUpload } from "@/lib/edu/estudios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LIMPIEZA de la subida directa: borra el objeto que quedó en el bucket
 * cuando una subida se canceló o falló y por tanto NUNCA se confirmó.
 *
 * POST /api/instituto/pacientes/[id]/estudios/abort   body: { path }
 *   → { deleted: boolean }
 *
 * Sin esto, cancelar la subida de una tomografía de 600 MB deja el objeto
 * en Storage ocupando espacio real y sin fila que lo contabilice: espacio
 * fantasma que el instituto paga y que ni él ni el sistema pueden ver.
 *
 * SEGURIDAD — esta ruta borra bytes, así que se defiende en tres frentes:
 *   1. sesión + permiso + ALCANCE clínico del paciente;
 *   2. el path debe caer en la carpeta de este instituto y este paciente;
 *   3. NO debe existir ninguna fila EduStudy apuntando a ese path. Solo se
 *      borran HUÉRFANOS: si el archivo ya es parte del expediente, esta
 *      puerta no es un atajo para sacarlo de ahí.
 *
 * Es best-effort por diseño: si el navegador se cierra a media subida nadie
 * la llama. Ese caso queda para un barrido periódico de huérfanos, anotado
 * como pendiente en ORQUESTA.md.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await abortEduStudyUpload(g.ctx, params.id, body);
    return NextResponse.json(res);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/estudios/abort");
  }
}
