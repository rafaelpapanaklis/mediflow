import { NextRequest, NextResponse } from "next/server";
import { aiHistoryErrorResponse, resolveAiScope } from "@/lib/ai-assistant/api";
import { leerConversacionSabina } from "@/lib/sabina/engine-historial";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

/**
 * GET /api/sabina/conversations/[id]
 *   ← { conversation: { id, title, updatedAt, … }, messages: [{ id, role, content, timestamp }] }
 *
 * Una conversación de Sabina con sus turnos. El where lleva clinicId + userId
 * de la SESIÓN y la marca de Sabina: una conversación de otra clínica, de un
 * compañero o del Asistente IA devuelve el MISMO 404 que un id inventado.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  try {
    const found = await leerConversacionSabina(auth.scope, params.id);
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(found);
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}
