import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, listCashSessions, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/cash-sessions?limit=15&closed=1 → historial de turnos de
// la barbería en sesión (cash.view). Cada fila trae totales derivados.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "15");
    const onlyClosed = req.nextUrl.searchParams.get("closed") === "1";
    const rows = await listCashSessions(ctx, {
      limit: Number.isFinite(limitRaw) ? limitRaw : 15,
      onlyClosed,
    });
    return NextResponse.json({ sessions: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
