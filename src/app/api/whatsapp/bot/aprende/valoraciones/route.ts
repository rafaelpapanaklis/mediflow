import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { valorarRespuesta } from "@/lib/whatsapp/bot/aprende/servicio";
import { denegarSiNoPuedeEditar, leerJson, respuestaDeError } from "@/lib/whatsapp/bot/aprende/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/bot/aprende/valoraciones (ws1-t11)
 * { messageId, valor: "bien" | "mal", correccion? } sobre una respuesta del
 * bot de la clínica de la sesión. Un 👎 con corrección queda como sugerencia.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denegarSiNoPuedeEditar(ctx);
  if (denied) return denied;

  const body = await leerJson(req);
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const valor = body?.valor;
  if (!messageId || (valor !== "bien" && valor !== "mal")) {
    return NextResponse.json({ error: "messageId y valor (bien|mal) requeridos" }, { status: 400 });
  }
  try {
    const r = await valorarRespuesta({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      messageId,
      valor,
      correccion: typeof body?.correccion === "string" ? body.correccion : null,
    });
    return NextResponse.json(r);
  } catch (e) {
    return respuestaDeError(e, "valorar");
  }
}
