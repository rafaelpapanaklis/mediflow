import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import type Stripe from "stripe";

// Next.js App Router: no hace body-parsing automático aquí porque leemos el
// raw body para verificar la firma de Stripe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const stripe = getStripeSafe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Falta stripe-signature" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json({ error: `Invalid signature: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      // Activación tras checkout self-service (botón "Pagar con tarjeta"
      // en /dashboard/suspended). Identificamos por metadata.kind para
      // no confundirlo con checkouts de teleconsulta del paciente, que
      // viven en el mismo webhook pero NO traen este flag.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind !== "platform-subscription") break;

        const clinicId = session.metadata?.clinicId;
        if (!clinicId) break;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        const now = new Date();
        const nextMonth = new Date(now.getTime() + ONE_MONTH_MS);

        const before = await prisma.clinic.findUnique({
          where: { id: clinicId },
          select: {
            subscriptionStatus: true,
            stripeSubscriptionId: true,
            trialEndsAt: true,
            nextBillingDate: true,
          },
        });

        // Levantar el bloqueo de inmediato:
        //  - subscriptionStatus = 'active'
        //  - trialEndsAt extendido +1 mes (hace que `trialExpired` sea
        //    false en el layout aunque el webhook llegue antes que el
        //    customer.subscription.created)
        //  - nextBillingDate +1 mes (placeholder hasta que llegue el
        //    customer.subscription.created con current_period_end real)
        await prisma.clinic.update({
          where: { id: clinicId },
          data: {
            subscriptionStatus: "active",
            stripeSubscriptionId: subscriptionId ?? undefined,
            trialEndsAt: nextMonth,
            nextBillingDate: nextMonth,
          },
        });

        await logAudit({
          clinicId,
          userId: clinicId, // sin user en webhook context — usamos clinicId como placeholder
          entityType: "subscription",
          entityId: subscriptionId ?? session.id,
          action: "update",
          changes: {
            subscriptionStatus: { before: before?.subscriptionStatus ?? null, after: "active" },
            stripeSubscriptionId: { before: before?.stripeSubscriptionId ?? null, after: subscriptionId },
            trialEndsAt: { before: before?.trialEndsAt ?? null, after: nextMonth },
            nextBillingDate: { before: before?.nextBillingDate ?? null, after: nextMonth },
            _source: { before: null, after: { event: event.type, sessionId: session.id, plan: session.metadata?.plan } },
          },
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const clinicId = (sub.metadata?.clinicId as string | undefined)
          ?? await resolveClinicIdByCustomer(sub.customer as string);
        if (clinicId) {
          // current_period_end no siempre está tipado en las últimas versiones
          // del SDK; lo leemos como campo opcional.
          const periodEnd = (sub as any).current_period_end as number | undefined;
          await prisma.clinic.update({
            where: { id: clinicId },
            data: {
              stripeSubscriptionId: sub.id,
              subscriptionStatus:   sub.status,
              subscriptionId:       sub.id,
              nextBillingDate:      periodEnd ? new Date(periodEnd * 1000) : null,
            },
          });

          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: sub.id,
            action: "update",
            changes: {
              subscriptionStatus: { before: null, after: sub.status },
              _source: { before: null, after: { event: event.type, subscriptionId: sub.id } },
            },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const clinicId = (sub.metadata?.clinicId as string | undefined)
          ?? await resolveClinicIdByCustomer(sub.customer as string);
        if (clinicId) {
          await prisma.clinic.update({
            where: { id: clinicId },
            data: { subscriptionStatus: "cancelled" },
          });
          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: sub.id,
            action: "update",
            changes: {
              subscriptionStatus: { before: null, after: "cancelled" },
              _source: { before: null, after: { event: event.type, subscriptionId: sub.id } },
            },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;
        const clinicId = customerId ? await resolveClinicIdByCustomer(customerId) : null;
        if (clinicId) {
          await prisma.clinic.update({
            where: { id: clinicId },
            data: { subscriptionStatus: "past_due" },
          });
          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: invoice.id ?? customerId ?? clinicId,
            action: "update",
            changes: {
              subscriptionStatus: { before: null, after: "past_due" },
              _source: { before: null, after: { event: event.type, invoiceId: invoice.id } },
            },
          });
        }
        break;
      }

      case "invoice.paid":
        // No-op por ahora: customer.subscription.updated ya refresca el
        // status. Si en el futuro se quiere persistir SubscriptionInvoice
        // (montos por período), va aquí.
        break;

      default:
        break;
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error webhook" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function resolveClinicIdByCustomer(customerId: string): Promise<string | null> {
  const clinic = await prisma.clinic.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return clinic?.id ?? null;
}
