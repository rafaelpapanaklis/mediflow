import { NextResponse } from "next/server";
import { readBlockInfo, setBarberClientBlocked, toBarberClientDTO } from "@/lib/barber/clients";
import { gateBarberClients, readJson, serverError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * POST { blocked: boolean, reason?: string } — el que no llega tres veces.
 *
 * BLOQUEAR NO ES BORRAR: la ficha, el historial de cortes, las fotos y la
 * tarjeta de lealtad se quedan enteras. Lo único que cambia es que
 * /api/barber/clients/lookup responde `blocked: true` con el motivo, para
 * que la agenda avise ANTES de sentarlo. Desbloquear es mandar blocked:false.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const blocked = body.blocked !== false;
    const row = await setBarberClientBlocked(gate.ctx, params.id, blocked, body.reason);
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({
      client: toBarberClientDTO(row),
      block: readBlockInfo(row.preferences),
    });
  } catch (e) {
    return serverError("block", e);
  }
}
