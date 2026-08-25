import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../_server";
import { listRealtyThreads } from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

/** Lista de conversaciones. `?archived=1` para ver las archivadas. */
export async function GET(req: NextRequest) {
  const gate = await openRealtyWaGate("whatsapp.view");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const archived = req.nextUrl.searchParams.get("archived") === "1";
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;

  const threads = await listRealtyThreads(gate.ctx.accountId, { archived, limit });
  return NextResponse.json({ threads });
}
