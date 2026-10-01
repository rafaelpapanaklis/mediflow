import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { quitarEjemploDeTono } from "@/lib/whatsapp/bot/aprende/servicio";
import { denegarSiNoPuedeEditar, respuestaDeError } from "@/lib/whatsapp/bot/aprende/http";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/whatsapp/bot/aprende/tono/[id] (ws1-t11)
 * Quita un ejemplo de tono: lo DESACTIVA (la fila se queda), con guardia de clínica.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denegarSiNoPuedeEditar(ctx);
  if (denied) return denied;
  try {
    await quitarEjemploDeTono({ clinicId: ctx.clinicId, id: params.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respuestaDeError(e, "quitar tono");
  }
}
