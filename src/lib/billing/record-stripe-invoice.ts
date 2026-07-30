import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";

/**
 * Registra en `subscription_invoices` una factura PAGADA de Stripe.
 *
 * Por qué existe: la tabla `subscription_invoices` es la ÚNICA fuente de
 * "Cobrado este mes" (/admin), de /admin/payments y de /admin/reports. Hasta
 * ahora solo se llenaba a mano desde /api/admin/subscriptions, así que todo
 * cobro real de Stripe era invisible en el panel.
 *
 * IDEMPOTENCIA: Stripe dispara `invoice.paid` Y `invoice.payment_succeeded`
 * para la MISMA factura (y reintenta los webhooks). El candado es
 * `reference` (@unique en el schema + índice único parcial en la BD): el
 * upsert con `update: {}` deja intacta la fila que ya existía.
 *
 * NUNCA lanza: un fallo aquí no puede tumbar el 200 del webhook ni la lógica
 * de correos/afiliado que corre a su lado.
 */
export async function recordStripeInvoice(
  invoice: Stripe.Invoice,
  clinicId: string,
): Promise<{ created: boolean }> {
  try {
    const reference = invoice.id;
    if (!reference || !clinicId) return { created: false };

    // Periodo facturado: la primera línea de la factura. Si Stripe no la manda
    // (facturas sueltas / one-off), caemos a `created` + 1 mes — mismo
    // ONE_MONTH_MS que ya usa el webhook para nextBillingDate.
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const period = invoice.lines?.data?.[0]?.period ?? null;
    const createdMs = (invoice.created ?? Math.floor(Date.now() / 1000)) * 1000;
    const periodStart = period?.start ? new Date(period.start * 1000) : new Date(createdMs);
    const periodEnd = period?.end
      ? new Date(period.end * 1000)
      : new Date(periodStart.getTime() + ONE_MONTH_MS);

    const paidAtSec = invoice.status_transitions?.paid_at ?? null;
    const notes = `Stripe ${invoice.billing_reason ?? ""} ${invoice.number ?? ""}`.trim();

    // Solo para el flag de retorno (¿fue alta nueva o repetición?). El candado
    // real de idempotencia es el upsert de abajo, no esta lectura.
    const existing = await prisma.subscriptionInvoice.findUnique({
      where: { reference },
      select: { id: true },
    });

    await prisma.subscriptionInvoice.upsert({
      where: { reference },
      update: {}, // ya registrada → no la tocamos (puede tener notas del admin)
      create: {
        clinicId,
        // amount_paid viene en centavos de la moneda de la suscripción.
        amount: (invoice.amount_paid ?? 0) / 100,
        currency: (invoice.currency ?? "mxn").toUpperCase(),
        status: "paid",
        method: "stripe",
        reference,
        periodStart,
        periodEnd,
        paidAt: paidAtSec ? new Date(paidAtSec * 1000) : new Date(),
        notes: notes || null,
      },
    });

    return { created: !existing };
  } catch (err) {
    console.error("[recordStripeInvoice] no se pudo registrar el cobro:", {
      invoiceId: invoice?.id ?? null,
      clinicId,
      err,
    });
    return { created: false };
  }
}
