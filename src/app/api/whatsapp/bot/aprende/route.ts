import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { panelAprende } from "@/lib/whatsapp/bot/aprende/servicio";
import { denegarSiNoPuedeVer, respuestaDeError } from "@/lib/whatsapp/bot/aprende/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/bot/aprende (ws1-t11)
 * Reporte de la semana («lo que el bot no supo»), sugerencias pendientes,
 * respuestas recientes del bot para 👍/👎 y candidatas a ejemplo de tono.
 * Escanea el Inbox de paso (idempotente, sin IA). clinicId de la sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denegarSiNoPuedeVer(ctx);
  if (denied) return denied;
  try {
    return NextResponse.json(await panelAprende(ctx.clinicId));
  } catch (e) {
    return respuestaDeError(e, "panel");
  }
}
