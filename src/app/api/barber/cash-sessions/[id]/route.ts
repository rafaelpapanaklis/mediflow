import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, getCashSessionSummary, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/cash-sessions/[id] → resumen de un turno (abierto o
// cerrado) de la barbería en sesión: esperado por método, tickets. cash.view.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const summary = await getCashSessionSummary(ctx, params.id);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
