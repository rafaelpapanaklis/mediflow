import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { getCommissionSummary, markCommissionsPaid } from "@/lib/barber/commissions";

export const dynamic = "force-dynamic";

// POST /api/barber/commissions/pay { barberId, periodKey, expectedTotal? } →
// paga lo PENDIENTE del barbero en el periodo (marca sus entradas sin pagar)
// y devuelve cuánto cubrió el pago y su fila actualizada. `expectedTotal` es
// el «a pagar» que la pantalla le enseñó a quien paga: si ya cambió, 409
// PAYOUT_CHANGED y no se marca nada. commissions.manage (dueño/encargado).
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "commissions");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const barberId = typeof body.barberId === "string" ? body.barberId : "";
    const periodKey = typeof body.periodKey === "string" ? body.periodKey : "";
    if (!barberId) return NextResponse.json({ error: "barberId requerido" }, { status: 400 });
    // Caja completa (ws6-t1): «sale de la caja en efectivo» (fromCash) desde
    // Comisiones, o el medio elegido en «Pagar a barbero» de Caja
    // (payoutMethod). Crea el movimiento de caja ligado en la misma
    // transacción; pide además cash.withdraw.
    const payoutMethod = typeof body.payoutMethod === "string" ? body.payoutMethod : body.fromCash === true ? "CASH" : null;
    const result = await markCommissionsPaid(
      ctx,
      { barberId, periodKey, expectedTotal: body.expectedTotal },
      new Date(),
      { cashOut: payoutMethod ? { method: payoutMethod as never } : null },
    );
    const summary = await getCommissionSummary(ctx, periodKey, { barberId });
    return NextResponse.json({ ...result, row: summary.rows[0] ?? null });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
