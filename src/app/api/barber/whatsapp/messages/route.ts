// GET  /api/barber/whatsapp/messages?phone=… → mensajes de UN hilo
// POST /api/barber/whatsapp/messages          → responder a mano
//
// El envío manual solo sale dentro de la ventana de 24 h. Fuera de ella
// Meta rechaza el texto libre (131047) y el mensaje se perdería en
// silencio: aquí se devuelve el motivo para que la pantalla lo diga.
import { NextResponse } from "next/server";
import {
  isManualSendError,
  listBarberThreadMessages,
  sendBarberManualMessage,
} from "@/lib/barber/whatsapp";
import { asString, jsonError, openWaGate, readJson, WA_INBOX_FEATURE } from "../_server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openWaGate({
    permission: "whatsapp.view",
    feature: WA_INBOX_FEATURE,
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;

  const phone = url.searchParams.get("phone");
  if (!phone) return jsonError("Falta el teléfono del hilo.", 400);

  try {
    const thread = await listBarberThreadMessages(gate.gate.shopId, phone);
    return NextResponse.json(thread);
  } catch (err) {
    console.error("[GET barber/whatsapp/messages]", err);
    return jsonError("No se pudo abrir la conversación.", 500);
  }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  const gate = await openWaGate({
    permission: "whatsapp.send",
    feature: WA_INBOX_FEATURE,
    branchId: asString(body?.branchId),
  });
  if (gate.response) return gate.response;

  const phone = asString(body?.phone);
  const text = asString(body?.body);
  if (!phone || !text) return jsonError("Falta el teléfono o el mensaje.", 400);

  try {
    const result = await sendBarberManualMessage({
      barbershopId: gate.gate.shopId,
      phone,
      body: text,
    });
    if (isManualSendError(result)) {
      // 409 y no 500: no es un fallo del servidor, es una regla de Meta o
      // del plan que la barbería puede entender y resolver.
      return jsonError(result.error, 409, result.code ? { code: result.code } : undefined);
    }
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error("[POST barber/whatsapp/messages]", err);
    return jsonError("No se pudo enviar el mensaje.", 500);
  }
}
