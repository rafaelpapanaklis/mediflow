import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { currentPeriodKey, DEFAULT_BARBER_TZ, isValidPeriodKey } from "@/lib/barber/commissions";
import { getInventoryStats } from "@/lib/barber/inventory";

export const dynamic = "force-dynamic";

// GET /api/barber/products/stats?period=YYYY-MM → alerta de mínimos, valor
// del inventario, margen promedio y más vendidos del periodo. products.manage.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
    const periodParam = req.nextUrl.searchParams.get("period");
    const periodKey = isValidPeriodKey(periodParam) ? periodParam : currentPeriodKey(tz);
    const stats = await getInventoryStats(ctx, periodKey);
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
