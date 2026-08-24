import { NextResponse } from "next/server";
import { toBarberClientDTO, updateBarberClient } from "@/lib/barber/clients";
import { getBarberClientDetail } from "@/lib/barber/loyalty";
import { gateBarberClients, readJson, serverError } from "../_helpers";

export const dynamic = "force-dynamic";

/**
 * GET — la ficha completa: datos, preferencias, tarjeta de lealtad (ya
 * recalculada en el servidor), historial de cortes con fotos firmadas,
 * membresía vigente y motivo del bloqueo.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;

  try {
    const detail = await getBarberClientDetail(gate.ctx, params.id);
    // 404 —no 403— cuando la ficha es de OTRA barbería: el where ya filtró
    // por el barbershopId de la sesión, así que desde fuera es indistinguible
    // de "no existe". Un id ajeno no revela ni siquiera que exista.
    if (!detail) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    return serverError("detail", e);
  }
}

/** PATCH — nombre, teléfono, correo, cumpleaños y notas libres. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const result = await updateBarberClient(gate.ctx, params.id, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, field: result.field }, { status: 400 });
    }
    return NextResponse.json({ client: toBarberClientDTO(result.client) });
  } catch (e) {
    return serverError("update", e);
  }
}
