import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { createCashMovement } from "@/lib/barber/caja-movimientos";

export const dynamic = "force-dynamic";

// POST /api/barber/cash-movements
//   { type: EXPENSE|WITHDRAWAL|DEPOSIT|BARBER_PAYOUT, amount, method?, category?,
//     note?, barberId?, payoutKind?: ADVANCE|OTHER, receiptPath? }
// → { movement, outsideSession }. Gasto y entrada: cash.expenses; sacar y
// pagar a barbero: cash.withdraw. Solo el monto es obligatorio (y el barbero
// en un pago). Comisión y sueldo NO van aquí: /api/barber/commissions/pay.
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const out = await createCashMovement(ctx, body && typeof body === "object" ? body : {});
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
