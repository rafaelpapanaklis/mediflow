import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import type Stripe from "stripe";
import { calcCommissionMxn } from "@/lib/affiliates";
import { sendAffiliateConversionEmail, sendAffiliateSellerConversionEmail } from "@/lib/affiliate-emails";
import { getProgramConfig, countActiveReferred, computeLevel, levelPct } from "@/lib/affiliate-levels";
import { computeSellerSplit } from "@/lib/affiliates/team";
import {
  creditWalletFromStripe,
  setWalletCardIfEmpty,
  recordFailedTopup,
  saveCardFromSetupIntent,
  AI_TOPUP_KIND,
  AI_SETUP_KIND,
} from "@/lib/ai-billing/recharge";
import { PATIENT_INVOICE_KIND, applyInvoiceOnlinePayment } from "@/lib/patient-portal/online-payment";
import { CFDI_OVERAGE_KIND, reconcileOverageFromWebhook } from "@/lib/cfdi-overage";
import { getPlanLimits } from "@/lib/plans";
import { isPlanId } from "@/lib/billing/plans";
import { sendPlanActivatedEmail, sendPlanRenewedEmail } from "@/lib/email";
import { PLAN_MARKETING } from "@/lib/plan-shared";

// Next.js App Router: no hace body-parsing automático aquí porque leemos el
// raw body para verificar la firma de Stripe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Base pública para los links de los correos de billing (mismo patrón que
// affiliate-emails / recordatorios). Sin dependencia del request.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

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

        // Pago de factura desde el portal del paciente (WS1-T4). Idempotente —
        // el webhook de teleconsulta puede procesar la misma sesión.
        if (session.metadata?.kind === PATIENT_INVOICE_KIND) {
          const invoiceId = session.metadata?.invoiceId;
          if (invoiceId) {
            await applyInvoiceOnlinePayment({
              invoiceId,
              amountMxn: (session.amount_total ?? 0) / 100,
              reference: (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) || session.id,
            });
          }
          break;
        }

        if (session.metadata?.kind !== "platform-subscription") break;

        const clinicId = session.metadata?.clinicId;
        if (!clinicId) break;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        // Tarjeta (mode "subscription") o pago con tarjeta ya acreditado
        // (payment_status "paid") → activar. SPEI/OXXO (mode "payment") son
        // ASÍNCRONOS: en "completed" el depósito/voucher aún NO está pagado
        // (payment_status "unpaid") → NO activar aquí; la activación llega en
        // checkout.session.async_payment_succeeded. Sin este guard daríamos
        // acceso sin haber cobrado.
        const isPaidNow = session.mode === "subscription" || session.payment_status === "paid";
        if (!isPaidNow) break;

        await activatePlatformSubscription(clinicId, subscriptionId, {
          event: event.type,
          sessionId: session.id,
          plan: session.metadata?.plan ?? null,
        }, session.metadata?.billing === "annual" ? "annual" : "monthly");
        break;
      }

      // SPEI / OXXO confirmados (depósito/voucher acreditado por Stripe). Activa
      // 1 mes MANUAL (sin auto-renovación: no hay subscription). Al llegar
      // nextBillingDate el gating del layout vuelve a bloquear y el usuario paga
      // otro periodo (la renovación automática es backlog, no se construye cron).
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind !== "platform-subscription") break;
        const clinicId = session.metadata?.clinicId;
        if (!clinicId) break;
        await activatePlatformSubscription(clinicId, null, {
          event: event.type,
          sessionId: session.id,
          plan: session.metadata?.plan ?? null,
        }, session.metadata?.billing === "annual" ? "annual" : "monthly");
        break;
      }

      // SPEI / OXXO fallido o expirado: NO activar; la cuenta sigue
      // "pending_payment" y el usuario puede reintentar el pago.
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind !== "platform-subscription") break;
        const clinicId = session.metadata?.clinicId;
        if (clinicId) {
          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: session.id,
            action: "update",
            changes: {
              _source: { before: null, after: { event: event.type, sessionId: session.id, result: "not_activated" } },
            },
          });
        }
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
          // Plan en la metadata de la suscripción (cambios hechos desde el
          // dashboard/portal de Stripe). Si es válido, sincroniza plan + cupo IA.
          const subPlan = sub.metadata?.plan;
          const subPlanFields = isPlanId(subPlan)
            ? { plan: subPlan, aiTokensLimit: (await getPlanLimits(subPlan)).aiTokensDefault }
            : {};
          await prisma.clinic.update({
            where: { id: clinicId },
            data: {
              stripeSubscriptionId: sub.id,
              subscriptionStatus:   sub.status,
              subscriptionId:       sub.id,
              nextBillingDate:      periodEnd ? new Date(periodEnd * 1000) : null,
              ...subPlanFields,
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
      case "invoice.payment_succeeded": {
        // Comisión recurrente de afiliado: por cada factura pagada de una
        // clínica referida, registramos una AffiliateCommission. Idempotente
        // por stripeInvoiceId (@unique) — si Stripe reintenta el webhook o
        // dispara ambos eventos, no se duplica.
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;
        const invoiceId = invoice.id;
        if (!customerId || !invoiceId) break;

        const clinic = await prisma.clinic.findFirst({
          where: { stripeCustomerId: customerId },
          select: {
            id: true,
            name: true,
            email: true,
            plan: true,
            nextBillingDate: true,
            // Dueño de la clínica (SUPER_ADMIN más antiguo activo) → destinatario
            // preferente de los correos de billing; cae a clinic.email si no hay.
            users: {
              where: { role: "SUPER_ADMIN", isActive: true },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { email: true, firstName: true },
            },
            affiliateId: true,
            affiliate: { select: { commissionPct: true, status: true } },
          },
        });

        // ──────────────────────────────────────────────────────────────────
        // CORREOS DE CICLO DE VIDA DEL PLAN — van ANTES del break por afiliado
        // para que lleguen a TODAS las clínicas (no solo a las referidas):
        //   billing_reason "subscription_create" → "plan activado" (1er pago)
        //   billing_reason "subscription_cycle"  → "plan renovado" (renovación)
        //   otros billing_reason                 → se ignoran.
        // Idempotente por invoiceId: Stripe dispara invoice.paid +
        // invoice.payment_succeeded para la misma factura → la fila única en
        // billing_email_logs garantiza UN solo correo. Fire-and-forget: ni el
        // envío ni un fallo del guard bloquean el 200 ni la lógica de afiliado.
        if (clinic) {
          try {
            const reason = invoice.billing_reason;
            const kind =
              reason === "subscription_create" ? "plan_activated"
              : reason === "subscription_cycle" ? "plan_renewed"
              : null;
            if (kind) {
              const owner = clinic.users[0];
              const to = owner?.email ?? clinic.email ?? null;
              if (to) {
                // Guard ATÓMICO: la fila única (invoiceId) es el candado. Si ya
                // existe (P2002) o la tabla aún no está migrada, NO enviamos
                // (no podemos deduplicar → preferimos no duplicar).
                let firstTime = false;
                try {
                  await prisma.billingEmailLog.create({
                    data: { invoiceId, clinicId: clinic.id, kind, email: to },
                  });
                  firstTime = true;
                } catch (e: any) {
                  if (e?.code !== "P2002") {
                    console.error("[stripe webhook] billing email guard:", e?.code ?? e);
                  }
                }
                if (firstTime) {
                  const planName =
                    PLAN_MARKETING[clinic.plan as keyof typeof PLAN_MARKETING]?.name ?? String(clinic.plan);
                  if (kind === "plan_activated") {
                    sendPlanActivatedEmail({
                      email: to,
                      firstName: owner?.firstName,
                      clinicName: clinic.name,
                      planName,
                      dashboardUrl: `${SITE_URL}/dashboard`,
                    }).catch(() => {});
                  } else {
                    // Próxima fecha de cobro: fin del periodo facturado en la
                    // línea (= próxima renovación) o nextBillingDate como fallback.
                    const lineEnd = invoice.lines?.data?.[0]?.period?.end ?? null;
                    const nextBillingDate = lineEnd
                      ? new Date(lineEnd * 1000)
                      : clinic.nextBillingDate ?? null;
                    sendPlanRenewedEmail({
                      email: to,
                      firstName: owner?.firstName,
                      clinicName: clinic.name,
                      planName,
                      amountPaid: (invoice.amount_paid ?? 0) / 100,
                      currency: invoice.currency ?? "mxn",
                      nextBillingDate,
                      receiptsUrl: `${SITE_URL}/dashboard/settings?tab=subscription`,
                    }).catch(() => {});
                  }
                }
              }
            }
          } catch (err) {
            console.error("[stripe webhook] billing email section:", err);
          }
        }

        if (!clinic?.affiliateId || !clinic.affiliate) break; // sin afiliado referente
        // Solo afiliados APPROVED acumulan comisión: la aprobación puede
        // revocarse (suspendido/rechazado) DESPUÉS de la atribución del alta.
        if (clinic.affiliate.status !== "APPROVED") break;

        // amount_paid viene en centavos de la moneda de la suscripción (MXN).
        const amountMxn = (invoice.amount_paid ?? 0) / 100;
        if (amountMxn <= 0) break;

        // % del nivel VIGENTE al generarse (no retroactivo); sin tabla de
        // config → legacy commissionPct.
        let pct = clinic.affiliate.commissionPct;
        try {
          const cfg = await getProgramConfig();
          if (cfg) {
            const active = await countActiveReferred(clinic.affiliateId);
            pct = levelPct(computeLevel(active, cfg), cfg);
          }
        } catch {}

        const commissionMxn = calcCommissionMxn(amountMxn, pct);

        // ── EQUIPOS DE VENDEDORES: si la clínica tiene atribución de
        //    vendedor, la comisión total (= % del nivel VIGENTE del padre, sin
        //    pagar de más) se REPARTE: el vendedor su % congelado al alta
        //    (clamp al nivel) y el padre el override (= total − vendedor). Las
        //    clínicas sin atribución siguen 100% al padre (sin cambio).
        const attr = await prisma.affiliateSellerAttribution
          .findUnique({ where: { clinicId: clinic.id } })
          .catch(() => null);

        try {
          if (attr) {
            const split = computeSellerSplit(amountMxn, pct, attr.sellerPct);
            // Las dos comisiones se crean en una transacción. El primer create
            // (affiliateCommission, stripeInvoiceId @unique) lanza P2002 en
            // reintentos → la transacción aborta y el catch de abajo lo trata
            // como ya-procesado (no-op). Suma garantizada por el contrato:
            // split.overrideMxn + split.sellerMxn === split.totalMxn.
            await prisma.$transaction(async (tx) => {
              await tx.affiliateCommission.create({
                data: {
                  affiliateId: clinic.affiliateId,
                  clinicId: clinic.id,
                  stripeInvoiceId: invoiceId,
                  amountMxn,
                  commissionMxn: split.overrideMxn,
                  status: "pending",
                },
              });
              await tx.affiliateSellerCommission.create({
                data: {
                  sellerId: attr.sellerId,
                  affiliateId: clinic.affiliateId,
                  clinicId: clinic.id,
                  stripeInvoiceId: invoiceId,
                  amountMxn,
                  commissionMxn: split.sellerMxn,
                  status: "pending",
                },
              });
            });
            // Emails fire-and-forget (cada helper avisa solo en la 1a comisión
            // de la clínica): override al padre, porción al vendedor.
            sendAffiliateConversionEmail({
              affiliateId: clinic.affiliateId,
              clinicId: clinic.id,
              commissionMxn: split.overrideMxn,
            }).catch(() => {});
            sendAffiliateSellerConversionEmail({
              sellerId: attr.sellerId,
              clinicId: clinic.id,
              commissionMxn: split.sellerMxn,
            }).catch(() => {});
          } else {
            await prisma.affiliateCommission.create({
              data: {
                affiliateId: clinic.affiliateId,
                clinicId: clinic.id,
                stripeInvoiceId: invoiceId,
                amountMxn,
                commissionMxn,
                status: "pending",
              },
            });
            // Email de conversión al afiliado (solo la 1a comisión de la
            // clínica; el helper lo verifica). Fire-and-forget: el webhook
            // NO espera el envío.
            sendAffiliateConversionEmail({
              affiliateId: clinic.affiliateId,
              clinicId: clinic.id,
              commissionMxn,
            }).catch(() => {});
          }
        } catch (err: any) {
          // P2002 = unique violation → la comisión ya existía, no-op.
          if (err?.code !== "P2002") throw err;
        }
        break;
      }

      // ── Recargas del monedero de IA (T3). Se identifican por metadata.kind
      //    para NO interferir con suscripciones / teleconsulta / OXXO. La
      //    acreditación es idempotente por PaymentIntent id (mismo crédito si
      //    llega inline desde chargeOffSession y por este webhook).
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Excedente CFDI (cobro off-session anual): backstop idempotente del cron.
        if (pi.metadata?.kind === CFDI_OVERAGE_KIND) {
          await reconcileOverageFromWebhook(pi, true);
          break;
        }
        if (pi.metadata?.kind !== AI_TOPUP_KIND) break;
        const clinicId = pi.metadata?.clinicId;
        if (!clinicId) break;

        const amountCents = pi.amount_received || Number(pi.metadata?.amountCents) || pi.amount;
        await creditWalletFromStripe({ clinicId, amountCents, paymentIntentId: pi.id });

        // Si la recarga guardó tarjeta (setup_future_usage) y el monedero no
        // tenía una, la dejamos lista para auto-recarga off-session.
        const pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
        if (pmId && pi.setup_future_usage) await setWalletCardIfEmpty(clinicId, pmId);
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Excedente CFDI: marca el fallo (el cron ya deja adeudo manual visible).
        if (pi.metadata?.kind === CFDI_OVERAGE_KIND) {
          await reconcileOverageFromWebhook(pi, false);
          break;
        }
        if (pi.metadata?.kind !== AI_TOPUP_KIND) break;
        const clinicId = pi.metadata?.clinicId;
        if (!clinicId) break;
        await recordFailedTopup(clinicId, Number(pi.metadata?.amountCents) || pi.amount, pi.id);
        break;
      }

      // Guardado de tarjeta vía SetupIntent (red de seguridad por si el cliente
      // confirma pero no llega a llamar a /confirm). Idempotente.
      case "setup_intent.succeeded": {
        const si = event.data.object as Stripe.SetupIntent;
        if (si.metadata?.kind !== AI_SETUP_KIND) break;
        const clinicId = si.metadata?.clinicId;
        if (!clinicId) break;
        await saveCardFromSetupIntent(clinicId, si.id);
        break;
      }

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

/** Suma n meses a una fecha, recortando el día si el mes destino es más corto
 *  (ej. 31 ene + 1 mes → 28/29 feb, no 3 mar). */
function addMonths(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/** Suma n años a una fecha (29 feb → 28 feb en año no bisiesto). */
function addYears(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  const m = d.getMonth();
  d.setFullYear(d.getFullYear() + n);
  if (d.getMonth() !== m) d.setDate(0);
  return d;
}

/**
 * Activa la suscripción de la plataforma para una clínica: levanta el bloqueo
 * del gating (subscriptionStatus="active") y EXTIENDE trialEndsAt/nextBillingDate
 * un periodo (mes/año) DESDE EL FINAL del periodo vigente (o desde hoy si ya
 * venció) — renovar anticipado SUMA los días restantes, no los pierde.
 * Compartido entre el pago con tarjeta (checkout.session.completed) y la
 * confirmación asíncrona de SPEI/OXXO (async_payment_succeeded).
 * `subscriptionId` es null en SPEI/OXXO (pago único sin auto-renovación).
 */
async function activatePlatformSubscription(
  clinicId: string,
  subscriptionId: string | null,
  source: { event: string; sessionId?: string; plan?: string | null },
  billing: "monthly" | "annual" = "monthly",
): Promise<void> {
  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      trialEndsAt: true,
      nextBillingDate: true,
    },
  });

  // EXTENDER desde el final del periodo vigente, NO desde hoy: si el cliente
  // renueva anticipado (aún le quedan días de plan o de trial), esos días se
  // SUMAN; si ya venció, se cuenta desde hoy. El "fin vigente" es el MÁXIMO de
  // hoy, nextBillingDate y trialEndsAt (en trial nextBillingDate suele ser null,
  // así que trialEndsAt es el que cuenta). Para tarjeta, customer.subscription.*
  // fijará luego el current_period_end REAL de Stripe; este es el valor
  // inmediato/placeholder y el definitivo para SPEI/OXXO (pago único).
  const now = new Date();
  let base = now;
  if (before?.nextBillingDate && new Date(before.nextBillingDate) > base) base = new Date(before.nextBillingDate);
  if (before?.trialEndsAt && new Date(before.trialEndsAt) > base) base = new Date(before.trialEndsAt);
  const next = billing === "annual" ? addYears(base, 1) : addMonths(base, 1);

  // Plan elegido en el checkout (source.plan, viene de session.metadata.plan).
  // Si es válido, fija plan + cupo de IA acorde; si no, deja lo existente.
  // Cubre tarjeta (checkout.session.completed) y SPEI/OXXO (async_payment_succeeded).
  const planFields = isPlanId(source.plan)
    ? { plan: source.plan, aiTokensLimit: (await getPlanLimits(source.plan)).aiTokensDefault }
    : {};

  await prisma.clinic.update({
    where: { id: clinicId },
    data: {
      subscriptionStatus: "active",
      stripeSubscriptionId: subscriptionId ?? undefined,
      trialEndsAt: next,
      nextBillingDate: next,
      ...planFields,
    },
  });

  await logAudit({
    clinicId,
    userId: clinicId, // sin user en webhook context — usamos clinicId como placeholder
    entityType: "subscription",
    entityId: subscriptionId ?? source.sessionId ?? clinicId,
    action: "update",
    changes: {
      subscriptionStatus: { before: before?.subscriptionStatus ?? null, after: "active" },
      stripeSubscriptionId: { before: before?.stripeSubscriptionId ?? null, after: subscriptionId },
      trialEndsAt: { before: before?.trialEndsAt ?? null, after: next },
      nextBillingDate: { before: before?.nextBillingDate ?? null, after: next },
      _source: { before: null, after: source },
    },
  });
}
