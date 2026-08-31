import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { refreshEduWaTemplateStatus, saveEduWaTemplates } from "@/lib/edu/whatsapp";

export const dynamic = "force-dynamic";

/**
 * PUT /api/instituto/whatsapp/plantillas — registra los NOMBRES con los que
 * Meta aprobó las plantillas de este instituto.
 *
 * El TEXTO de cada plantilla lo fija DaleControl y no se puede cambiar desde
 * aquí: los valores {{1}}…{{n}} viajan POR POSICIÓN, así que una plantilla
 * con otro número de variables o en otro orden entrega el mensaje con los
 * datos cambiados de sitio (o Meta la rechaza con 132000). Lo que la escuela
 * registra es cómo se llama la suya.
 *
 * 🔴 El ESTADO no se acepta del cliente. Lo pone Meta, y lo escribe el POST
 * de abajo: si la pantalla pudiera mandar `status: "APPROVED"`, bastaría un
 * `fetch` a mano para desactivar la única comprobación que evita gastar
 * intentos contra una plantilla rechazada.
 */
export async function PUT(request: Request) {
  const g = await eduApiGuard("whatsapp.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const connection = await saveEduWaTemplates(g.ctx.institutionId, body.templates ?? body);
    return NextResponse.json({ connection });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/whatsapp/plantillas");
  }
}

/**
 * POST — le PREGUNTA a Meta en qué estado tiene las plantillas y guarda la
 * respuesta.
 *
 * Devuelve 200 aunque Meta no conteste, con `ok: false` y el motivo: que la
 * revisión falle no puede tumbar la pantalla de configuración, y el motivo
 * ("falta el WABA ID", "Meta no contestó") es lo único que le sirve a quien
 * está intentando dejar esto funcionando.
 */
export async function POST() {
  const g = await eduApiGuard("whatsapp.manage");
  if ("response" in g) return g.response;

  try {
    const res = await refreshEduWaTemplateStatus(g.ctx.institutionId);
    return NextResponse.json(res);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/whatsapp/plantillas");
  }
}
