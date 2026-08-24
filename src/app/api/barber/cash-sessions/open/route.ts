import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse, openCashSession } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// POST /api/barber/cash-sessions/open { openingAmount, notes? } → abre turno
// con fondo inicial. cash.manage. 409 SESSION_ALREADY_OPEN si ya hay uno.
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const summary = await openCashSession(ctx, { openingAmount: body.openingAmount, notes: body.notes });
    return NextResponse.json(summary, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
