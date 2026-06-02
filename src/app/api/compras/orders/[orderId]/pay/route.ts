import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createPreference } from "@/lib/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/compras/orders/[orderId]/pay — arranca un checkout de MercadoPago
// para una orden de la clínica. Scope SIEMPRE por clinicId de la sesión.
// El cobro va directo a la cuenta del proveedor (su mpAccessToken). El webhook
// /api/webhooks/mercadopago?ref=sup:<orderId> es quien marca la orden PAID.
export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // clinicId de la sesión → una clínica jamás paga la orden de otra.
  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    include: { supplier: true },
  });
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ error: "Este pedido ya está pagado." }, { status: 409 });
  }

  const supplier = order.supplier;
  if (!supplier.payMercadoPagoEnabled || !supplier.mpAccessToken) {
    return NextResponse.json(
      { error: "El proveedor no acepta pagos con MercadoPago." },
      { status: 409 },
    );
  }

  // MercadoPago exige back_urls/notification_url absolutas (auto_return=approved).
  // Sin una base configurada produciríamos URLs relativas y MP rechazaría la
  // preferencia con un error opaco; mejor fallar claro acá.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    return NextResponse.json(
      { error: "La URL base de la app no está configurada." },
      { status: 500 },
    );
  }
  const detailUrl = `${base}/dashboard/compras/${order.id}`;

  try {
    const pref = await createPreference(supplier.mpAccessToken, {
      items: [{ title: `Orden ${order.orderNumber}`, quantity: 1, unit_price: order.total }],
      externalReference: order.id,
      notificationUrl: `${base}/api/webhooks/mercadopago?ref=sup:${order.id}`,
      backUrls: { success: detailUrl, failure: detailUrl, pending: detailUrl },
    });

    await prisma.supplierOrder.update({
      where: { id: order.id },
      data: { mpPreferenceId: pref.id },
    });

    return NextResponse.json({ initPoint: pref.initPoint });
  } catch (err) {
    console.error("createPreference (supplier order) error:", err);
    return NextResponse.json(
      { error: "No se pudo iniciar el pago con MercadoPago." },
      { status: 502 },
    );
  }
}
