import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature } from "@/lib/barber/cash";
import { listProductOrders, tiendaPanelError } from "@/lib/barber/tienda";

export const dynamic = "force-dynamic";

// GET /api/barber/product-orders → pedidos de la tienda de la sede en sesión
// (vivos primero) + contador de nuevos. products.view (Recepción sí; Barbero
// no). Antes de barre lo vencido (72 h sin pagar ni recoger).
export async function GET() {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const list = await listProductOrders(ctx);
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return tiendaPanelError(e);
  }
}
