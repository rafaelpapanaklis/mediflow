import { NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../_server";
import { getRealtyWaConnection, getRealtyWaQuota } from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

/** Estado de la conexión + cupo del periodo. Lo pinta la pestaña de ajustes. */
export async function GET() {
  const gate = await openRealtyWaGate("whatsapp.view");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const [connection, quota] = await Promise.all([
    getRealtyWaConnection(gate.ctx.accountId),
    getRealtyWaQuota(gate.ctx.accountId),
  ]);

  return NextResponse.json({ connection, quota });
}
