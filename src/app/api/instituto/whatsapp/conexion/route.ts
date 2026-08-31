import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { disconnectEduWa, saveEduWaConnection } from "@/lib/edu/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/whatsapp/conexion — conecta la WhatsApp del instituto.
 *
 * 🔴 CADA INSTITUTO CONECTA LA SUYA. Meta le cobra cada plantilla a la
 * tarjeta de ESA cuenta y no existe forma de mandar en nombre de otra: no
 * hay un número compartido de DaleControl que se pueda "asignar" desde
 * aquí, y por eso este endpoint pide credenciales en vez de ofrecer una
 * lista.
 *
 * 🔴 El institutionId sale de getEduContext() (vía eduApiGuard) y JAMÁS del
 * cuerpo. Un institutionId del body sería conectarle un número a otra
 * escuela — o robarle el suyo.
 *
 * 🔴 El token se guarda CIFRADO (ver saveEduWaConnection) y no vuelve nunca
 * al navegador.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("whatsapp.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const connection = await saveEduWaConnection(g.ctx.institutionId, body);
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/whatsapp/conexion");
  }
}

/**
 * DELETE — desconecta y APAGA los tres avisos.
 *
 * Apagarlos es la mitad que importa: si quedaran encendidos, el día que
 * alguien vuelva a conectar el número empezarían a salir mensajes a
 * pacientes sin que nadie lo hubiera pedido, con cargo a la escuela.
 */
export async function DELETE() {
  const g = await eduApiGuard("whatsapp.manage");
  if ("response" in g) return g.response;

  try {
    const connection = await disconnectEduWa(g.ctx.institutionId);
    return NextResponse.json({ connection });
  } catch (err) {
    return eduApiError(err, "DELETE /api/instituto/whatsapp/conexion");
  }
}
