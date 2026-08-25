import { NextResponse } from "next/server";
import { openWaGate, jsonError, readJson, asString } from "../../whatsapp/_server";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  listBarberBotPauses,
  pauseBarberBotThread,
  resumeBarberBotThread,
} from "@/lib/barber/bot";

/* ═══════════════════════════════════════════════════════════════════════
   /api/barber/bot/pause — "en esta conversación contesto yo".

   Pausar es lo que hace que el bot sea confiable: en cuanto alguien de la
   barbería entra a un hilo, el bot se calla ahí y NO le pisa la respuesta
   al cliente. Reanudar lo devuelve.

   El bot se pausa solo cuando el cliente pide una persona o cuando no
   entiende (ver bot.ts); esto es el control MANUAL del mostrador.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const BOT_FEATURE = "whatsappBot";

export async function POST(req: Request) {
  // Tomar o soltar una conversación es atender, no configurar: por eso el
  // permiso de enviar WhatsApp y no el de ajustes.
  const gate = await openWaGate({ permission: "whatsapp.send", feature: BOT_FEATURE });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo inválido", 400);

  const phone = mxTenDigits(asString(body.phone));
  if (!phone) return jsonError("Ese teléfono no es válido.", 400);

  const action = asString(body.action);
  if (action !== "pause" && action !== "resume") {
    return jsonError("La acción debe ser pause o resume.", 400);
  }

  if (action === "pause") {
    await pauseBarberBotThread({
      barbershopId: shopId,
      phone,
      reason: asString(body.reason) || "La barbería tomó la conversación",
    });
  } else {
    await resumeBarberBotThread({ barbershopId: shopId, phone });
  }

  return NextResponse.json({ ok: true, pauses: await listBarberBotPauses(shopId) });
}
