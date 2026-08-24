import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, closeCashSession, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// POST /api/barber/cash-sessions/close { countedAmount, notes? } → cierra el
// turno abierto: congela esperado, registra contado y quién cerró. cash.manage.
// Un turno cerrado NO se reabre (no existe endpoint para ello a propósito).
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const summary = await closeCashSession(ctx, { countedAmount: body.countedAmount, notes: body.notes });
    return NextResponse.json(summary);
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
