import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface BillingInvoiceRow {
  id: string;
  date: string;          // ISO
  amount: number;        // unidades enteras (MXN, USD, etc.)
  currency: string;      // upper-case
  status: "paid" | "pending" | "overdue" | "failed" | "void";
  description: string;
  source: "stripe" | "local";
  downloadUrl: string | null;
  paymentUrl: string | null;
}

interface BillingInvoicesResponse {
  invoices: BillingInvoiceRow[];
  stripeUnavailable: boolean;
}

/**
 * GET /api/billing/invoices
 *
 * Lista las facturas de la suscripción de la clínica del usuario
 * activo. Combina:
 *  1. SubscriptionInvoice de la BD local (registro persistente).
 *  2. Las últimas 24 facturas de Stripe vía `stripe.invoices.list`
 *     filtradas por `customer = clinic.stripeCustomerId`.
 *
 * Si Stripe no está configurado (o la clínica no tiene customer),
 * devuelve solo las locales con `stripeUnavailable: true`. Nunca arroja
 * 500 por falta de keys.
 *
 * Multi-tenant: clinicId del ctx, todas las queries scoped.
 */
export async function GET() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const [clinic, localRows] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { stripeCustomerId: true },
    }),
    prisma.subscriptionInvoice.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const localInvoices: BillingInvoiceRow[] = localRows.map((r) => ({
    id: `local:${r.id}`,
    date: (r.paidAt ?? r.createdAt).toISOString(),
    amount: r.amount,
    currency: (r.currency ?? "MXN").toUpperCase(),
    status: normalizeStatus(r.status),
    description: r.notes ?? `Plan — ${formatPeriod(r.periodStart, r.periodEnd)}`,
    source: "local",
    downloadUrl: null,
    paymentUrl: null,
  }));

  const stripe = getStripeSafe();
  if (!stripe || !clinic?.stripeCustomerId) {
    const response: BillingInvoicesResponse = {
      invoices: localInvoices,
      stripeUnavailable: !stripe,
    };
    return NextResponse.json(response);
  }

  let stripeInvoices: BillingInvoiceRow[] = [];
  try {
    const list = await stripe.invoices.list({
      customer: clinic.stripeCustomerId,
      limit: 24,
    });
    stripeInvoices = list.data.map((inv) => ({
      id: `stripe:${inv.id}`,
      date: new Date(((inv.status_transitions?.paid_at ?? inv.created)) * 1000).toISOString(),
      amount: (inv.amount_due ?? inv.amount_paid ?? inv.total ?? 0) / 100,
      currency: (inv.currency ?? "mxn").toUpperCase(),
      status: normalizeStatus(inv.status ?? "open"),
      description:
        inv.lines.data[0]?.description ??
        inv.description ??
        `Suscripción — ${new Date(inv.created * 1000).toLocaleDateString("es-MX", { month: "long", year: "numeric" })}`,
      source: "stripe",
      downloadUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null,
      paymentUrl: (inv.status === "open" || inv.status === "uncollectible") ? (inv.hosted_invoice_url ?? null) : null,
    }));
  } catch (e) {
    console.error("[billing/invoices] stripe list error:", e);
    // Fallback silencioso a solo locales — no es razón para reventar.
  }

  // Mezclamos. Las de Stripe son la fuente canónica para suscripciones
  // pagadas con tarjeta; las locales pueden cubrir SPEI manuales que no
  // tocaron Stripe. Ordenamos por fecha desc y devolvemos.
  const merged = [...stripeInvoices, ...localInvoices].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const response: BillingInvoicesResponse = {
    invoices: merged,
    stripeUnavailable: false,
  };
  return NextResponse.json(response);
}

function normalizeStatus(raw: string): BillingInvoiceRow["status"] {
  const s = raw.toLowerCase();
  if (s === "paid") return "paid";
  if (s === "void" || s === "voided") return "void";
  if (s === "failed" || s === "uncollectible") return "failed";
  if (s === "overdue") return "overdue";
  return "pending"; // open, draft, pending, etc.
}

function formatPeriod(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" });
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return fmt.format(start);
  }
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}
