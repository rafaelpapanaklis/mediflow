import { NextResponse } from "next/server";
import { isStudioGateOk, openStudioGate, studioServerError } from "../_server";
import { getStudioSpend, listStudioItems } from "@/lib/realty/studio/spend";

export const dynamic = "force-dynamic";

/** E. El consumo del día y del mes, más lo que se ha generado. */
export async function GET() {
  const gate = await openStudioGate();
  if (!isStudioGateOk(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const [spend, items] = await Promise.all([
      getStudioSpend(ctx.accountId, ctx.account.timezone),
      listStudioItems(ctx.accountId, 40),
    ]);
    return NextResponse.json({ spend, items });
  } catch (err) {
    return studioServerError("spend", err);
  }
}
