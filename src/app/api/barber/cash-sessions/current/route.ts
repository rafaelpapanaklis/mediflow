import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, getCashState, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/cash-sessions/current → turno abierto (con resumen por
// método y tickets) + historial corto. cash.view.
export async function GET() {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const state = await getCashState(ctx);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
