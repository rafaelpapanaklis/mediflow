import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ── Stripe (connect when you have account) ────────────────────────────────────
async function createStripeSession(invoice: any, returnUrl: string) {
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "payment_method_types[]":     "card",
      "line_items[0][price_data][currency]":            "mxn",
      "line_items[0][price_data][unit_amount]":         String(Math.round(invoice.balance * 100)),
      "line_items[0][price_data][product_data][name]":  `Pago — ${invoice.concept ?? "Tratamiento dental"}`,
      "line_items[0][quantity]":    "1",
      mode:                         "payment",
      success_url:                  `${returnUrl}?payment=success`,
      cancel_url:                   `${returnUrl}?payment=cancelled`,
      "metadata[invoiceId]":        invoice.id,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Stripe error");
  return { url: data.url, provider: "stripe" };
}

// ── Mercado Pago (connect when you have account) ──────────────────────────────
async function createMercadoPagoPreference(invoice: any, returnUrl: string) {
  const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN not configured");

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{
        title:      invoice.concept ?? "Tratamiento dental",
        quantity:   1,
        unit_price: invoice.balance,
        currency_id: "MXN",
      }],
      back_urls: {
        success: `${returnUrl}?payment=success`,
        failure: `${returnUrl}?payment=failed`,
        pending: `${returnUrl}?payment=pending`,
      },
      auto_return:  "approved",
      external_reference: invoice.id,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "MercadoPago error");
  return { url: data.init_point, provider: "mercadopago" };
}

// ── POST /api/portal/pay ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { token, invoiceId, provider } = await req.json();

    // Verify patient token
    const patient = await prisma.patient.findFirst({ where: { portalToken: token } });
    if (!patient) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

    // Get invoice
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, patientId: patient.id },
    });
    if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    if (invoice.balance <= 0) return NextResponse.json({ error: "Esta factura ya está pagada" }, { status: 400 });

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${token}`;

    let result;
    if (provider === "stripe") {
      result = await createStripeSession(invoice, returnUrl);
    } else if (provider === "mercadopago") {
      result = await createMercadoPagoPreference(invoice, returnUrl);
    } else {
      return NextResponse.json({ error: "Provider inválido. Usa 'stripe' o 'mercadopago'" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Portal pay error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
