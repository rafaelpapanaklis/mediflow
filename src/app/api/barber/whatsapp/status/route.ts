// GET /api/barber/whatsapp/status
//   → estado de la conexión + cupo del periodo + estado de las plantillas.
// Es lo que pinta la pantalla al abrir y tras conectar.
import { NextResponse } from "next/server";
import {
  getBarberWaConnection,
  getBarberWaQuota,
  listBarberTemplates,
  platformSenderEnabled,
} from "@/lib/barber/whatsapp";
import { jsonError, openWaGate } from "../_server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openWaGate({ permission: "whatsapp.view", branchId });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  try {
    const [connection, quota] = await Promise.all([
      getBarberWaConnection(shopId),
      getBarberWaQuota(shopId),
    ]);

    // Las plantillas se leen de Meta EN VIVO y solo si hay conexión: sin
    // token no hay nada que preguntar y la llamada sobra.
    const templates =
      connection.state === "DISCONNECTED"
        ? { ok: false, reason: null as string | null, templates: [] }
        : await listBarberTemplates(shopId);

    return NextResponse.json({
      connection,
      quota,
      templates,
      platformSenderEnabled: platformSenderEnabled(),
    });
  } catch (err) {
    console.error("[GET barber/whatsapp/status]", err);
    return jsonError("No se pudo leer el estado de WhatsApp.", 500);
  }
}
