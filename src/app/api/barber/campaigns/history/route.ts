// ═══════════════════════════════════════════════════════════════════════
// GET /api/barber/campaigns/history
//   → qué se mandó, cuándo, cuánto costó y QUIÉN VOLVIÓ después.
//
// Sin la última columna el dueño no sabe si la campaña sirvió — y esa es la
// única razón para volver a usarla. Sale de las filas reales que creó el
// emisor, no de un contador aparte que podría mentir.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { listBarberCampaignHistory } from "@/lib/barber/campaigns";
import { jsonError, openCampaignsGate } from "../_server";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await openCampaignsGate("whatsapp.view");
  if (gate.response) return gate.response;
  try {
    return NextResponse.json(await listBarberCampaignHistory(gate.gate.ctx));
  } catch (err) {
    console.error("[GET barber/campaigns/history]", err);
    return jsonError("No se pudo leer el historial.", 500);
  }
}
