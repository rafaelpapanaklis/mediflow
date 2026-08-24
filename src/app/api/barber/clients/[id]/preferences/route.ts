import { NextResponse } from "next/server";
import {
  readClientPreferences,
  saveClientPreferences,
  toBarberClientDTO,
} from "@/lib/barber/clients";
import { gateBarberClients, readJson, serverError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH — cómo le gusta el corte a este cliente: número de máquina, tipo de
 * desvanecido, raya, largo arriba y a los lados, barba, qué productos usa y
 * cuáles le irritan, y las notas del barbero.
 *
 * Solo se aceptan las llaves del catálogo (CLIENT_PREFERENCE_FIELDS). Las
 * llaves reservadas del servidor (bitácora de lealtad, motivo del bloqueo)
 * se tiran del cuerpo y se conservan de la fila: por eso desde el navegador
 * no se puede fabricar un canje ni borrar un bloqueo.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const source = body.preferences !== undefined ? body.preferences : body;
    const row = await saveClientPreferences(gate.ctx, params.id, source);
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({
      client: toBarberClientDTO(row),
      preferences: readClientPreferences(row.preferences),
    });
  } catch (e) {
    return serverError("preferences", e);
  }
}
