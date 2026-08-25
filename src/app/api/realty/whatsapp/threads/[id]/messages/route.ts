import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../../../_server";
import { isRealtyWaSendOk } from "@/lib/realty/whatsapp-core";
import { sendRealtyManualMessage } from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

/**
 * Responder a mano desde el Inbox. Pasa por el MISMO camino que todo lo
 * demás (cupo, ventana de 24 h, registro): no hay atajo a Meta.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const gate = await openRealtyWaGate("whatsapp.send");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const payload = await req.json().catch(() => ({}));
  const body = typeof payload?.body === "string" ? payload.body : "";

  const result = await sendRealtyManualMessage({
    accountId: gate.ctx.accountId,
    threadId: params.id,
    body,
  });

  // 409 y no 500: no es un fallo del servidor, es que ese mensaje no se
  // puede mandar ahora (ventana cerrada, cupo agotado, sin conexión). El
  // texto ya viene en español y listo para pintarse.
  if (!isRealtyWaSendOk(result)) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 409 });
  }

  return NextResponse.json({ ok: true, messageId: result.messageId }, { status: 201 });
}
