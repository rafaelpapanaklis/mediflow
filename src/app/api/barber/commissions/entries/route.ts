import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { getCommissionEntries } from "@/lib/barber/commissions";

export const dynamic = "force-dynamic";

// GET /api/barber/commissions/entries?period=YYYY-MM&barberId= → entradas
// (una por venta) del barbero en el periodo. commissions.view; un BARBER
// solo puede pedir las suyas (403 si pide otro barberId).
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "commissions");
    const sp = req.nextUrl.searchParams;
    const barberId = sp.get("barberId") ?? "";
    if (!barberId) return NextResponse.json({ error: "barberId requerido" }, { status: 400 });
    const entries = await getCommissionEntries(ctx, { periodKey: sp.get("period") ?? "", barberId });
    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
