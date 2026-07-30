import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { isAdminAuthed } from "@/lib/admin-auth";
import { recordStripeInvoice } from "@/lib/billing/record-stripe-invoice";

/**
 * POST /api/admin/billing/backfill-stripe
 *
 * Importa a `subscription_invoices` los cobros de Stripe que ya ocurrieron
 * antes de que el webhook aprendiera a registrarlos (ver
 * @/lib/billing/record-stripe-invoice). Es la contraparte histórica del fix:
 * sin esto, "Cobrado este mes" ignora todo lo cobrado hasta hoy.
 *
 * SOLO LECTURA sobre Stripe: únicamente `invoices.list`. No crea, no cobra,
 * no reembolsa y no modifica NADA en Stripe.
 *
 * Idempotente: reusa recordStripeInvoice (upsert por reference=invoice.id),
 * así que correrlo dos veces no duplica ni pisa filas existentes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tope duro de facturas a recorrer (evita agotar el maxDuration en silencio). */
const MAX_INVOICES = 1000;

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripeSafe();
  if (!stripe) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  const body = await req.json().catch(() => ({} as any));
  const rawMonths = Number(body?.months);
  const months = Number.isFinite(rawMonths) && rawMonths > 0 ? Math.min(Math.floor(rawMonths), 36) : 6;

  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const createdGte = Math.floor(since.getTime() / 1000);

  try {
    // Mapa stripeCustomerId → clinicId de una sola query (en vez de una por
    // factura). Las facturas de un customer sin clínica se reportan aparte.
    const clinics = await prisma.clinic.findMany({
      where: { stripeCustomerId: { not: null } },
      select: { id: true, stripeCustomerId: true },
    });
    const clinicByCustomer = new Map<string, string>();
    for (const c of clinics) {
      if (c.stripeCustomerId) clinicByCustomer.set(c.stripeCustomerId, c.id);
    }

    let scanned = 0;
    let inserted = 0;
    let skipped = 0;
    let truncated = false;
    const unmatched = new Set<string>();

    await stripe.invoices
      .list({ status: "paid", created: { gte: createdGte }, limit: 100 })
      .autoPagingEach(async (invoice) => {
        if (scanned >= MAX_INVOICES) {
          truncated = true;
          return false; // corta la paginación
        }
        scanned++;

        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;
        const clinicId = customerId ? clinicByCustomer.get(customerId) ?? null : null;

        if (!clinicId) {
          skipped++;
          if (customerId) unmatched.add(customerId);
          return;
        }

        const { created } = await recordStripeInvoice(invoice, clinicId);
        if (created) inserted++;
        else skipped++;
      });

    console.log("[admin/billing/backfill-stripe]", {
      months, scanned, inserted, skipped, unmatched: unmatched.size, truncated,
    });

    return NextResponse.json({
      scanned,
      inserted,
      skipped,
      unmatched: Array.from(unmatched),
      months,
      // true = se alcanzó el tope de MAX_INVOICES y quedaron facturas sin
      // recorrer; hay que volver a correrlo con un rango menor.
      truncated,
    });
  } catch (err: any) {
    console.error("[admin/billing/backfill-stripe] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "No se pudo importar de Stripe" },
      { status: 500 },
    );
  }
}
