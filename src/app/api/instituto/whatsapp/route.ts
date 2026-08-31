import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import {
  eduWaConnectionDTO,
  getEduWaConfig,
  listEduWaMessages,
  saveEduWaSettings,
} from "@/lib/edu/whatsapp";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/whatsapp — el estado de la conexión y los últimos
 * envíos.
 *
 * 🔴 NO devuelve el token. Ni cifrado ni recortado: un token de WhatsApp es
 * la cuenta de Meta entera del instituto, y lo único que la pantalla
 * necesita saber es SI hay uno guardado (eso lo dice `state`). Mandarlo al
 * navegador "solo para pintarlo" es cómo acaba en el historial de la
 * consola de alguien.
 */
export async function GET() {
  const g = await eduApiGuard("whatsapp.view");
  if ("response" in g) return g.response;

  try {
    const cfg = await getEduWaConfig(g.ctx.institutionId);
    const [connection, messages] = await Promise.all([
      Promise.resolve(eduWaConnectionDTO(cfg)),
      listEduWaMessages(g.ctx, { take: 50 }),
    ]);
    return NextResponse.json({ connection, messages });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/whatsapp");
  }
}

/**
 * PATCH — enciende y apaga avisos, y fija la anticipación del recordatorio.
 *
 * Exige "whatsapp.manage" y no "whatsapp.view" porque encender un aviso ABRE
 * UN GASTO: Meta le cobra cada plantilla a la tarjeta de la WABA del
 * instituto. Mirar la pantalla es una cosa; decidir que la escuela empieza a
 * pagar mensajes es otra.
 */
export async function PATCH(request: Request) {
  const g = await eduApiGuard("whatsapp.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const connection = await saveEduWaSettings(g.ctx.institutionId, body);
    return NextResponse.json({ connection });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/whatsapp");
  }
}
