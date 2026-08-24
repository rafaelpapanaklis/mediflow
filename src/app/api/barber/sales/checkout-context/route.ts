import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, getCheckoutContext, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/sales/checkout-context → catálogos para cobrar (servicios,
// productos si el plan los incluye, barberos) + citas terminadas sin ticket.
export async function GET() {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const features = await assertBarberFeature(ctx, "cash");
    const context = await getCheckoutContext(ctx, features);
    return NextResponse.json(context, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
