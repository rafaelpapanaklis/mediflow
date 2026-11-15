import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, createSale } from "@/lib/barber/cash";
import { getProductOrder, tiendaPanelError } from "@/lib/barber/tienda";
import { TiendaError } from "@/lib/barber/tienda-core";

export const dynamic = "force-dynamic";

// POST /api/barber/product-orders/[id]/deliver → ENTREGAR un pedido ya
// pagado en línea. No cobra: registra en Caja la venta como «Pago en línea»
// (STRIPE: fuera del efectivo del turno, dentro de los reportes), con las
// piezas y el precio del pedido, por el MISMO createSale (que lo marca
// entregado en su transacción, una sola vez). Turno abierto + cash.manage.
// Un pedido SIN pagar no pasa por aquí: se cobra con el ticket de Caja.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const features = await assertBarberFeature(ctx, "cash");
    const order = await getProductOrder(ctx, params.id);
    if (!order.paidOnline) throw new TiendaError(409, "ORDER_NOT_PAID", "Ese pedido no se ha pagado en línea: cóbralo con el ticket de Caja.");
    const sale = await createSale(
      ctx,
      {
        productOrderId: order.id,
        clientId: order.clientId,
        items: order.items.map((it) => ({ kind: "product" as const, id: it.productId, qty: it.qty })),
        paymentMethod: "STRIPE",
        notes: `Pedido en línea ${order.folio}`,
      },
      features,
    );
    return NextResponse.json(sale, { status: 201 });
  } catch (e) {
    return tiendaPanelError(e);
  }
}
