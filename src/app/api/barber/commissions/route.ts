import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import {
  currentPeriodKey,
  DEFAULT_BARBER_TZ,
  getCommissionSummary,
  isValidPeriodKey,
} from "@/lib/barber/commissions";

export const dynamic = "force-dynamic";

// GET /api/barber/commissions?period=YYYY-MM&barberId= → resumen del periodo
// por barbero: producido, comisión, propinas, renta, total a pagar y estado
// de pago. Plan AVANZADO+ (feature commissions) + commissions.view. Un rol
// BARBER recibe SOLO su fila; pedir barberId ajeno → 403.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "commissions");
    const sp = req.nextUrl.searchParams;
    const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
    const periodParam = sp.get("period");
    const periodKey = isValidPeriodKey(periodParam) ? periodParam : currentPeriodKey(tz);
    const summary = await getCommissionSummary(ctx, periodKey, { barberId: sp.get("barberId") });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
