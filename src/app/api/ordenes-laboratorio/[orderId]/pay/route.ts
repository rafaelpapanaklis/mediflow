import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createPreference } from "@/lib/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/ordenes-laboratorio/[orderId]/pay — la clínica inicia el pago con
// MercadoPago de una orden de laboratorio. Scope clinicId de SESIÓN (nunca del
// body). Crea una preferencia de checkout en la cuenta del lab (token POR
// VENDEDOR → el cobro va directo a su cuenta), guarda mpPreferenceId y devuelve
// { initPoint } para redirigir al comprador. El webhook compartido
// (?ref=lab:<orderId>) marca la orden PAID cuando MercadoPago aprueba el pago.
export async function POST(req: NextRequest, { params }: { params: { orderId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Multi-tenant: la orden debe pertenecer a ESTA clínica.
  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    include: {
      lab: { select: { name: true, payMercadoPagoEnabled: true, mpAccessToken: true } },
      service: { select: { name: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ error: "Esta orden ya está pagada." }, { status: 409 });
  }

  const token = order.lab?.mpAccessToken;
  if (!order.lab?.payMercadoPagoEnabled || !token) {
    return NextResponse.json(
      { error: "Este laboratorio no acepta pagos con MercadoPago." },
      { status: 400 },
    );
  }
  if (!(order.total > 0)) {
    return NextResponse.json(
      { error: "El total de la orden no es válido para cobro." },
      { status: 400 },
    );
  }

  // base = URL pública de la app. Fallback final al origin del request (igual
  // que las rutas de billing) para no generar URLs relativas que MercadoPago
  // no podría alcanzar si las env vars no estuvieran configuradas.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    new URL(req.url).origin;
  const detailUrl = `${base}/dashboard/ordenes-laboratorio/${order.id}`;
  const title = order.service?.name ?? `Orden ${order.orderNumber}`;

  try {
    const pref = await createPreference(token, {
      items: [{ title, quantity: 1, unit_price: order.total }],
      externalReference: order.id,
      notificationUrl: `${base}/api/webhooks/mercadopago?ref=lab:${order.id}`,
      backUrls: { success: detailUrl, failure: detailUrl, pending: detailUrl },
    });

    await prisma.dentalLabOrder.update({
      where: { id: order.id },
      data: { mpPreferenceId: pref.id },
    });

    return NextResponse.json({ initPoint: pref.initPoint });
  } catch (err) {
    console.error("MercadoPago lab pay error:", err);
    return NextResponse.json(
      { error: "No se pudo iniciar el pago con MercadoPago. Intenta de nuevo." },
      { status: 502 },
    );
  }
}
