import { NextResponse } from "next/server";
import { openWaGate, jsonError, readJson } from "../whatsapp/_server";
import {
  BarberBotStorageError,
  getBarberBotPanelState,
  saveBarberBotSettings,
} from "@/lib/barber/bot";

/* ═══════════════════════════════════════════════════════════════════════
   /api/barber/bot — encender, apagar y afinar el bot que agenda.

   EL CANDADO DEL PLAN VIVE AQUÍ, EN EL SERVIDOR. La pantalla también lo
   dibuja, pero una pantalla se puede saltar: un plan Avanzado que llame a
   este endpoint a mano recibe 403, no un bot encendido.

   `feature: "whatsappBot"` (plan Profesional) en LAS DOS verbos — leer la
   configuración del bot ya es una función del plan.

   El barbershopId sale SIEMPRE de la sesión (openWaGate → getBarberContext).
   Nada de leerlo del body.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const BOT_FEATURE = "whatsappBot";

export async function GET() {
  const gate = await openWaGate({ permission: "whatsapp.view", feature: BOT_FEATURE });
  if (gate.response) return gate.response;
  const { shopId, timezone } = gate.gate;

  try {
    const state = await getBarberBotPanelState(shopId, timezone);
    return NextResponse.json(state);
  } catch (err) {
    console.error("[api/barber/bot] no se pudo leer el estado:", err);
    return jsonError("No se pudo cargar el bot.", 500);
  }
}

export async function PATCH(req: Request) {
  // Configurar el bot es configurar la barbería: mismo permiso que el resto
  // de los ajustes, no el de "mandar un WhatsApp".
  const gate = await openWaGate({ permission: "settings.edit", feature: BOT_FEATURE });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo inválido", 400);

  try {
    // normalizeBotSettings (bot-core) valida y recorta TODO lo que entra:
    // un tope de gasto absurdo o un tono inventado no llegan a la base.
    const settings = await saveBarberBotSettings(shopId, body);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    if (err instanceof BarberBotStorageError) {
      return jsonError(err.message, 503, { code: "BOT_STORAGE_MISSING" });
    }
    console.error("[api/barber/bot] no se pudo guardar:", err);
    return jsonError("No se pudo guardar la configuración del bot.", 500);
  }
}
