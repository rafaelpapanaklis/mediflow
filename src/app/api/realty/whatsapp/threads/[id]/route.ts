import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../../_server";
import {
  listRealtyThreadMessages,
  markRealtyThreadRead,
  setRealtyThreadArchived,
} from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

/** Mensajes del hilo, CON sus estados de entrega reales. */
export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await openRealtyWaGate("whatsapp.view");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const data = await listRealtyThreadMessages(gate.ctx.accountId, params.id);
  if (!data.phone) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  return NextResponse.json(data);
}

/**
 * Archivar / desarchivar y marcar leído.
 *
 * Marcar leído va con whatsapp.view: es parte de LEER. Archivar es una
 * mutación que le cambia la bandeja a todo el equipo, así que pide
 * whatsapp.send — se comprueba aparte, más abajo.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await openRealtyWaGate("whatsapp.view");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const body = await req.json().catch(() => ({}));
  let touched = false;

  if (typeof body?.archived === "boolean") {
    const canArchive = await openRealtyWaGate("whatsapp.send");
    if (!isRealtyWaGateOk(canArchive)) return canArchive.response;
    touched = await setRealtyThreadArchived(gate.ctx.accountId, params.id, body.archived);
    if (!touched) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }

  if (body?.read === true) {
    const ok = await markRealtyThreadRead(gate.ctx.accountId, params.id);
    if (!ok && !touched) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }
    touched = true;
  }

  if (!touched) return NextResponse.json({ error: "Nada que cambiar" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
