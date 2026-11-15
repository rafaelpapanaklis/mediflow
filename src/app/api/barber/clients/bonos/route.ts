import { NextResponse } from "next/server";
import { BarberForbiddenError } from "@/lib/barber-auth";
import { getBonusEditor, saveBonusCatalog, starsErrorBody } from "@/lib/barber/stars";
import { gateBarberClients, readJson, serverError } from "../_helpers";

export const dynamic = "force-dynamic";

/**
 * /api/barber/clients/bonos — el catálogo de bonos de la barbería.
 *
 * GET → bonos (activos e inactivos) + servicios del catálogo para elegir.
 * PUT { bonuses: [...] } → guarda la lista completa. settings.edit
 *     (dueño/encargado): es configuración, no una acción de mostrador.
 *     No borra: un bono que sobra se marca inactivo.
 */
export async function GET() {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await getBonusEditor(gate.ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError("bonos.get", e);
  }
}

export async function PUT(req: Request) {
  const gate = await gateBarberClients("settings.edit");
  if ("response" in gate) return gate.response;
  try {
    const body = await readJson(req);
    return NextResponse.json(await saveBonusCatalog(gate.ctx, body.bonuses));
  } catch (e) {
    if (e instanceof BarberForbiddenError) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    const known = starsErrorBody(e);
    if (known) return NextResponse.json(known.body, { status: known.status });
    return serverError("bonos.put", e);
  }
}
