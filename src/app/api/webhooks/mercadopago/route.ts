import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPayment } from "@/lib/mercadopago";
import { verifyAndCreditMpTopup } from "@/lib/ai-wallet/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook COMPARTIDO labs + proveedores + recargas del monedero IA. MercadoPago
// llama el notification_url con `?ref=lab:<orderId>` / `?ref=sup:<orderId>` /
// `?ref=aitopup:<topupId>` + el id del pago en el body `data.id` (o `id`). Cada
// vendedor cobra a su propia cuenta, así que el token con el que consultamos el
// pago sale de la orden (lab/supplier), nunca del body.
//
// Códigos de respuesta (MercadoPago SOLO reintenta si NO respondemos 2xx):
//  · 200 — procesado O descartado por causa DETERMINISTA (ref/payload inválido,
//    pago inexistente o 4xx, no aprobado, ref que no coincide, monto
//    insuficiente): reintentar la misma notificación no cambiaría nada.
//  · 401 — x-signature inválida TENIENDO secret configurado: MP reintenta y el
//    fallo queda visible en su dashboard (un 200 silencioso perdería pagos
//    reales si el secret quedó mal configurado).
//  · 500 — fallo TRANSITORIO (red hacia MP, 5xx/429 de MP, lectura/escritura a
//    DB): MP reintenta y el flip idempotente PENDING→PAID evita doble crédito.
export async function POST(req: NextRequest) {
  const url = new URL(req.url);

  // ── 0. Firma HMAC (solo si MERCADOPAGO_WEBHOOK_SECRET está en el env)
  if (!verifyMpSignature(req, url)) {
    console.error("MercadoPago webhook: x-signature inválida; notificación rechazada");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // ── 1. ref de la query → kind + orderId
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

  try {
    // ── Recarga del monedero de IA (T4) ──────────────────────────────────────
    // Rama propia: DaleControl cobra ESTA recarga con su token de PLATAFORMA (no el
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

    // ── 2. Cargar la orden + su vendedor (token por vendedor)
    if (kind === "lab") {
      const order = await prisma.dentalLabOrder.findUnique({
        where: { id: orderId },
        include: { lab: true },
      });
      const token = order?.lab?.mpAccessToken;
      if (!order || !token) return NextResponse.json({ received: true });

      // ── 3. Verificar el pago contra la cuenta del vendedor: aprobado + ref
      // exacto + MONTO pagado que cubra el total (sin el monto, un pago real de
      // $1 con el external_reference correcto marcaría pagada una orden de $10,000).
      const pay = await getPayment(token, paymentId);
      if (
        pay != null &&
        pay.status === "approved" &&
        pay.externalReference === orderId &&
        pay.transactionAmount != null &&
        pay.transactionAmount >= Number(order.total) &&
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
        pay != null &&
        pay.status === "approved" &&
        pay.externalReference === orderId &&
        pay.transactionAmount != null &&
        pay.transactionAmount >= Number(order.total) &&
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
    // Aquí SOLO llegan fallas TRANSITORIAS (getPayment lanza únicamente por
    // red/5xx/429; Prisma lanza por DB). Respondemos 500 para que MercadoPago
    // REINTENTE y el pago aprobado no quede PENDING para siempre (antes se
    // respondía 200 SIEMPRE y un fallo de red perdía la notificación; MP no
    // reintenta tras un 200). Los descartes deterministas retornan 200 arriba
    // y nunca lanzan; el claim/flip idempotente evita doble acreditación.
    console.error("MercadoPago webhook error (transitorio, MP reintentará):", err);
    return NextResponse.json({ error: "transient failure" }, { status: 500 });
  }

  // ── 4. 200 (procesado o descartado de forma determinista; idempotente)
  return NextResponse.json({ received: true });
}

// ── Firma x-signature de MercadoPago (HMAC-SHA256) ──────────────────────────
// Manifest oficial de MP: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// donde cada parte PRESENTE termina en ";", el data.id firmado es el de la
// QUERY STRING (no el del body) y si es alfanumérico va en minúsculas. El
// header x-signature trae "ts=<unix>,v1=<hmac-hex>".
//
// Comportamiento: si MERCADOPAGO_WEBHOOK_SECRET NO está en el env, NO se
// valida nada (no rompemos prod; la re-consulta del pago a la API de MP sigue
// siendo la capa de verdad). Con el secret configurado, firma ausente o
// inválida → 401: MP reintenta y el fallo es visible en su dashboard, en vez
// de descartar pagos reales en silencio con un 200.
function verifyMpSignature(req: NextRequest, url: URL): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return true;

  const header = req.headers.get("x-signature") ?? "";
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const dataId = url.searchParams.get("data.id");
  const requestId = req.headers.get("x-request-id");
  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const got = Buffer.from(v1, "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
