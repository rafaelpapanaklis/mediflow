import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { decidirSugerencia } from "@/lib/whatsapp/bot/aprende/servicio";
import { denegarSiNoPuedeEditar, leerJson, respuestaDeError } from "@/lib/whatsapp/bot/aprende/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/bot/aprende/sugerencias/[id] (ws1-t11)
 * { accion: "aprobar", pregunta?, respuesta? } → crea la respuesta frecuente
 * (con el texto editado, si viene). { accion: "descartar" } → no vuelve a salir.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denegarSiNoPuedeEditar(ctx);
  if (denied) return denied;

  const body = await leerJson(req);
  const accion = body?.accion;
  if (accion !== "aprobar" && accion !== "descartar") {
    return NextResponse.json({ error: "accion debe ser aprobar o descartar" }, { status: 400 });
  }
  try {
    const r = await decidirSugerencia({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      id: params.id,
      accion,
      pregunta: typeof body?.pregunta === "string" ? body.pregunta : undefined,
      respuesta: typeof body?.respuesta === "string" ? body.respuesta : undefined,
    });
    return NextResponse.json(r);
  } catch (e) {
    return respuestaDeError(e, "decidir sugerencia");
  }
}
