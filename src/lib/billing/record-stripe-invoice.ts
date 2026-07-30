import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";

/**
 * Registra en `subscription_invoices` el DESENLACE de una factura de Stripe:
 * cobrada (`outcome: "paid"`) o rechazada (`outcome: "failed"`).
 *
 * Por qué existe: la tabla `subscription_invoices` es la ÚNICA fuente de
 * "Cobrado este mes" (/admin), de /admin/payments y de /admin/reports. Hasta
 * ahora solo se llenaba a mano desde /api/admin/subscriptions, así que todo
 * cobro real de Stripe era invisible en el panel — y un cobro RECHAZADO no
 * aparecía en ningún lado.
 *
 * IDEMPOTENCIA: Stripe dispara `invoice.paid` Y `invoice.payment_succeeded`
 * para la MISMA factura (y reintenta los webhooks). El candado es
 * `reference` (@unique en el schema + índice único parcial en la BD).
 *
 * REINTENTOS (la parte delicada): Stripe reintenta el cobro de la MISMA
 * factura, así que un mismo invoice.id primero falla y días después se paga.
 *   - failed → paid: SÍ se promueve (status, paidAt y amount del pago real),
 *     si no ese ingreso nunca se contaría en "Cobrado este mes".
 *   - paid → failed: JAMÁS se degrada — un webhook fuera de orden no puede
 *     borrar un ingreso ya cobrado.
 *   - `notes` nunca se pisa al actualizar: puede tener notas del admin.
 *
 * NUNCA lanza: un fallo aquí no puede tumbar el 200 del webhook ni la lógica
 * de correos/afiliado que corre a su lado.
 */
export async function recordStripeInvoice(
  invoice: Stripe.Invoice,
  clinicId: string,
  outcome: "paid" | "failed" = "paid",
): Promise<{ created: boolean; promoted: boolean }> {
  try {
    const reference = invoice.id;
    if (!reference || !clinicId) return { created: false, promoted: false };

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
    // En una factura RECHAZADA `amount_paid` es 0 — el monto en riesgo es
    // `amount_due`, si no el panel mostraría "$0 por cobrar".
    const amount =
      outcome === "paid" ? (invoice.amount_paid ?? 0) / 100 : (invoice.amount_due ?? 0) / 100;
    const paidAt =
      outcome === "paid" ? (paidAtSec ? new Date(paidAtSec * 1000) : new Date()) : null;

    const label = `Stripe ${invoice.billing_reason ?? ""} ${invoice.number ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    const notes =
      outcome === "failed"
        ? `${label} — cobro fallido (intento ${invoice.attempt_count ?? 1})`.trim()
        : label;

    const existing = await prisma.subscriptionInvoice.findUnique({
      where: { reference },
      select: { id: true, status: true },
    });

    if (existing) {
      // Único caso en que se toca una fila ya registrada: el reintento que
      // acabó cobrando. Se actualiza EXPLÍCITAMENTE (no con upsert.update)
      // para no arrastrar `notes`.
      if (outcome === "paid" && existing.status !== "paid") {
        await prisma.subscriptionInvoice.update({
          where: { reference },
          data: { status: "paid", paidAt, amount },
        });
        return { created: false, promoted: true };
      }
      // Ya estaba en paid, o llega un "failed" sobre una fila existente → se
      // deja intacta (nunca se degrada un cobro real).
      return { created: false, promoted: false };
    }

    // Alta nueva. Sigue siendo un upsert (y no un create) porque la lectura de
    // arriba no es atómica: invoice.paid + invoice.payment_succeeded pueden
    // llegar a la vez y el candado real es `reference` @unique.
    await prisma.subscriptionInvoice.upsert({
      where: { reference },
      update: {}, // carrera con el webhook gemelo → gana el que llegó primero
      create: {
        clinicId,
        // Los montos de Stripe vienen en centavos de la moneda de la suscripción.
        amount,
        currency: (invoice.currency ?? "mxn").toUpperCase(),
        status: outcome,
        method: "stripe",
        reference,
        periodStart,
        periodEnd,
        paidAt,
        notes: notes || null,
      },
    });

    return { created: true, promoted: false };
  } catch (err) {
    console.error("[recordStripeInvoice] no se pudo registrar la factura:", {
      invoiceId: invoice?.id ?? null,
      clinicId,
      outcome,
      err,
    });
    return { created: false, promoted: false };
  }
}
