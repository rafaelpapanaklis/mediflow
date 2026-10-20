import { NextRequest, NextResponse } from "next/server";
import { bloqueoDeSedesParaPlan, sincronizarSedesIncluidas } from "@/lib/billing/sedes-incluidas";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import type Stripe from "stripe";
import { calcCommissionMxn } from "@/lib/affiliates";
import { sendAffiliateConversionEmail } from "@/lib/affiliate-emails";
import { getProgramConfig, countActiveReferred, computeLevel, levelPct } from "@/lib/affiliate-levels";
import {
  claimOneTimePayout,
  effectiveAffiliateMode,
  ensureClinicTerms,
  getClinicTerms,
  getInvoiceNo,
  getPayoutConfig,
  monthsCovered,
  normalizePlanKey,
  resolveCommission,
  type ClinicTerms,
  type ResolvedCommission,
} from "@/lib/affiliates/payout";
import {
  creditWalletFromStripe,
  setWalletCardIfEmpty,
  recordFailedTopup,
  saveCardFromSetupIntent,
  saveCardFromTopupIntent,
  topupFromCheckoutSession,
  AI_TOPUP_KIND,
  AI_SETUP_KIND,
} from "@/lib/ai-billing/recharge";
import { paymentIntentDeEvento, revertirRecargaStripe } from "@/lib/ai-billing/reversion";
import { PATIENT_INVOICE_KIND, applyInvoiceOnlinePayment } from "@/lib/patient-portal/online-payment";
import { CFDI_OVERAGE_APARTE_KIND, CFDI_OVERAGE_KIND, CFDI_OVERAGE_METHOD, reconcileOverageFromWebhook } from "@/lib/cfdi-overage";
import { getPlanLimits } from "@/lib/plans";
import { isPlanId } from "@/lib/billing/plans";
import {
  PLAN_UPGRADE_DIFF_KIND,
  canSuspendForFailedInvoice,
  isPlanTierUpgrade,
  subscriptionPeriodFields,
} from "@/lib/billing/proration";
import { estadoDeSuscripcionAEscribir } from "@/lib/billing/estado-suscripcion";
import { recordStripeInvoice } from "@/lib/billing/record-stripe-invoice";
import { sendPlanActivatedEmail, sendPlanRenewedEmail } from "@/lib/email";
import { marcarFacturasDeLaClinica } from "@/lib/billing/factura-fuera-de-stripe.server";
import { registrarComoNoCobrada } from "@/lib/billing/reactivacion-tras-suspension.server";
import { reactivarSiStripeYaCobro, reglaDeSuspensionPorCobroDeTarjeta, type ResultadoReglaCobro } from "@/lib/billing/regla-cobro-tarjeta.server";
import { avisarCobroRechazado, type ClinicaParaAvisoDeCobro } from "@/lib/billing/aviso-cobro-rechazado.server";
import {
  accesoTrasCobroRechazado,
  clinicaEstabaSuspendida,
  debeReintentarPorEstadoVivo,
  planDeMetadataAplicable,
  esMesDeServicioSuspendido,
  estadoVisibleDeSuscripcion,
  finDeLoPagado,
  esperaAlRechazoDeFactura,
  estadoEfectivoDeSuscripcion,
  eraClinicaPagadora,
  esDeLaSuscripcionDelPlan,
  inicioDeNuevoPeriodo,
  METODO_ACTIVACION_ADMIN,
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  enPeriodoPagado,
  motivoParaNoSuspender,
  pagoManualCubreLaFactura,
  trialEndsAtSinRetroceder,
} from "@/lib/billing/cobro-rechazado";
import { PLAN_MARKETING } from "@/lib/plan-shared";
import { isPaymentFailed } from "@/lib/plan-status";
import {
  MODULE_SUBSCRIPTION_KIND,
  buildActivateModuleWrite,
  referenciaDeFactura,
  resolveActivationConflict,
  resolveModuleDeletion,
  resolveModuleSubscriptionSync,
  type ModuleBillingCycle,
  type ModulePaymentMethod,
} from "@/lib/marketplace/module-purchase-core";
import { subscriptionPeriodEndSeconds } from "@/lib/billing/proration";
import { notifyModuleActivated } from "@/lib/marketplace/module-activated-email";
import { enviarCompraMetaDeSesion } from "@/lib/analytics/meta-capi.server";
import { enviarCompraTiktokDeSesion } from "@/lib/analytics/tiktok-capi.server";

// Next.js App Router: no hace body-parsing automático aquí porque leemos el
// raw body para verificar la firma de Stripe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Base pública para los links de los correos de billing (mismo patrón que
// affiliate-emails / recordatorios). Sin dependencia del request.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

// Sentinela para ABORTAR la transacción del pago único de afiliado cuando otro
// proceso ya lo reclamó (ver el bloque de comisión en invoice.paid). Se traga
// en el catch igual que un P2002: no-op, sin fila y sin correos.
const ONE_TIME_CLAIMED_CODE = "ONE_TIME_ALREADY_CLAIMED";

function oneTimeClaimedError(): Error {
  const err = new Error("El pago único de esta clínica ya fue entregado") as Error & { code: string };
  err.code = ONE_TIME_CLAIMED_CODE;
  return err;
}

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

        // Recarga del monedero de IA pagada por Checkout (kind = ai-topup). Es la
        // RED DE SEGURIDAD de payment_intent.succeeded: el 22-sep-2026 ese evento
        // no estaba suscrito en Stripe, este sí llegó y se descartaba aquí, y
        // $200 MXN se cobraron sin abonarse. Los dos eventos son el MISMO pago:
        // el candado es el id del PaymentIntent (nunca el de la sesión), así que
        // solo uno acredita. Y solo con el pago hecho (payment_status "paid").
        if (session.metadata?.kind === AI_TOPUP_KIND) {
          const topup = topupFromCheckoutSession(session);
          if (topup) {
            await creditWalletFromStripe(topup);
            await saveCardFromTopupIntent(topup.clinicId, topup.paymentIntentId);
          }
          break;
        }

        // Diferencial prorrateado de un UPGRADE de clínica que paga SPEI/OXXO
        // (no tiene suscripción de tarjeta). Solo aplica el plan; NO extiende el
        // periodo. Con tarjeta el pago ya está acreditado aquí; con SPEI/OXXO
        // llega por async_payment_succeeded.
        if (session.metadata?.kind === PLAN_UPGRADE_DIFF_KIND) {
          const diffClinicId = session.metadata?.clinicId;
          if (diffClinicId && session.payment_status === "paid") {
            await applyPlanUpgradeDiff(diffClinicId, session.metadata?.plan ?? null, {
              event: event.type,
              sessionId: session.id,
            });
          }
          break;
        }

        // Compra de UN módulo del marketplace (ws1-t2, Ortodoncia es el
        // primero). Tarjeta (mode "subscription") o pago con tarjeta ya
        // acreditado aquí; SPEI/OXXO llegan por async_payment_succeeded
        // (mismo guard `isPaidNow` que platform-subscription, abajo).
        if (session.metadata?.kind === MODULE_SUBSCRIPTION_KIND) {
          const moduleClinicId = session.metadata?.clinicId;
          const moduleKey = session.metadata?.moduleKey;
          if (moduleClinicId && moduleKey) {
            const isPaidNow = session.mode === "subscription" || session.payment_status === "paid";
            if (isPaidNow) {
              const subscriptionId =
                typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
              await activateModulePurchase(stripe, moduleClinicId, moduleKey, {
                billing: session.metadata?.billing === "annual" ? "annual" : "monthly",
                method: (session.metadata?.method as "card" | "spei" | "oxxo" | undefined) ?? "card",
                amountMxn: (session.amount_subtotal ?? session.amount_total ?? 0) / 100,
                stripeSubscriptionId: subscriptionId,
                source: { event: event.type, sessionId: session.id },
              });
            }
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
        // Purchase de Meta por la API de Conversiones (WS1-T4): solo la PRIMERA
        // contratación pagada, event_id = session.id (el mismo del píxel en la
        // página de éxito). Nunca lanza ni cambia la respuesta del webhook.
        await enviarCompraMetaDeSesion(session);
        await enviarCompraTiktokDeSesion(session); // ws1-t5: CompletePayment de TikTok, mismo criterio
        break;
      }

      // SPEI / OXXO confirmados (depósito/voucher acreditado por Stripe). Activa
      // 1 mes MANUAL (sin auto-renovación: no hay subscription). Al llegar
      // nextBillingDate el gating del layout vuelve a bloquear y el usuario paga
      // otro periodo (la renovación automática es backlog, no se construye cron).
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Diferencial de upgrade pagado por SPEI/OXXO: aplica el plan SIN mover
        // trialEndsAt/nextBillingDate (el periodo no se extiende).
        if (session.metadata?.kind === PLAN_UPGRADE_DIFF_KIND) {
          const diffClinicId = session.metadata?.clinicId;
          if (diffClinicId) {
            await applyPlanUpgradeDiff(diffClinicId, session.metadata?.plan ?? null, {
              event: event.type,
              sessionId: session.id,
            });
          }
          break;
        }
        // Módulo pagado por SPEI/OXXO: mismo "1 periodo manual, sin
        // auto-renovación" que la plataforma — la próxima vez la clínica
        // vuelve a comprar.
        if (session.metadata?.kind === MODULE_SUBSCRIPTION_KIND) {
          const moduleClinicId = session.metadata?.clinicId;
          const moduleKey = session.metadata?.moduleKey;
          if (moduleClinicId && moduleKey) {
            await activateModulePurchase(stripe, moduleClinicId, moduleKey, {
              billing: session.metadata?.billing === "annual" ? "annual" : "monthly",
              method: (session.metadata?.method as "card" | "spei" | "oxxo" | undefined) ?? "spei",
              amountMxn: (session.amount_subtotal ?? session.amount_total ?? 0) / 100,
              stripeSubscriptionId: null,
              source: { event: event.type, sessionId: session.id },
            });
          }
          break;
        }
        if (session.metadata?.kind !== "platform-subscription") break;
        const clinicId = session.metadata?.clinicId;
        if (!clinicId) break;
        await activatePlatformSubscription(clinicId, null, {
          event: event.type,
          sessionId: session.id,
          plan: session.metadata?.plan ?? null,
        }, session.metadata?.billing === "annual" ? "annual" : "monthly");
        // SPEI/OXXO de Stripe nunca pasan por la página de éxito: este Purchase
        // del servidor es el único que los cuenta en Meta (WS1-T4).
        await enviarCompraMetaDeSesion(session);
        await enviarCompraTiktokDeSesion(session); // ws1-t5: CompletePayment de TikTok, mismo criterio
        break;
      }

      // SPEI / OXXO fallido o expirado: NO activar; la cuenta sigue
      // "pending_payment" y el usuario puede reintentar el pago.
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const kind = session.metadata?.kind;
        // El diferencial de upgrade también se audita: si no se pagó, el plan
        // simplemente NO se aplicó (nada que revertir).
        if (kind !== "platform-subscription" && kind !== PLAN_UPGRADE_DIFF_KIND && kind !== MODULE_SUBSCRIPTION_KIND) break;
        const clinicId = session.metadata?.clinicId;
        if (clinicId) {
          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: session.id,
            action: "update",
            changes: {
              _source: { before: null, after: { event: event.type, kind, sessionId: session.id, result: "not_activated" } },
            },
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        // Suscripción de un MÓDULO (ws1-t2): distinta de la del plan de la
        // plataforma aunque comparta el mismo customer de Stripe — nunca
        // toca Clinic.subscriptionStatus/stripeSubscriptionId.
        if (sub.metadata?.kind === MODULE_SUBSCRIPTION_KIND) {
          await syncModuleSubscription(sub, event.type);
          break;
        }
        const clinicId = (sub.metadata?.clinicId as string | undefined)
          ?? await resolveClinicIdByCustomer(sub.customer as string);
        if (clinicId) {
          // Plan en la metadata de la suscripción (cambios hechos desde el
          // dashboard/portal de Stripe). Si es válido, sincroniza plan + cupo IA.
          const subPlan = sub.metadata?.plan;
          // A2 (ws1-t5): un plan que admite menos sedes de las que cuelgan de este pago NO se escribe (las
          // sedes seguirían activas sin pagar). Se queda el plan actual y se deja el motivo en la bitácora.
          const sedesBloquean = isPlanId(subPlan) ? await bloqueoDeSedesParaPlan(clinicId, subPlan) : null;
          if (sedesBloquean) {
            await logAudit({
              clinicId,
              userId: clinicId,
              entityType: "subscription",
              entityId: sub.id,
              action: "update",
              changes: { _source: { before: null, after: { event: event.type, planNoAplicado: subPlan, motivo: sedesBloquean } } },
            }).catch(() => {});
          }
          const subPlanFieldsSiPagado = isPlanId(subPlan) && !sedesBloquean
            ? { plan: subPlan, aiTokensLimit: (await getPlanLimits(subPlan)).aiTokensDefault }
            : {};
          // Fin del periodo REAL de Stripe → nextBillingDate Y trialEndsAt (el
          // "acceso hasta" del gate, isPlanExpired) al MISMO valor cuando la
          // suscripción está active/trialing. Antes SOLO se movía
          // nextBillingDate: trialEndsAt se quedaba en la fecha de la
          // contratación y se atrasaba un mes por cada renovación — con
          // `active` no bloqueaba, pero el primer `past_due` de un reintento
          // sacaba a la clínica al instante con el periodo pagado, y /admin la
          // pintaba "Expirada". Si Stripe NO reporta el fin de periodo, no se
          // toca ninguna fecha (`subscriptionPeriodFields` devuelve {}); antes
          // se escribía `null` y el dato se BORRABA. En las versiones nuevas de
          // la API el fin de periodo vive en el item, no en la suscripción.
          // El orden de los eventos no está garantizado: se lee el estado VIVO de la suscripción (un
          // «created» viejo no debe pisar el «active») y un «incomplete» nunca baja a una clínica que
          // ya está activa. Ver estado-suscripcion.ts.
          let suscripcionViva: Stripe.Subscription | null = null;
          try {
            suscripcionViva = await stripe.subscriptions.retrieve(sub.id);
          } catch {
            suscripcionViva = null;
          }
          const estadoVivo: string | null = suscripcionViva?.status ?? null;
          // Y17: el plan de la metadata solo se aplica con la suscripción PAGADA. «Subir de plan» con la tarjeta rechazada deja
          // `metadata.plan` en el plan nuevo; aplicarlo daría el plan sin cobrarlo. Cuando pase a `active` se aplica.
          const planPagado = planDeMetadataAplicable(estadoEfectivoDeSuscripcion({ evento: sub.status, vivo: estadoVivo }));
          const subPlanFields = planPagado ? subPlanFieldsSiPagado : {};
          if (!planPagado && Object.keys(subPlanFieldsSiPagado).length > 0) {
            await logAudit({
              clinicId,
              userId: clinicId,
              entityType: "subscription",
              entityId: sub.id,
              action: "update",
              changes: { _source: { before: null, after: { event: event.type, planNoAplicado: subPlan, motivo: "suscripción sin pagar", estadoStripe: estadoVivo ?? sub.status } } },
            }).catch(() => {});
          }
          const antes = await prisma.clinic.findUnique({
            where: { id: clinicId },
            select: { subscriptionStatus: true, stripeSubscriptionId: true, trialEndsAt: true },
          });
          // Cobro rechazado + un «active» del evento que no se pudo contrastar con Stripe: no se adivina.
          // Se responde 5xx y Stripe reintenta el evento (si no, un «active» viejo regalaría el periodo).
          if (
            debeReintentarPorEstadoVivo({
              estadoActual: antes?.subscriptionStatus,
              eventoStatus: sub.status,
              vivo: estadoVivo,
            })
          ) {
            throw new Error("No se pudo leer el estado vivo de la suscripción; Stripe debe reintentar el evento");
          }
          const estadoCalculado = estadoDeSuscripcionAEscribir({
            actual: { status: antes?.subscriptionStatus ?? null, subscriptionId: antes?.stripeSubscriptionId ?? null },
            evento: { id: sub.id, status: sub.status },
            vivo: estadoVivo,
          });
          // El paso al past_due y la gracia de 24 h son del `invoice.payment_failed` (ver abajo): si este
          // `updated` llegó primero, la clínica sigue como estaba hasta que ese evento se procese.
          // Un `trialing` con nuestra marca de periodo pagado NO es una prueba: es un periodo pagado a mano con el cobro de la
          // tarjeta al terminar (ver reactivacion-tras-suspension.server.ts). La clínica queda `active`, nunca «En prueba».
          const estadoNuevo = esperaAlRechazoDeFactura({
            estadoActual: antes?.subscriptionStatus,
            estadoNuevo: estadoCalculado,
          })
            ? undefined
            : estadoVisibleDeSuscripcion(estadoCalculado, suscripcionViva ?? sub) ?? undefined;
          // Las fechas salen de la suscripción VIVA y de su estado real: un `updated` «active» que llega
          // DESPUÉS del `payment_failed` del mismo ciclo (Stripe ya la tiene en past_due) solo mueve
          // nextBillingDate; el «acceso hasta» (trialEndsAt) se queda en la gracia de 24 h. Sin lectura
          // viva (la clínica no estaba rechazada) se usa el evento, como siempre.
          const periodFields = subscriptionPeriodFields({
            ...(suscripcionViva ?? sub),
            status: estadoEfectivoDeSuscripcion({ evento: sub.status, vivo: estadoVivo }),
          });
          // Nunca por debajo de lo que ya tiene la clínica: al marcar una factura pagada fuera de Stripe, Stripe manda un
          // `updated` → active, y el fin de SU ciclo recortaba un pago manual de varios meses.
          const trialEndsAtFinal = trialEndsAtSinRetroceder(periodFields.trialEndsAt, antes?.trialEndsAt);
          await prisma.clinic.update({
            where: { id: clinicId },
            data: {
              stripeSubscriptionId: sub.id,
              ...(estadoNuevo !== undefined ? { subscriptionStatus: estadoNuevo } : {}),
              subscriptionId:       sub.id,
              ...periodFields,
              ...(trialEndsAtFinal ? { trialEndsAt: trialEndsAtFinal } : {}),
              ...subPlanFields,
            },
          });
          await sincronizarSedesIncluidas(clinicId);

          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: sub.id,
            action: "update",
            changes: {
              subscriptionStatus: { before: antes?.subscriptionStatus ?? null, after: estadoNuevo ?? antes?.subscriptionStatus ?? null },
              ...(periodFields.nextBillingDate
                ? { nextBillingDate: { before: null, after: periodFields.nextBillingDate } }
                : {}),
              ...(trialEndsAtFinal
                ? { trialEndsAt: { before: null, after: trialEndsAtFinal } }
                : {}),
              _source: { before: null, after: { event: event.type, subscriptionId: sub.id } },
            },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.kind === MODULE_SUBSCRIPTION_KIND) {
          await cancelModuleSubscription(sub, event.type);
          break;
        }
        const clinicId = (sub.metadata?.clinicId as string | undefined)
          ?? await resolveClinicIdByCustomer(sub.customer as string);
        if (clinicId) {
          await prisma.clinic.update({
            where: { id: clinicId },
            data: { subscriptionStatus: "cancelled" },
          });
          await sincronizarSedesIncluidas(clinicId);
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
          // SOLO la mensualidad/anualidad puede SUSPENDER (ver
          // canSuspendForFailedInvoice): un prorrateo rechazado llega con
          // billing_reason "subscription_update" y NO debe costarle a la clínica
          // el acceso al plan que ya paga por haber intentado subir de plan.
          const reason = invoice.billing_reason;
          // La mensualidad de un MÓDULO tampoco suspende (ws1-t5): su
          // suscripción comparte el customer con la del plan, y un cobro de
          // módulo rechazado dejaba a la clínica entera sin panel con el plan
          // al corriente. El módulo se pausa por su lado, con
          // `customer.subscription.updated` (syncModuleSubscription).
          const moduloDeLaFactura = await moduloDeFactura(invoice);
          const canSuspend = moduloDeLaFactura === null && canSuspendForFailedInvoice(reason);
          // GRACIA DE 24 H (ws1-t1): el acceso baja a (primer rechazo + 24 h) y los reintentos no lo alargan.
          // El momento del rechazo es el del evento (no el de su procesamiento): un reenvío del mismo evento
          // da la misma hora y no cambia nada (ver accesoTrasCobroRechazado).
          //
          // ANTES de suspender (revisión t4): (1) que la factura sea de LA suscripción del plan; (2) que
          // siga ABIERTA en Stripe —pagada, anulada o incobrable no suspenden un aviso viejo, y si Stripe
          // no contesta se lanza el error y Stripe reintenta el evento—; (3) que un pago manual (SPEI
          // confirmado o activación del admin) no cubra ya a la clínica. En cualquiera de esos casos solo
          // queda la bitácora: ni 24 h, ni past_due, ni correo.
          let antes: Awaited<ReturnType<typeof cargarClinicaParaRechazo>> = null;
          let motivoSinSuspender: ReturnType<typeof motivoParaNoSuspender> | "no_aplica" | null = null;
          let estadoVivoFactura: string | null = null;
          if (!canSuspend) {
            motivoSinSuspender = "no_aplica";
          } else {
            antes = await cargarClinicaParaRechazo(clinicId);
            const esDelPlan = esDeLaSuscripcionDelPlan(
              referenciaDeFactura(invoice as unknown as Parameters<typeof referenciaDeFactura>[0]).stripeSubscriptionId,
              antes?.stripeSubscriptionId,
            );
            if (esDelPlan) estadoVivoFactura = await estadoVivoDeFactura(stripe, invoice);
            const cubierta =
              esDelPlan && estadoVivoFactura === "open"
                ? await pagoManualCubre(clinicId, invoice, antes)
                : false;
            motivoSinSuspender = motivoParaNoSuspender({ esDelPlan, estadoVivoFactura, cubiertaPorPagoManual: cubierta });
          }
          const suspende = canSuspend && motivoSinSuspender === null;
          let accesoFinal: Date | null = null;
          let correoDestino: ClinicaParaAvisoDeCobro | null = null;
          let eraPagadora = false;
          if (suspende && antes) {
            const estadoAntes = antes.subscriptionStatus;
            const accesoAntes = antes.trialEndsAt;
            const acceso = accesoTrasCobroRechazado({
              estadoActual: antes.subscriptionStatus,
              accesoActual: antes.trialEndsAt,
              rechazoEn: new Date(event.created * 1000),
            });
            await prisma.clinic.update({
              where: { id: clinicId },
              data: { subscriptionStatus: "past_due", ...(acceso ? { trialEndsAt: acceso } : {}) },
            });
            await sincronizarSedesIncluidas(clinicId);
            accesoFinal = acceso ?? (accesoAntes ? new Date(accesoAntes) : null);
            correoDestino = antes;
            eraPagadora = eraClinicaPagadora(estadoAntes);
          } else {
            console.warn(
              "[stripe webhook] invoice.payment_failed sin suspender:",
              JSON.stringify({
                clinicId,
                invoiceId: invoice.id,
                billingReason: reason ?? null,
                motivo: motivoSinSuspender,
                estadoFactura: estadoVivoFactura,
              }),
            );
          }
          await logAudit({
            clinicId,
            userId: clinicId,
            entityType: "subscription",
            entityId: invoice.id ?? customerId ?? clinicId,
            action: "update",
            changes: {
              ...(suspende
                ? {
                    subscriptionStatus: { before: null, after: "past_due" },
                    ...(accesoFinal ? { trialEndsAt: { before: null, after: accesoFinal } } : {}),
                  }
                : {}),
              _source: {
                before: null,
                after: {
                  event: event.type,
                  invoiceId: invoice.id,
                  billingReason: reason ?? null,
                  suspended: suspende,
                  ...(motivoSinSuspender && motivoSinSuspender !== "no_aplica" ? { sinSuspender: motivoSinSuspender } : {}),
                  ...(moduloDeLaFactura !== null
                    ? { kind: MODULE_SUBSCRIPTION_KIND, moduleKey: moduloDeLaFactura.moduleKey }
                    : {}),
                },
              },
            },
          });

          // REGISTRO DEL COBRO RECHAZADO — sin esto un cobro fallido de un
          // cliente real no aparece en NINGÚN lado del panel (ni en
          // /admin/payments ni en el "por cobrar" del /admin). La fila queda
          // en status "failed" y se promueve sola a "paid" si el reintento de
          // Stripe acaba cobrando (ver recordStripeInvoice). Defensivo: ni un
          // fallo aquí rompe el 200 al webhook ni la suspensión de arriba.
          try {
            // Una factura que ya está ANULADA (la anulamos al cobrar a una clínica suspendida) y cuyo aviso de fallo llega
            // tarde NO es un cobro rechazado ni un adeudo: queda como «No cobrada: servicio suspendido».
            if (estadoVivoFactura === "void") await registrarComoNoCobrada(invoice, clinicId);
            else await recordStripeInvoice(invoice, clinicId, "failed");
          } catch (e) {
            console.error("[stripe webhook] no se pudo registrar el cobro fallido:", e);
          }

          // AVISO A LA CLÍNICA — una sola vez por cobro rechazado (candado en billing_email_logs). Con la gracia
          // viva: «No pudimos cobrar tu plan…». Si el aviso llega con la gracia ya vencida (webhook caído o
          // entrega reintentada) y era una clínica que paga: UN correo distinto, «tu acceso está suspendido por
          // falta de pago», con el MISMO candado (nunca los dos). Si el envío falla, el webhook NO falla.
          if (suspende && correoDestino && invoice.id && accesoFinal) {
            const vigente = accesoFinal.getTime() > Date.now();
            if (vigente || eraPagadora) {
              await avisarCobroRechazado({
                clinicId,
                invoiceId: invoice.id,
                clinica: correoDestino,
                accesoHasta: accesoFinal,
                siteUrl: SITE_URL,
                tipo: vigente ? "gracia" : "suspendida",
              });
            }
          }
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
            subscriptionStatus: true,
            stripeSubscriptionId: true,
            trialEndsAt: true,
            // Dueño de la clínica (SUPER_ADMIN más antiguo activo) → destinatario
            // preferente de los correos de billing; cae a clinic.email si no hay.
            users: {
              where: { role: "SUPER_ADMIN", isActive: true },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { email: true, firstName: true },
            },
            affiliateId: true,
            affiliate: { select: { commissionPct: true, status: true, payoutMode: true } },
          },
        });

        // FACTURA PAGADA FUERA DE STRIPE (decisión de Rafael, #1(a)): el admin confirmó un pago MANUAL y marcó la factura
        // de tarjeta como pagada fuera de Stripe para que no la reintente. El cobro real es el manual (ya está en
        // `subscription_invoices`): este evento NO crea otro registro de cobro, ni correo de «plan renovado», ni comisión
        // de afiliado, y no duplica ingresos. Solo se limpia la fila de «cobro fallido» de esa factura (sale de «por
        // cobrar») y la suscripción queda viva y al corriente.
        if (clinic && (await esFacturaFueraDeStripe(stripe, invoice))) {
          await reactivarSiStripeYaCobro(stripe, invoice, clinic);
          await prisma.subscriptionInvoice.updateMany({
            where: { clinicId: clinic.id, reference: invoiceId, status: { in: ["failed", "pending"] } },
            data: { status: "void", notes: "Pagada fuera de Stripe (pago manual confirmado)" },
          });
          await logAudit({
            clinicId: clinic.id,
            userId: clinic.id,
            entityType: "subscription",
            entityId: invoiceId,
            action: "update",
            changes: {
              _source: { before: null, after: { event: event.type, invoiceId, pagadaFueraDeStripe: true, registradoComoCobro: false } },
            },
          }).catch(() => {});
          break;
        }

        // ──────────────────────────────────────────────────────────────────
        // REGISTRO DEL COBRO — va ANTES del break por afiliado para que TODA
        // factura pagada quede en subscription_invoices (la fuente de
        // "Cobrado este mes" del /admin, de /admin/payments y de
        // /admin/reports). Idempotente por reference=invoice.id y NUNCA lanza
        // (mismo criterio que el bloque de correos: ni un fallo aquí rompe el
        // 200 al webhook ni la lógica de correos/afiliado).
        // La factura de $0 que genera mover el ciclo a un periodo pagado (`trial_end`) no es un cobro: no entra a ingresos,
        // comisiones ni conteos.
        // Y13: también si Stripe la etiqueta de otro modo (p. ej. `subscription_cycle`): una factura de $0 mientras la suscripción
        // está en un periodo pagado a mano ES la del cambio de ciclo (no existe otra).
        let esFacturaCero = (invoice.amount_paid ?? 0) === 0 && invoice.billing_reason === "subscription_update";
        // Z21: si no se pudo leer la suscripción para decidirlo, una factura de $0 se registra (no se pierde nada) pero NO manda el
        // correo de «plan renovado» por $0: ante la duda, sin correo.
        let ceroSinLectura = false;
        if (!esFacturaCero && clinic?.stripeSubscriptionId && (invoice.amount_paid ?? 0) === 0 && invoice.billing_reason === "subscription_cycle") {
          try {
            esFacturaCero = enPeriodoPagado(await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId));
          } catch {
            esFacturaCero = false;
            ceroSinLectura = true;
          }
        }
        if (clinic && !esFacturaCero) {
          // Y7/Z11: la factura aparte del excedente de CFDI se registra con el método del excedente, no como cobro del plan (así
          // tampoco adelanta la numeración de cobros del afiliado).
          await recordStripeInvoice(invoice, clinic.id, "paid", invoice.metadata?.kind === CFDI_OVERAGE_APARTE_KIND ? CFDI_OVERAGE_METHOD : undefined);
        }

        // La factura APARTE del excedente de CFDI (se cobra sola al mover el ciclo): es dinero real y ya quedó registrado arriba,
        // pero NO es un cobro del plan: sin correo de renovación, sin comisión de afiliado y sin numeración de plan (Y7).
        if (invoice.metadata?.kind === CFDI_OVERAGE_APARTE_KIND) break;

        // Factura de un MÓDULO (ws1-t5): se registra como cobro (arriba) y
        // nada más. No es el plan: sin correo «Tu plan está activo / renovado»
        // (el suyo, «Módulo activado», sale al activarse) y sin comisión de
        // afiliado, que se calcula con las reglas del PLAN y pagaría por una
        // mensualidad de módulo lo mismo que por una de plan.
        if ((await moduloDeFactura(invoice)) !== null) break;

        let reglaCobro: ResultadoReglaCobro = { aplicada: false };
        // REACTIVACIÓN POR PAGO (ws1-t1): una clínica en cobro rechazado cuya suscripción de Stripe ya está
        // cobrada vuelve a active con el periodo pagado, aunque el `customer.subscription.updated` de la
        // recuperación se retrase o no llegue. Solo con el estado VIVO de Stripe (nunca por el evento).
        if (clinic) {
          // Octava vuelta: si la clínica estaba SUSPENDIDA y este cobro de tarjeta entró solo (reintento de Stripe), los
          // meses sin servicio no se deben: se anulan las otras facturas abiertas y el ciclo se re-alinea a «este pago + 30
          // días». Va ANTES de reactivar, para que el periodo que lee sea ya el nuevo.
          reglaCobro = await reglaDeSuspensionPorCobroDeTarjeta(stripe, invoice, clinic, new Date(((invoice.status_transitions?.paid_at ?? event.created) as number) * 1000));
          await reactivarSiStripeYaCobro(stripe, invoice, clinic, reglaCobro.aplicada ? { fin: reglaCobro.fin } : undefined);
        }

        // Primer cobro de la suscripción del PLAN pagado: si la clínica quedó en «incomplete» (el
        // «created» de Stripe llegó después de otro evento), este pago la deja activa. Solo toca
        // «incomplete»; ningún otro estado se cambia aquí.
        if (clinic && invoice.billing_reason === "subscription_create") {
          await prisma.clinic.updateMany({
            where: { id: clinic.id, subscriptionStatus: "incomplete" },
            data: { subscriptionStatus: "active" },
          });
          await sincronizarSedesIncluidas(clinic.id);
        }

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
        if (clinic && !esFacturaCero && !ceroSinLectura) {
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
                    // Tras una suspensión el ciclo se movió: el próximo cobro es el fin de lo pagado, no el de la factura
                    // vieja (una fecha ya pasada).
                    const nextBillingDate = reglaCobro.aplicada && reglaCobro.fin
                      ? reglaCobro.fin
                      : lineEnd
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

        // ── MOTOR DE COMISIONES (@/lib/affiliates/payout) ──────────────────
        // Cuánto se le paga al afiliado por esta factura, con las reglas que el
        // admin configura en /admin:
        //  · El PRIMER cobro NO paga (es el mes promocional): la comisión
        //    arranca en `startAtInvoiceNo`.
        //  · La MODALIDAD (fijo recurrente / pago único) queda CONGELADA por
        //    clínica en AffiliateClinicTerms al atribuirse el alta; si el
        //    afiliado la cambia después, solo afecta a sus próximas clínicas.
        //  · Los MONTOS no se congelan: se toma el valor VIGENTE de la config
        //    al generarse la comisión (mismo criterio que el % del nivel).
        //  · Una factura ANUAL paga el fijo × los meses que cubre.
        //  · El pago único se entrega UNA sola vez por clínica (candado
        //    atómico `oneTimePaidAt` dentro de la transacción, más abajo).
        // DEGRADACIÓN: sin el SQL del motor aplicado `getPayoutConfig()`
        // devuelve null y se conserva el comportamiento histórico EXACTO
        // (% del nivel sobre lo pagado) — cero regresión.

        // Meses cubiertos: manda el periodo de la línea; si Stripe no lo trae,
        // el de la factura; si tampoco, 1 mes. Ambos vienen en SEGUNDOS.
        const line = invoice.lines?.data?.[0]?.period ?? null;
        const periodStart = line?.start ?? invoice.period_start ?? null;
        const periodEnd = line?.end ?? invoice.period_end ?? null;
        const months =
          periodStart && periodEnd
            ? monthsCovered(new Date(periodStart * 1000), new Date(periodEnd * 1000))
            : 1;

        // Factura de PRORRATEO (cambio de plan a mitad de ciclo): cubre días
        // sueltos de un periodo que el motor YA comisionó. Con montos fijos
        // pagaría un mes entero de más, así que el motor la deja pasar sin
        // comisión (en modo % se comporta igual que siempre). getInvoiceNo
        // tampoco la cuenta, para que un upgrade no corra la numeración.
        const isProration = invoice.billing_reason === "subscription_update";

        // Config, número de cobro y términos congelados. Los tres degradan a
        // null sin lanzar: si falta cualquiera NO se arriesga un monto nuevo.
        const payoutCfg = await getPayoutConfig();
        let invoiceNo: number | null = null;
        let terms: ClinicTerms | null = null;
        if (payoutCfg) {
          invoiceNo = await getInvoiceNo(clinic.id, invoiceId);
          terms = await getClinicTerms(clinic.id);
          // Backstop para las clínicas referidas ANTES de esta ola (aún sin
          // términos): se les congela ahora la modalidad vigente del afiliado.
          if (!terms) {
            terms = await ensureClinicTerms(
              clinic.id,
              clinic.affiliateId,
              effectiveAffiliateMode(clinic.affiliate.payoutMode, payoutCfg),
            );
          }
        }
        const useEngine = payoutCfg != null && invoiceNo != null && terms != null;

        const resolved: ResolvedCommission | null = useEngine
          ? resolveCommission({
              plan: normalizePlanKey(clinic.plan),
              amountMxn,
              invoiceNo,
              months,
              mode: terms.payoutMode,
              oneTimeAlreadyPaid: terms.oneTimePaidAt != null,
              cfg: payoutCfg,
              levelPct: pct,
              programMode: payoutCfg.defaultMode,
              isProration,
            })
          : { kind: "pct", totalMxn: calcCommissionMxn(amountMxn, pct), months: 1 };

        // null = esta factura NO genera comisión (cobro promocional, pago único
        // ya entregado o monto fijo apagado): ni fila ni correo.
        if (!resolved) break;

        // ── UN SOLO DUEÑO POR COMISIÓN ─────────────────────────────────────
        // La comisión que resolvió el motor es ÍNTEGRAMENTE del afiliado al que
        // está atribuida la clínica. No se reparte con nadie: quien lo invitó
        // al programa NO cobra un peso por las clínicas de su invitado. Ese es
        // el corazón del segundo nivel — el invitado es un afiliado normal y su
        // dinero es suyo; a quien invita se le premia aparte, con los BONOS POR
        // RED (@/lib/affiliates/network-bonus), que se otorgan por escalones de
        // clínicas sostenidas y jamás factura por factura.
        // Si algún día vuelve a aparecer aquí un segundo `create` con otro
        // affiliateId, es que el modelo cambió: no es un detalle de implementación.
        try {
          // La transacción SOLO hace falta para el candado del pago único; en
          // los demás casos se conserva el create suelto de siempre.
          if (resolved.kind === "onetime") {
            await prisma.$transaction(async (tx) => {
              // CANDADO del pago único: si otro proceso ya lo reclamó, aborta
              // ANTES de escribir nada (no se paga dos veces la misma clínica).
              const claimed = await claimOneTimePayout(tx, clinic.id);
              if (!claimed) throw oneTimeClaimedError();
              await tx.affiliateCommission.create({
                data: {
                  affiliateId: clinic.affiliateId,
                  clinicId: clinic.id,
                  stripeInvoiceId: invoiceId,
                  // amountMxn = lo que pagó la clínica (auditoría); el monto de
                  // la comisión puede ser fijo y no guardar relación con él.
                  amountMxn,
                  commissionMxn: resolved.totalMxn,
                  kind: resolved.kind,
                  monthsCovered: resolved.months,
                  status: "pending",
                },
              });
            });
          } else {
            await prisma.affiliateCommission.create({
              data: {
                affiliateId: clinic.affiliateId,
                clinicId: clinic.id,
                stripeInvoiceId: invoiceId,
                amountMxn,
                commissionMxn: resolved.totalMxn,
                kind: resolved.kind,
                monthsCovered: resolved.months,
                status: "pending",
              },
            });
          }
          // Email de conversión al afiliado (solo la 1a comisión de la
          // clínica; el helper lo verifica). Fire-and-forget: el webhook
          // NO espera el envío.
          sendAffiliateConversionEmail({
            affiliateId: clinic.affiliateId,
            clinicId: clinic.id,
            commissionMxn: resolved.totalMxn,
          }).catch(() => {});
        } catch (err: any) {
          // P2002 = unique violation → la comisión ya existía, no-op.
          // ONE_TIME_ALREADY_CLAIMED = el pago único de esta clínica ya se
          // entregó y la transacción se abortó a propósito → también no-op.
          if (err?.code !== "P2002" && err?.code !== ONE_TIME_CLAIMED_CODE) throw err;
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
        // topupId: la reserva PENDING de una auto-recarga (chargeOffSession); así
        // esta acreditación y la inline transicionan la misma fila.
        await creditWalletFromStripe({
          clinicId,
          amountCents,
          paymentIntentId: pi.id,
          topupId: pi.metadata?.topupId || null,
        });
        // Si este aviso llega tarde (Stripe reintenta durante días) y el pago ya
        // se reembolsó o se disputó entretanto, el reembolso llegó ANTES que el
        // abono y no encontró nada que descontar. Se cuadra aquí también.
        await revertirRecargaStripe(stripe, pi.id);

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
        await recordFailedTopup(
          clinicId,
          Number(pi.metadata?.amountCents) || pi.amount,
          pi.id,
          pi.metadata?.topupId || null,
        );
        break;
      }

      // ── Reembolsos y contracargos de recargas del monedero (H3). Sin esto,
      //    una clínica recargaba, pedía el reembolso o disputaba el cargo, y se
      //    quedaba con el dinero Y con el saldo. Todos estos eventos hacen lo
      //    mismo: le preguntan a Stripe cómo está HOY ese PaymentIntent
      //    (reembolsado, disputado, disputa ganada…) y cuadran el saldo contra
      //    eso con un movimiento REFUND. Idempotente: el mismo evento dos veces,
      //    o dos eventos del mismo reembolso, descuentan una sola vez. Si el
      //    PaymentIntent no es una recarga del monedero, no hace nada.
      //    🔴 Estos eventos hay que SUSCRIBIRLOS en el panel de Stripe.
      case "charge.refunded":
      case "charge.refund.updated":
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated": {
        const piId = paymentIntentDeEvento(event.data.object);
        if (!piId) break;
        const r = await revertirRecargaStripe(stripe, piId);
        if (r.aplicado) {
          console.info("[ai-wallet] reembolso/contracargo cuadrado", {
            evento: event.type,
            clinicId: r.clinicId,
            deltaCents: r.deltaCents,
            balanceAfterCents: r.balanceAfterCents,
          });
        }
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

/**
 * ¿Esta factura se pagó FUERA de Stripe (`paid_out_of_band`)? El evento la trae según la versión de API del webhook;
 * si no trae el campo se lee la factura con la versión fija de nuestro cliente. Si Stripe no contesta se LANZA el error
 * (5xx → Stripe reintenta el evento, igual que `estadoVivoDeFactura`): asumir «no» registraría el cobro de tarjeta de una
 * factura que se pagó a mano, duplicando el ingreso, la comisión y el correo.
 */
async function esFacturaFueraDeStripe(stripe: Stripe, invoice: Stripe.Invoice): Promise<boolean> {
  const enEvento = (invoice as { paid_out_of_band?: boolean | null }).paid_out_of_band;
  if (typeof enEvento === "boolean") return enEvento;
  if (!invoice.id) return false;
  return ((await stripe.invoices.retrieve(invoice.id)) as { paid_out_of_band?: boolean | null }).paid_out_of_band === true;
}

/**
 * Estado VIVO de la factura de este `invoice.payment_failed` en Stripe («open», «paid», «void»,
 * «uncollectible»; solo «open» e «uncollectible» suspenden). Si Stripe no contesta se LANZA el error: el webhook responde 5xx y Stripe reintenta el
 * evento (igual que `debeReintentarPorEstadoVivo`); asumir «no está pagada» suspendía a quien ya pagó.
 * Sin id de factura no hay nada que contrastar: null (no suspende).
 */
async function estadoVivoDeFactura(stripe: Stripe, invoice: Stripe.Invoice): Promise<string | null> {
  if (!invoice.id) return null;
  return (await stripe.invoices.retrieve(invoice.id)).status ?? null;
}

async function cargarClinicaParaRechazo(clinicId: string) {
  return prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      trialEndsAt: true,
      nextBillingDate: true,
      name: true,
      email: true,
      plan: true,
      timezone: true,
      users: {
        where: { role: "SUPER_ADMIN", isActive: true },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { email: true, firstName: true },
      },
    },
  });
}

/**
 * ¿Un pago MANUAL ya cubre a la clínica frente a esta factura de Stripe? (ver pagoManualCubreLaFactura).
 * Una consulta con el `clinicId` ya resuelto por el cliente de Stripe; si falla, el error sube (5xx → reintento).
 */
async function pagoManualCubre(
  clinicId: string,
  invoice: Stripe.Invoice,
  clinica: { trialEndsAt: Date | null; nextBillingDate: Date | null } | null,
): Promise<boolean> {
  const creadaEn = new Date((invoice.created ?? 0) * 1000);
  const posterior = await prisma.subscriptionInvoice.findFirst({
    where: {
      clinicId,
      status: "paid",
      paidAt: { gt: creadaEn },
      // Lista explícita de los métodos de pago MANUAL del plan (no «cualquiera que no sea Stripe»).
      OR: [{ method: null }, { method: { in: [...METODOS_DE_PAGO_MANUAL_DEL_PLAN] } }],
    },
    select: { id: true },
  });
  const finSegundos = Math.max(0, ...(invoice.lines?.data ?? []).map((l) => l?.period?.end ?? 0));
  return pagoManualCubreLaFactura({
    hayPagoManualPosterior: posterior !== null,
    finPeriodoFacturado: finSegundos > 0 ? new Date(finSegundos * 1000) : null,
    accesoActual: clinica?.trialEndsAt,
    proximoCobro: clinica?.nextBillingDate,
  });
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
 * Aplica el plan superior cuando se CONFIRMA el pago del diferencial prorrateado
 * de una clínica que paga SPEI/OXXO (sin suscripción de tarjeta).
 *
 * Deliberadamente NO toca `trialEndsAt`, `nextBillingDate` ni
 * `subscriptionStatus`: la clínica pagó solo la DIFERENCIA por los días que le
 * quedaban, no un periodo nuevo — el periodo no se extiende, solo mejora el plan.
 * Idempotente: escribir el mismo plan dos veces es un no-op (Stripe puede
 * reenviar el evento).
 */
async function applyPlanUpgradeDiff(
  clinicId: string,
  plan: string | null,
  source: { event: string; sessionId?: string },
): Promise<void> {
  // Todo descarte se REGISTRA: en los tres casos el cliente YA pagó el
  // diferencial. Un return mudo dejaba un cobro acreditado sin plan aplicado y
  // sin rastro para detectarlo ni devolverlo.
  const drop = async (reason: string, extra: Record<string, unknown>) => {
    console.error(
      `[stripe webhook] plan-upgrade-diff PAGADO pero NO aplicado (${reason}):`,
      JSON.stringify({ clinicId, incomingPlan: plan, ...extra, ...source }),
    );
    await logAudit({
      clinicId,
      userId: clinicId,
      entityType: "subscription",
      entityId: source.sessionId ?? clinicId,
      action: "update",
      changes: {
        _source: {
          before: null,
          after: {
            ...source,
            kind: PLAN_UPGRADE_DIFF_KIND,
            result: "not_applied",
            reason,
            incomingPlan: plan,
            ...extra,
          },
        },
      },
    }).catch(() => {});
  };

  if (!isPlanId(plan)) {
    await drop("invalid-plan", {});
    return;
  }
  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { plan: true },
  });
  if (!before) {
    await drop("clinic-not-found", {});
    return;
  }

  // Este pago SOLO puede SUBIR de plan. Un voucher SPEI/OXXO tarda horas o días
  // y puede llegar cuando la clínica ya está en un plan MAYOR por otra vía (un
  // segundo voucher pagado antes, un alta con tarjeta, un reenvío del evento
  // desde Stripe). Sin esta guarda, escribir metadata.plan a ciegas la BAJABA de
  // plan en silencio, cobrada y todo. PLAN_IDS es el orden canónico de tiers
  // (BASIC → PRO → CLINIC).
  //
  // OJO: un reenvío del MISMO evento cae aquí y es correcto (no-op idempotente),
  // pero un SEGUNDO voucher pagado por el mismo upgrade también — ahí sí hay
  // dinero cobrado dos veces. La fila de bitácora es la que permite detectarlo.
  if (!isPlanTierUpgrade(before.plan, plan)) {
    await drop("not-a-tier-upgrade", { currentPlan: before.plan });
    return;
  }

  const limits = await getPlanLimits(plan);
  await prisma.clinic.update({
    where: { id: clinicId },
    data: { plan, aiTokensLimit: limits.aiTokensDefault },
  });
  await sincronizarSedesIncluidas(clinicId);

  await logAudit({
    clinicId,
    userId: clinicId, // sin user en webhook context — usamos clinicId como placeholder
    entityType: "subscription",
    entityId: source.sessionId ?? clinicId,
    action: "update",
    changes: {
      plan: { before: before.plan, after: plan },
      _source: { before: null, after: { ...source, kind: PLAN_UPGRADE_DIFF_KIND, periodExtended: false } },
    },
  });
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
  // Con el cobro rechazado o cancelada, `nextBillingDate` es el periodo que Stripe abrió y NO se pagó:
  // no cuenta para el nuevo (ver inicioDeNuevoPeriodo); si no, reactivar regalaba un mes.
  const base = inicioDeNuevoPeriodo({
    ahora: new Date(),
    estadoAntes: before?.subscriptionStatus,
    trialEndsAt: before?.trialEndsAt,
    nextBillingDate: before?.nextBillingDate,
  });
  const next = billing === "annual" ? addYears(base, 1) : addMonths(base, 1);

  // Plan elegido en el checkout (source.plan, viene de session.metadata.plan).
  // Si es válido, fija plan + cupo de IA acorde; si no, deja lo existente.
  // Cubre tarjeta (checkout.session.completed) y SPEI/OXXO (async_payment_succeeded).
  const planBloqueadoPorSedes = isPlanId(source.plan) ? await bloqueoDeSedesParaPlan(clinicId, source.plan) : null;
  const planFields = isPlanId(source.plan) && !planBloqueadoPorSedes
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
  // A1 (ws1-t5): las sedes incluidas siguen a la madre también al reactivar/renovar.
  await sincronizarSedesIncluidas(clinicId);

  // SPEI/OXXO de Stripe (pago único, sin suscripción nueva): es un pago manual. Si la clínica tiene una suscripción de
  // tarjeta viva con la factura del plan abierta o incobrable, esa factura queda pagada fuera de Stripe para que no la
  // reintente. No lanza ni deshace la activación; si falla, queda en la bitácora.
  let facturaTarjeta: Awaited<ReturnType<typeof marcarFacturasDeLaClinica>> | null = null;
  if (subscriptionId === null) {
    facturaTarjeta = await marcarFacturasDeLaClinica(clinicId, { estabaSuspendida: clinicaEstabaSuspendida(before) });
    // Con suscripción de tarjeta de por medio, este pago único no deja ninguna fila de pago manual: sin ella, si el
    // marcado falló y el reintento de Stripe vuelve a fallar dentro de la gracia, la clínica que pagó se suspendería, y
    // el aviso persistente de /admin no la vería. Se deja el mismo rastro de $0 que la activación de /admin (el pago real
    // ya lo cuenta Stripe; esta fila no suma ingresos ni comisiones, ver pagos-reales).
    if (facturaTarjeta.tipo !== "sin_tarjeta") {
      await prisma.subscriptionInvoice
        .create({
          data: {
            clinicId,
            amount: 0,
            currency: "MXN",
            status: "paid",
            method: METODO_ACTIVACION_ADMIN,
            reference: source.sessionId ? `pago-unico:${source.sessionId}` : undefined,
            periodStart: new Date(),
            periodEnd: next,
            paidAt: new Date(),
            notes: "Pago único de Stripe (SPEI/OXXO) acreditado · rastro para la factura de tarjeta (sin cobro registrado aquí)",
          },
        })
        .catch((e: { code?: string }) => {
          if (e?.code !== "P2002") console.error("[stripe webhook] no se pudo dejar el rastro del pago único:", e);
        });
    }
  }

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
      _source: { before: null, after: { ...source, ...(facturaTarjeta ? { facturaTarjeta } : {}) } },
    },
  });
}

/**
 * Activa/renueva/reactiva UN módulo del marketplace para una clínica desde
 * un pago real de Stripe (ws1-t2). El periodo que se fija aquí es un
 * PLACEHOLDER inmediato (ahora + 1 mes/año): para tarjeta, el evento
 * `customer.subscription.*` que Stripe manda justo después lo corrige con
 * el `current_period_end` REAL (ver `syncModuleSubscription`); para
 * SPEI/OXXO (pago único, sin auto-renovación) este valor YA es el
 * definitivo. Upsert por `[clinicId, moduleId]`: reenviar el MISMO evento
 * de Stripe (reintento/reenvío manual) escribe la misma fila, no duplica
 * nada — idempotente por construcción.
 *
 * Una activación "admin" (Rafael Clínica, clínica de prueba) SOLO puede
 * pisarse si esa misma clínica de verdad compra el módulo por Stripe — el
 * checkout (`/api/marketplace/module-checkout`) ya bloquea la compra si
 * `hasActiveAccess` es true, así que en la práctica esto nunca ocurre para
 * las clínicas con "admin"; si alguna vez pasara, es el comportamiento
 * documentado desde que se creó el toggle de admin
 * (`toggle-clinic-module.ts`): "si la clínica luego compra el módulo, el
 * upsert real reemplaza este admin grant".
 */
async function activateModulePurchase(
  stripe: Stripe,
  clinicId: string,
  moduleKey: string,
  opts: {
    billing: ModuleBillingCycle;
    method: ModulePaymentMethod;
    amountMxn: number;
    stripeSubscriptionId: string | null;
    source: { event: string; sessionId: string };
  },
): Promise<void> {
  const mod = await prisma.module.findUnique({ where: { key: moduleKey }, select: { id: true } });
  if (!mod) return;

  const before = await prisma.clinicModule.findUnique({
    where: { clinicId_moduleId: { clinicId, moduleId: mod.id } },
    select: { status: true, stripeSubscriptionId: true },
  });

  // DOBLE PAGO, red de seguridad final (ws1-t2, 28-sep-2026): el checkout ya
  // rechaza si hay una sesión/suscripción en curso, pero dos pagos que se
  // completan casi a la vez en dos pestañas pueden llegar aquí los dos. Si
  // ya hay una suscripción de tarjeta ACTIVA con OTRO stripeSubscriptionId,
  // la que llega ahora se cancela en Stripe (nunca vuelve a cobrar) y NO se
  // toca `clinic_modules` — gana la que activó primero.
  const conflicto = resolveActivationConflict(before, opts.stripeSubscriptionId);
  if (conflicto.type === "cancel_incoming") {
    if (opts.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(opts.stripeSubscriptionId);
      } catch (e) {
        console.error("[webhook] no se pudo cancelar la suscripción duplicada:", e);
      }
    }
    await logAudit({
      clinicId,
      userId: clinicId,
      entityType: "subscription",
      entityId: opts.stripeSubscriptionId ?? opts.source.sessionId,
      action: "update",
      changes: {
        _source: {
          before: null,
          after: { ...opts.source, kind: MODULE_SUBSCRIPTION_KIND, moduleKey, resultado: "cancelada_por_duplicada", motivo: conflicto.reason },
        },
      },
    });
    return;
  }

  const now = new Date();
  const periodEnd = opts.billing === "annual" ? addYears(now, 1) : addMonths(now, 1);
  const write = buildActivateModuleWrite({
    billing: opts.billing,
    amountMxn: opts.amountMxn,
    paymentMethod: opts.method,
    stripeSubscriptionId: opts.stripeSubscriptionId,
    currentPeriodEnd: periodEnd,
    now,
  });

  await prisma.clinicModule.upsert({
    where: { clinicId_moduleId: { clinicId, moduleId: mod.id } },
    create: { clinicId, moduleId: mod.id, ...write },
    update: write,
  });

  // Correo «Módulo activado» (ws1-t5): antes la clínica pagaba y no le llegaba
  // nada. Un solo correo por suscripción (o por sesión de pago, en SPEI/OXXO)
  // aunque Stripe reenvíe el evento. Fire-and-forget: nunca lanza ni retrasa
  // el 200 al webhook.
  notifyModuleActivated({
    clinicId,
    moduleKey,
    origen: "compra",
    referencia: opts.stripeSubscriptionId ?? opts.source.sessionId,
    amountMxn: opts.amountMxn,
    billing: opts.billing,
    method: opts.method,
    periodEnd,
  }).catch(() => {});

  await logAudit({
    clinicId,
    userId: clinicId, // sin user en webhook context — mismo placeholder que activatePlatformSubscription
    entityType: "subscription",
    entityId: opts.stripeSubscriptionId ?? opts.source.sessionId,
    action: "update",
    changes: {
      status: { before: before?.status ?? null, after: "active" },
      _source: { before: null, after: { ...opts.source, kind: MODULE_SUBSCRIPTION_KIND, moduleKey } },
    },
  });
}

/**
 * `customer.subscription.created`/`.updated` de un módulo: corrige el
 * `currentPeriodEnd` con el valor REAL de Stripe (renovación) y refleja
 * active/paused según el status de la suscripción. Nunca crea la fila —
 * si no existe un ClinicModule para esta suscripción, no hace nada (la
 * creación siempre pasa primero por `activateModulePurchase`, disparada
 * por `checkout.session.completed`, que sí la conoce).
 */
async function syncModuleSubscription(sub: Stripe.Subscription, eventType: string): Promise<void> {
  const clinicId = sub.metadata?.clinicId as string | undefined;
  const moduleKey = sub.metadata?.moduleKey as string | undefined;
  if (!clinicId || !moduleKey) return;

  const mod = await prisma.module.findUnique({ where: { key: moduleKey }, select: { id: true } });
  if (!mod) return;

  const existing = await prisma.clinicModule.findUnique({
    where: { clinicId_moduleId: { clinicId, moduleId: mod.id } },
    select: { id: true, status: true },
  });

  const periodEndSeconds = subscriptionPeriodEndSeconds(sub);
  const action = resolveModuleSubscriptionSync({
    clinicModuleExists: existing !== null,
    subscriptionStatus: sub.status,
    periodEndFromStripe: periodEndSeconds ? new Date(periodEndSeconds * 1000) : null,
  });
  if (action.type === "noop" || !existing) return;

  await prisma.clinicModule.update({
    where: { id: existing.id },
    data: {
      status: action.status,
      stripeSubscriptionId: sub.id,
      ...(action.currentPeriodEnd ? { currentPeriodEnd: action.currentPeriodEnd } : {}),
    },
  });

  await logAudit({
    clinicId,
    userId: clinicId,
    entityType: "subscription",
    entityId: sub.id,
    action: "update",
    changes: {
      status: { before: existing.status, after: action.status },
      _source: { before: null, after: { event: eventType, subscriptionId: sub.id, kind: MODULE_SUBSCRIPTION_KIND, moduleKey } },
    },
  });
}

/**
 * `customer.subscription.deleted` de un módulo: Stripe cerró el periodo
 * (cancelación programada por el cliente, o pago finalmente rechazado tras
 * los reintentos). Marca `clinic_modules.status = 'cancelled'` — NO borra
 * la fila ni toca ningún dato del caso clínico. Una activación "admin"
 * nunca llega aquí en la práctica (no tiene `stripeSubscriptionId`, Stripe
 * no le manda eventos), pero `resolveModuleDeletion` la protege igual por
 * si acaso.
 */
async function cancelModuleSubscription(sub: Stripe.Subscription, eventType: string): Promise<void> {
  const clinicId = sub.metadata?.clinicId as string | undefined;
  const moduleKey = sub.metadata?.moduleKey as string | undefined;
  if (!clinicId || !moduleKey) return;

  const mod = await prisma.module.findUnique({ where: { key: moduleKey }, select: { id: true } });
  if (!mod) return;

  const existing = await prisma.clinicModule.findUnique({
    where: { clinicId_moduleId: { clinicId, moduleId: mod.id } },
    select: { id: true, paymentMethod: true, stripeSubscriptionId: true, status: true },
  });

  const action = resolveModuleDeletion(existing);
  if (action.type === "noop" || !existing) return;

  await prisma.clinicModule.update({
    where: { id: existing.id },
    data: { status: "cancelled", cancelledAt: new Date() },
  });

  await logAudit({
    clinicId,
    userId: clinicId,
    entityType: "subscription",
    entityId: sub.id,
    action: "update",
    changes: {
      status: { before: existing.status, after: "cancelled" },
      _source: { before: null, after: { event: eventType, subscriptionId: sub.id, kind: MODULE_SUBSCRIPTION_KIND, moduleKey } },
    },
  });
}

/**
 * ¿Esta factura es de la suscripción de un módulo? Primero por la metadata que
 * la factura hereda de la suscripción; si Stripe no la mandó, por la propia
 * suscripción contra `clinic_modules`. `null` = no es de un módulo (o no se
 * pudo saber: se trata como factura del plan, que es lo de siempre).
 */
async function moduloDeFactura(invoice: Stripe.Invoice): Promise<{ moduleKey: string | null } | null> {
  const ref = referenciaDeFactura(invoice as unknown as Parameters<typeof referenciaDeFactura>[0]);
  if (ref.esDeModulo) return { moduleKey: ref.moduleKey };
  if (!ref.stripeSubscriptionId) return null;
  try {
    const cm = await prisma.clinicModule.findUnique({
      where: { stripeSubscriptionId: ref.stripeSubscriptionId },
      select: { module: { select: { key: true } } },
    });
    return cm ? { moduleKey: cm.module.key } : null;
  } catch (e) {
    console.error("[stripe webhook] no se pudo comprobar si la factura es de un módulo:", e);
    return null;
  }
}
