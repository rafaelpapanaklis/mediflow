// POST /api/barber/whatsapp/archive → archiva / desarchiva un hilo.
//
// ARCHIVAR NUNCA BORRA NADA. Se escribe una marca con fecha en la misma
// tabla (append-only) y la lista compara esa marca con el último mensaje
// real del hilo: por eso un mensaje nuevo lo desarchiva solo.
import { NextResponse } from "next/server";
import { setBarberThreadArchived } from "@/lib/barber/whatsapp";
import { asString, jsonError, openWaGate, readJson, WA_INBOX_FEATURE } from "../_server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson(req);
  const gate = await openWaGate({
    permission: "whatsapp.send",
    feature: WA_INBOX_FEATURE,
    branchId: asString(body?.branchId),
  });
  if (gate.response) return gate.response;

  const phone = asString(body?.phone);
  if (!phone) return jsonError("Falta el teléfono del hilo.", 400);
  const archived = body?.archived !== false;

  try {
    const ok = await setBarberThreadArchived(gate.gate.shopId, phone, archived);
    if (!ok) return jsonError("Esa conversación no existe.", 404);
    return NextResponse.json({ ok: true, archived });
  } catch (err) {
    console.error("[POST barber/whatsapp/archive]", err);
    return jsonError("No se pudo archivar la conversación.", 500);
  }
}
