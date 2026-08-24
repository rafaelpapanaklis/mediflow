// GET  /api/barber/whatsapp/templates → estado REAL leído de Meta
// POST /api/barber/whatsapp/templates → da de alta las que falten
//
// Las plantillas de barber llevan prefijo PROPIO (dc_barber_*): las del
// dental viven en la WABA de cada clínica y aquí no se tocan ni por nombre.
import { NextResponse } from "next/server";
import { listBarberTemplates, provisionBarberTemplates } from "@/lib/barber/whatsapp";
import { asString, jsonError, openWaGate, readJson } from "../_server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openWaGate({ permission: "whatsapp.view", branchId });
  if (gate.response) return gate.response;

  try {
    return NextResponse.json(await listBarberTemplates(gate.gate.shopId));
  } catch (err) {
    console.error("[GET barber/whatsapp/templates]", err);
    return jsonError("No se pudieron leer las plantillas.", 500);
  }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const gate = await openWaGate({
    permission: "settings.edit",
    branchId: asString(body?.branchId),
  });
  if (gate.response) return gate.response;

  try {
    // includeMarketing solo si la barbería lo pide EXPLÍCITAMENTE: las de
    // marketing cuestan ~4x y exigen consentimiento del cliente.
    const includeMarketing = body?.includeMarketing === true;
    const result = await provisionBarberTemplates(gate.gate.shopId, { includeMarketing });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST barber/whatsapp/templates]", err);
    return jsonError("No se pudieron dar de alta las plantillas.", 500);
  }
}
