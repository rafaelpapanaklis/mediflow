import { NextRequest, NextResponse } from "next/server";
import { verificarFirmaMp } from "@/lib/mercadopago-firma";
import { aplicarPagoDePedido } from "@/lib/barber/mercadopago";
import { afterResponse, onTiendaOrderPaid } from "@/lib/barber/tienda-pedido-nuevo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/mercadopago/webhook — ws6-t5.
 *
 * El `notification_url` de las preferencias de la TIENDA de barber:
 * `?pedido=<id del pedido>&cta=<cuenta que cobra>`; Mercado Pago añade
 * `&data.id=<pago>&type=payment`. Es OTRO endpoint que el del dental
 * (/api/webhooks/mercadopago), que no se toca ni cambia.
 *
 * Mismo contrato de respuestas que el dental (Mercado Pago SOLO reintenta si
 * no respondemos 2xx):
 *  · 200 — procesado, o descartado por causa determinista (no es de barber,
 *    no es un pago, pedido inexistente, pago de otra cuenta, importe o moneda
 *    distintos, ya aplicado).
 *  · 401 — x-signature inválida o ausente (firma verificada IGUAL que el
 *    dental: src/lib/mercadopago-firma.ts, mismo MERCADOPAGO_WEBHOOK_SECRET).
 *  · 503 — falta MERCADOPAGO_WEBHOOK_SECRET: falla cerrado; MP reintenta.
 *  · 500 — transitorio (red, 5xx de MP, base, cuenta que no se puede leer):
 *    MP reintenta y el UPDATE condicionado evita marcar dos veces.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (body as { data?: { id?: unknown } }).data;
  const requestId = req.headers.get("x-request-id");

  const firma = verificarFirmaMp({
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    signature: req.headers.get("x-signature"),
    requestId,
    dataIdQuery: url.searchParams.get("data.id"),
    dataIdBody: data?.id,
  });
  if ("motivo" in firma) {
    if (firma.motivo === "sin_secreto") {
      console.error("[barber-mp] webhook: MERCADOPAGO_WEBHOOK_SECRET no está configurado; aviso rechazado (503)");
      return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
    }
    console.error(`[barber-mp] webhook: x-signature inválida (${firma.motivo}) · x-request-id=${requestId ?? "-"}`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Solo los pagos mueven algo. merchant_order y demás: 200 sin procesar.
  const tipo =
    texto(url.searchParams.get("type")) ??
    texto(url.searchParams.get("topic")) ??
    texto(body.type) ??
    texto(body.topic);
  if (tipo && tipo !== "payment") return NextResponse.json({ received: true });

  // Sin `pedido` en la query no es un aviso de la tienda de barber: 200 y nada.
  const pedido = texto(url.searchParams.get("pedido"));
  if (!pedido) return NextResponse.json({ received: true });

  try {
    const pago = await aplicarPagoDePedido({
      orderId: pedido,
      paymentId: firma.paymentId,
      cuentaDelLink: texto(url.searchParams.get("cta")),
    });
    // «Te pagaron un pedido»: el aviso al dueño (ws6-t6). Solo cuando ESTE
    // aviso de Mercado Pago marcó el pedido (aplicado pasa una sola vez; un
    // reintento vuelve «ya aplicado») y, además, el aviso es idempotente por
    // pedido. Corre después de contestarle a Mercado Pago y nunca lanza.
    if (pago.aplicado) afterResponse(() => onTiendaOrderPaid(pedido));
  } catch (err) {
    console.error("[barber-mp] webhook error (transitorio, MP reintentará):", (err as Error).message);
    return NextResponse.json({ error: "transient failure" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
