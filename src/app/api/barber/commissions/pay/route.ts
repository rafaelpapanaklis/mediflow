import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { getCommissionSummary, markCommissionsPaid } from "@/lib/barber/commissions";

export const dynamic = "force-dynamic";

// POST /api/barber/commissions/pay { barberId, periodKey } → marca pagadas
// (paidAt = ahora) todas las entradas pendientes del barbero en el periodo y
// devuelve su fila actualizada. commissions.manage (dueño/encargado).
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "commissions");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const barberId = typeof body.barberId === "string" ? body.barberId : "";
    const periodKey = typeof body.periodKey === "string" ? body.periodKey : "";
    if (!barberId) return NextResponse.json({ error: "barberId requerido" }, { status: 400 });
    const result = await markCommissionsPaid(ctx, { barberId, periodKey });
    const summary = await getCommissionSummary(ctx, periodKey, { barberId });
    return NextResponse.json({ ...result, row: summary.rows[0] ?? null });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
