import { NextResponse } from "next/server";
import { assertBarberPermission, getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature } from "@/lib/barber/cash";
import { tiendaPanelError } from "@/lib/barber/tienda";
import { countOrdersNotice } from "@/lib/barber/tienda-avisos";

export const dynamic = "force-dynamic";

// GET /api/barber/product-orders/pending → { count: n } — cuántos pedidos de
// la tienda piden acción en la sede en sesión. Es lo ÚNICO que necesita el
// numerito de «Productos» del menú (lo pide al navegar y cada minuto).
//
// MISMA regla que la pestaña Pedidos y la tarjeta de Inicio (tienda-core.ts,
// orderNeedsAction). Solo lee.
//
// MISMO candado que GET /api/barber/product-orders: plan con productos +
// products.view (sin él, 403: a quien se le quitó el permiso no le contesta
// ni un número). Sin la tabla de pedidos (sql/barber_tienda.sql sin pegar)
// responde 0: el menú no pinta nada y nada truena.
export async function GET() {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const features = await assertBarberFeature(ctx, "products");
    assertBarberPermission(ctx, "products.view");
    const count = await countOrdersNotice(ctx, features);
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return tiendaPanelError(e);
  }
}
