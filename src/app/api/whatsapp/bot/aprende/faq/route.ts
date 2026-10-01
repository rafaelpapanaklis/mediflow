import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { crearFaqDesdeReporte } from "@/lib/whatsapp/bot/aprende/servicio";
import { denegarSiNoPuedeEditar, leerJson, respuestaDeError } from "@/lib/whatsapp/bot/aprende/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/bot/aprende/faq (ws1-t11)
 * «Agregar respuesta» desde el reporte de lo que el bot no supo: { pregunta,
 * respuesta } → respuesta frecuente, con las validaciones de privacidad (nada
 * clínico, sin [marcadores]) que POST /api/whatsapp/bot/faqs no hace.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denegarSiNoPuedeEditar(ctx);
  if (denied) return denied;

  const body = await leerJson(req);
  try {
    const r = await crearFaqDesdeReporte({
      clinicId: ctx.clinicId,
      pregunta: typeof body?.pregunta === "string" ? body.pregunta : "",
      respuesta: typeof body?.respuesta === "string" ? body.respuesta : "",
    });
    return NextResponse.json(r);
  } catch (e) {
    return respuestaDeError(e, "crear respuesta frecuente");
  }
}
