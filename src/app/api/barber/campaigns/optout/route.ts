// ═══════════════════════════════════════════════════════════════════════
// GET  /api/barber/campaigns/optout        → quiénes están dados de baja.
// POST /api/barber/campaigns/optout        → dar de baja / revertir.
//
// Una baja es una decisión del CLIENTE, así que se respeta en todas las
// listas por construcción: listBarberCampaignAudience() la lee en el mismo
// lugar donde arma las audiencias, no cada pantalla por su cuenta. Aquí
// solo se ve y se revierte a mano (que alguien se dio de baja por error es
// posible; que no se pueda arreglar, no).
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  listBarberCampaignOptOuts,
  setBarberCampaignOptOut,
} from "@/lib/barber/campaigns";
import { asString, jsonError, openCampaignsGate, readJson } from "../_server";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await openCampaignsGate("whatsapp.view");
  if (gate.response) return gate.response;
  try {
    return NextResponse.json({ rows: await listBarberCampaignOptOuts(gate.gate.ctx) });
  } catch (err) {
    console.error("[GET barber/campaigns/optout]", err);
    return jsonError("No se pudieron leer las bajas.", 500);
  }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  // Tocar la baja de un cliente es editar su ficha, no mandar un mensaje.
  const gate = await openCampaignsGate("clients.edit");
  if (gate.response) return gate.response;

  const clientId = asString(body?.clientId);
  if (!clientId) return jsonError("Falta el cliente.", 400);
  if (typeof body?.optOut !== "boolean") return jsonError("Falta la acción.", 400);

  try {
    const result = await setBarberCampaignOptOut(gate.gate.ctx, {
      clientId,
      optOut: body.optOut,
      source: "staff",
      reason: asString(body?.reason),
    });
    // ok:false aquí solo significa "esa ficha no es de esta barbería".
    if (!result.ok) return jsonError("No se encontró ese cliente.", 404);
    return NextResponse.json({ ok: true, optOut: result.optOut });
  } catch (err) {
    console.error("[POST barber/campaigns/optout]", err);
    return jsonError("No se pudo cambiar la baja.", 500);
  }
}
