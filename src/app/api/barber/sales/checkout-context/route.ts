import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, getCheckoutContext, getClientLookup, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/sales/checkout-context → catálogos para cobrar (servicios,
// productos si el plan los incluye, barberos) + citas terminadas sin ticket.
// Con ?clientId= añade `client`: ese cliente ya listo para el ticket (el
// «Nuevo cobro» de su ficha), o null si no se le puede cobrar desde aquí.
export async function GET(req: Request) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const features = await assertBarberFeature(ctx, "cash");
    const context = await getCheckoutContext(ctx, features);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) return NextResponse.json(context, { headers: { "Cache-Control": "no-store" } });
    const client = await getClientLookup(ctx, clientId);
    return NextResponse.json({ ...context, client }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
