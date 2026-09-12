import { NextRequest, NextResponse } from "next/server";
import { aiHistoryErrorResponse, resolveAiScope } from "@/lib/ai-assistant/api";
import { listarConversacionesSabina } from "@/lib/sabina/engine-historial";

export const dynamic = "force-dynamic";

/**
 * GET /api/sabina/conversations
 *   ← { conversations: [{ id, title, updatedAt }] }
 *
 * La barra de historial de /dashboard/sabina. El contrato solo cubría el POST;
 * la pantalla llamaba ya a esta ruta con esta forma, así que se construyó del
 * lado del servidor en vez de cambiar la pantalla. SOLO las conversaciones de
 * Sabina de quien pregunta, en la clínica de su sesión — nunca las del
 * Asistente IA (ver engine-historial.ts).
 */
export async function GET(_req: NextRequest) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  try {
    const conversations = await listarConversacionesSabina(auth.scope);
    return NextResponse.json({ conversations });
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}
