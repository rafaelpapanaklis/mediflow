import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPayment } from "@/lib/mercadopago";
import { verifyAndCreditMpTopup } from "@/lib/ai-wallet/mercadopago";
import { aplicarPagoDeAnticipo } from "@/lib/anticipos/servicio.server";
import { aplicarPagoDeFactura } from "@/lib/factura-mp/servicio.server";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { verificarFirmaMp } from "@/lib/mercadopago-firma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook COMPARTIDO labs + proveedores + recargas del monedero IA + anticipos
// de cita por WhatsApp + links de pago de facturas. MercadoPago llama el
// notification_url con `?ref=lab:<orderId>` / `?ref=sup:<orderId>` /
// `?ref=aitopup:<topupId>` / `?ref=anticipo:<depositId>` /
// `?ref=factura:<linkId>` + el id del pago en el body `data.id` (o `id`).
// Cada vendedor cobra a su propia cuenta, así que el token con el que
// consultamos el pago sale de la orden (lab/supplier) o de la clínica
// (anticipo, factura), nunca del body.
//
// Códigos de respuesta (MercadoPago SOLO reintenta si NO respondemos 2xx):
//  · 200 — procesado O descartado por causa DETERMINISTA (ref/payload inválido,
//    pago inexistente o 4xx, no aprobado, ref que no coincide, monto
//    insuficiente): reintentar la misma notificación no cambiaría nada.
//  · 401 — x-signature inválida, ausente, sin data.id en la query o con un id
//    en el body distinto al firmado: MP reintenta y el fallo queda visible en su
//    dashboard (un 200 silencioso perdería pagos reales si el secret quedó mal
//    configurado).
//  · 503 — falta MERCADOPAGO_WEBHOOK_SECRET (B8, auditoría 30-sep-2026): falla
//    cerrado. Es configuración nuestra: MP reintenta y nada se pierde al ponerlo.
//  · 500 — fallo TRANSITORIO (red hacia MP, 5xx/429 de MP, lectura/escritura a
//    DB): MP reintenta y el flip idempotente PENDING→PAID evita doble crédito.
export async function POST(req: NextRequest) {
  const url = new URL(req.url);

  // El cuerpo se lee ANTES de verificar: la firma cubre el `data.id` de la query
  // y el pago que se procesa tiene que ser ESE (B8, auditoría 30-sep-2026).
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const data = (body as { data?: { id?: unknown } }).data;

  // ── 0. Firma HMAC. Sin MERCADOPAGO_WEBHOOK_SECRET el webhook RECHAZA (falla
  // cerrado): 503 y no 401 porque es una mala configuración nuestra, no una
  // firma falsa; MP reintenta y no se pierde ningún pago al configurarla.
  const firma = verificarFirmaMp({
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    signature: req.headers.get("x-signature"),
    requestId: req.headers.get("x-request-id"),
    dataIdQuery: url.searchParams.get("data.id"),
    idsDelBody: [data?.id as string | number | undefined, (body as { id?: string | number }).id],
  });
  if ("motivo" in firma) {
    if (firma.motivo === "sin_secreto") {
      console.error("MercadoPago webhook: MERCADOPAGO_WEBHOOK_SECRET no está configurado; notificación rechazada (503)");
      return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
    }
    console.error(`MercadoPago webhook: x-signature inválida (${firma.motivo}); notificación rechazada`);
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

  // id del pago: el FIRMADO (data.id de la query); el body solo se contrastó arriba.
  const paymentId = firma.paymentId;

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

    // ── Anticipo de cita por WhatsApp (WS1-T5) ───────────────────────────────
    // Cobra la CLÍNICA, con el token OAuth de su cuenta. El pago se re-consulta
    // a MP con ese token (nada del body se cree), se exige approved + ref exacto
    // + monto + cuenta que cobró, y el saldo a favor se crea una sola vez por
    // pago (índice único de mpPaymentId). Lanza solo en lo transitorio → 500.
    if (kind === "anticipo") {
      if (orderId && paymentId) {
        await aplicarPagoDeAnticipo(orderId, paymentId);
      }
      return NextResponse.json({ received: true });
    }

    // ── Link de pago de una factura (ws1-t1) ─────────────────────────────────
    // Mismo rail que el anticipo: cobra la CLÍNICA con su token OAuth, el pago se
    // re-consulta a MP y se registra UNA vez como Payment "mercadopago" (dedup
    // por la referencia del pago bajo FOR UPDATE de la factura). Lanza solo en
    // lo transitorio → 500.
    if (kind === "factura") {
      if (orderId && paymentId) {
        const r = await aplicarPagoDeFactura(orderId, paymentId);
        if (r.aplicado) {
          try {
            revalidateAfter("invoices");
          } catch {
            // Refrescar la caché de Caja no puede tumbar un pago ya registrado.
          }
        }
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

// La verificación de x-signature vive en src/lib/mercadopago-firma.ts (verificarFirmaMp).
