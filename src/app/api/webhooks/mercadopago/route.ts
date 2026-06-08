import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPayment } from "@/lib/mercadopago";
import { verifyAndCreditMpTopup } from "@/lib/ai-wallet/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook COMPARTIDO labs + proveedores. MercadoPago llama el notification_url con
// `?ref=lab:<orderId>` o `?ref=sup:<orderId>` (lo agregan T2/T3 al crear la preferencia)
// + el id del pago en el body `data.id` (o `id`). Cada vendedor cobra a su propia cuenta,
// así que el token con el que consultamos el pago sale de la orden (lab/supplier), nunca del body.
// Mínimo a propósito: solo voltea la orden a PAID; sin modelos de eventos.
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // 1. ref de la query → kind + orderId
    const ref = url.searchParams.get("ref");
    if (!ref || !ref.includes(":")) {
      return NextResponse.json({ received: true });
    }
    const idx = ref.indexOf(":");
    const kind = ref.slice(0, idx);
    const orderId = ref.slice(idx + 1);

    // id del pago: body data.id / id, con fallback a query
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const data = (body as { data?: { id?: unknown } }).data;
    const rawPaymentId =
      data?.id ??
      (body as { id?: unknown }).id ??
      url.searchParams.get("data.id") ??
      url.searchParams.get("id");
    const paymentId = rawPaymentId == null ? "" : String(rawPaymentId);

    // ── Recarga del monedero de IA (T4) ──────────────────────────────────────
    // Rama propia: MediFlow cobra ESTA recarga con su token de PLATAFORMA (no el
    // del vendedor). Se distingue por el ref "aitopup:<topupId>". Verifica el pago
    // y acredita de forma atómica/idempotente. Deja intacto el flujo B2B de abajo.
    if (kind === "aitopup") {
      if (orderId && paymentId) {
        await verifyAndCreditMpTopup(orderId, paymentId);
      }
      return NextResponse.json({ received: true });
    }

    if (!orderId || !paymentId || (kind !== "lab" && kind !== "sup")) {
      return NextResponse.json({ received: true });
    }

    // 2. Cargar la orden + su vendedor (token por vendedor)
    if (kind === "lab") {
      const order = await prisma.dentalLabOrder.findUnique({
        where: { id: orderId },
        include: { lab: true },
      });
      const token = order?.lab?.mpAccessToken;
      if (!order || !token) return NextResponse.json({ received: true });

      // 3. Verificar el pago contra la cuenta del vendedor
      const pay = await getPayment(token, paymentId);
      if (
        pay.status === "approved" &&
        pay.externalReference === orderId &&
        order.paymentStatus !== "PAID"
      ) {
        await prisma.dentalLabOrder.update({
          where: { id: orderId },
          data: {
            paymentStatus: "PAID",
            paidAt: new Date(),
            mpPaymentId: paymentId,
            paymentMethod: "MERCADOPAGO",
          },
        });
      }
    } else {
      const order = await prisma.supplierOrder.findUnique({
        where: { id: orderId },
        include: { supplier: true },
      });
      const token = order?.supplier?.mpAccessToken;
      if (!order || !token) return NextResponse.json({ received: true });

      const pay = await getPayment(token, paymentId);
      if (
        pay.status === "approved" &&
        pay.externalReference === orderId &&
        order.paymentStatus !== "PAID"
      ) {
        await prisma.supplierOrder.update({
          where: { id: orderId },
          data: {
            paymentStatus: "PAID",
            paidAt: new Date(),
            mpPaymentId: paymentId,
            paymentMethod: "MERCADOPAGO",
          },
        });
      }
    }
  } catch (err) {
    // Nunca propagamos: si devolvemos !=200, MercadoPago reintenta en bucle.
    console.error("MercadoPago webhook error:", err);
  }

  // 4. SIEMPRE 200 (idempotente)
  return NextResponse.json({ received: true });
}
