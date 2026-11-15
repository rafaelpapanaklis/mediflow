import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature } from "@/lib/barber/cash";
import { cancelProductOrder, getProductOrder, markProductOrderReady, tiendaPanelError } from "@/lib/barber/tienda";

export const dynamic = "force-dynamic";

// GET   /api/barber/product-orders/[id] → el pedido (products.view).
// PATCH /api/barber/product-orders/[id] { action: "ready" | "cancel", refundConfirmed? }
//   «Listo para recoger» o «Cancelar» (products.view + cash.manage). Cancelar
//   uno pagado en línea exige refundConfirmed: el reembolso se hace en
//   Mercado Pago, aquí no se devuelve dinero.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    return NextResponse.json(await getProductOrder(ctx, params.id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return tiendaPanelError(e);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; refundConfirmed?: unknown };
    if (body.action === "ready") return NextResponse.json(await markProductOrderReady(ctx, params.id));
    if (body.action === "cancel") return NextResponse.json(await cancelProductOrder(ctx, params.id, { refundConfirmed: body.refundConfirmed }));
    return NextResponse.json({ error: "Acción inválida", code: "INVALID_INPUT" }, { status: 400 });
  } catch (e) {
    return tiendaPanelError(e);
  }
}
