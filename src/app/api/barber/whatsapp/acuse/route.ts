import { NextResponse } from "next/server";
import { openWaGate, jsonError, readJson } from "../_server";
import { BarberWaAckStorageError, getBarberWaAck, saveBarberWaAck } from "@/lib/barber/wa-acuse";

/* ═══════════════════════════════════════════════════════════════════════
   /api/barber/whatsapp/acuse — el ACUSE AUTOMÁTICO (apagado por defecto).

   «Contestar en automático cuando un cliente responde a un recordatorio»:
   interruptor + texto. Las reglas de cuándo sale viven en
   src/lib/barber/wa-acuse-core.ts.

   Feature: whatsappReminders (TODOS los planes, como los recordatorios a los
   que contesta). Leer: whatsapp.view. Guardar: settings.edit, igual que el
   bot. El barbershopId sale SIEMPRE de la sesión (openWaGate).
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await openWaGate({ permission: "whatsapp.view" });
  if (gate.response) return gate.response;
  const state = await getBarberWaAck(gate.gate.shopId);
  return NextResponse.json(state);
}

export async function PATCH(req: Request) {
  const gate = await openWaGate({ permission: "settings.edit" });
  if (gate.response) return gate.response;

  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo inválido", 400);

  try {
    const settings = await saveBarberWaAck(gate.gate.shopId, body);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    if (err instanceof BarberWaAckStorageError) {
      return jsonError(err.message, 503, { code: "ACK_STORAGE_MISSING" });
    }
    console.error("[api/barber/whatsapp/acuse] no se pudo guardar:", err);
    return jsonError("No se pudo guardar el ajuste.", 500);
  }
}
