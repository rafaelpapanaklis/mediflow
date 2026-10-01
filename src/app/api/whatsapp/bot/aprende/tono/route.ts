import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { marcarEjemploDeTono } from "@/lib/whatsapp/bot/aprende/servicio";
import { denegarSiNoPuedeEditar, leerJson, respuestaDeError } from "@/lib/whatsapp/bot/aprende/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/bot/aprende/tono (ws1-t11)
 * { messageId } de una respuesta del equipo → ejemplo de tono «así hablamos»
 * (anonimizado, corto, máximo 8 activos).
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denegarSiNoPuedeEditar(ctx);
  if (denied) return denied;

  const body = await leerJson(req);
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  if (!messageId) return NextResponse.json({ error: "messageId requerido" }, { status: 400 });
  try {
    const ejemplo = await marcarEjemploDeTono({ clinicId: ctx.clinicId, userId: ctx.userId, messageId });
    return NextResponse.json({ ejemplo });
  } catch (e) {
    return respuestaDeError(e, "marcar tono");
  }
}
