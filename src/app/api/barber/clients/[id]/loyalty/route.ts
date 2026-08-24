import { NextResponse } from "next/server";
import { redeemBarberLoyalty, syncBarberClientLoyalty } from "@/lib/barber/loyalty";
import { gateBarberClients, readJson, serverError } from "../../_helpers";

export const dynamic = "force-dynamic";

/** GET — estado vivo de la tarjeta (recalculado, no leído de una caché). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;

  try {
    const result = await syncBarberClientLoyalty(gate.ctx, params.id);
    if (!result) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ loyalty: result.state });
  } catch (e) {
    return serverError("loyalty.get", e);
  }
}

/**
 * POST { appointmentId?, note? } — canjear el premio.
 *
 * OJO: el cuerpo NO trae ningún número. El contador se recalcula en el
 * servidor desde las citas cerradas y las ventas de mostrador, y el UPDATE
 * lleva la condición `loyaltyCount >= threshold` en el WHERE. Desde el
 * navegador no hay forma de sumarse sellos ni de canjear dos veces: el
 * segundo intento afecta 0 filas y responde 409.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const result = await redeemBarberLoyalty(gate.ctx, {
      clientId: params.id,
      appointmentId: typeof body.appointmentId === "string" ? body.appointmentId : null,
      note: body.note,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ loyalty: result.state });
  } catch (e) {
    return serverError("loyalty.redeem", e);
  }
}
