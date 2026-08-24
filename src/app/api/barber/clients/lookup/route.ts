import { NextResponse } from "next/server";
import { lookupBarberClientByPhone } from "@/lib/barber/clients";
import { gateBarberClients, serverError } from "../_helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/barber/clients/lookup?phone=5512345678
 *
 * PUNTO DE EXTENSIÓN para la agenda (T1) y la reserva del panel: antes de
 * sentar a alguien, responde si ese teléfono ya tiene ficha y —lo importante—
 * SI ESTÁ BLOQUEADO, con su motivo. Nunca borramos a nadie: bloquear es
 * marcar, y este endpoint es el que hace que la marca se vea a tiempo.
 *
 * Respuesta:
 *   { phone, client: BarberClientDTO | null, blocked: boolean, blockReason }
 */
export async function GET(req: Request) {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const result = await lookupBarberClientByPhone(gate.ctx, url.searchParams.get("phone"));
    if (!result.phone) {
      return NextResponse.json(
        { error: "Escribe el teléfono a 10 dígitos." },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    return serverError("lookup", e);
  }
}
