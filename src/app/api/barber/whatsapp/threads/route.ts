// GET /api/barber/whatsapp/threads → hilos del Inbox (uno por teléfono).
//   ?archived=1 devuelve los archivados. Archivar NUNCA borra nada: es una
//   marca con fecha, y un mensaje nuevo desarchiva el hilo solo.
//
// El barbershopId sale de la sesión: una barbería no puede ver los hilos
// de otra ni pidiéndolo.
import { NextResponse } from "next/server";
import { listBarberThreads } from "@/lib/barber/whatsapp";
import { jsonError, openWaGate, WA_INBOX_FEATURE } from "../_server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openWaGate({
    permission: "whatsapp.view",
    feature: WA_INBOX_FEATURE,
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;

  try {
    const threads = await listBarberThreads(gate.gate.shopId, {
      archived: url.searchParams.get("archived") === "1",
    });
    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[GET barber/whatsapp/threads]", err);
    return jsonError("No se pudieron leer las conversaciones.", 500);
  }
}
