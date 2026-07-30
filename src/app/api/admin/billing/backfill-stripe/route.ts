import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { isAdminAuthed } from "@/lib/admin-auth";
import { recordStripeInvoice } from "@/lib/billing/record-stripe-invoice";

/**
 * POST /api/admin/billing/backfill-stripe
 *
 * Importa a `subscription_invoices` los cobros de Stripe —cobrados Y
 * rechazados— que ya ocurrieron antes de que el webhook aprendiera a
 * registrarlos (ver @/lib/billing/record-stripe-invoice). Es la contraparte
 * histórica del fix: sin esto, "Cobrado este mes" ignora todo lo cobrado
 * hasta hoy y el "por cobrar" ignora todo lo que se rechazó.
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

/**
 * Status de Stripe en los que vive un COBRO RECHAZADO. La API fijada en
 * @/lib/stripe (2024-06-20) no expone un status "failed": la factura cuyo
 * cargo se rechaza sigue "open" mientras Stripe reintenta, y pasa a
 * "uncollectible" cuando se da por perdida. Se filtran por `attempted` para
 * no confundirlas con una factura recién emitida.
 */
const FAILED_INVOICE_STATUSES = ["open", "uncollectible"] as const;
type FailableInvoiceStatus = "paid" | (typeof FAILED_INVOICE_STATUSES)[number];

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
    let insertedFailed = 0;
    let promoted = 0;
    let skipped = 0;
    let truncated = false;
    const unmatched = new Set<string>();

    // Una pasada por status de Stripe. El tope MAX_INVOICES y el maxDuration
    // son COMPARTIDOS entre pasadas: si la primera los agota, las siguientes
    // ni arrancan y la respuesta sale con truncated:true.
    const runPass = async (status: FailableInvoiceStatus, outcome: "paid" | "failed") => {
      if (truncated) return;
      await stripe.invoices
        .list({ status, created: { gte: createdGte }, limit: 100 })
        .autoPagingEach(async (invoice) => {
          if (scanned >= MAX_INVOICES) {
            truncated = true;
            return false; // corta la paginación
          }
          scanned++;

          // Una factura "open" solo es un COBRO FALLIDO si Stripe ya intentó
          // cobrarla (`attempted`). Una recién emitida, o de cortesía
          // (amount_due 0), todavía no es dinero rechazado.
          if (outcome === "failed" && (!invoice.attempted || (invoice.amount_due ?? 0) <= 0)) {
            skipped++;
            return;
          }

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

          const res = await recordStripeInvoice(invoice, clinicId, outcome);
          if (res.created) {
            if (outcome === "failed") insertedFailed++;
            else inserted++;
          } else {
            if (res.promoted) promoted++;
            skipped++;
          }
        });
    };

    // 1) Las cobradas. 2) Las fallidas: la API 2024-06-20 no tiene un status
    //    "failed" — una factura rechazada se queda en "open" (Stripe sigue
    //    reintentando) o acaba en "uncollectible" (se dio por perdida).
    await runPass("paid", "paid");
    for (const status of FAILED_INVOICE_STATUSES) {
      await runPass(status, "failed");
    }

    console.log("[admin/billing/backfill-stripe]", {
      months, scanned, inserted, insertedFailed, promoted, skipped,
      unmatched: unmatched.size, truncated,
    });

    return NextResponse.json({
      scanned,
      inserted,
      // Cobros rechazados importados (status "failed" en subscription_invoices).
      insertedFailed,
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
