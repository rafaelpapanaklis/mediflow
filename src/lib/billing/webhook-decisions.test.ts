/**
 * Tests de las DECISIONES que toman los handlers del webhook de Stripe, con
 * eventos sintéticos y sin red.
 *
 * Run: npm run test:billing
 *
 * Los handlers de `src/app/api/webhooks/stripe/route.ts` no se pueden invocar
 * enteros offline (verifican la firma de Stripe y escriben en Postgres), así que
 * lo que se prueba aquí es la capa de decisión que extrajimos a `proration.ts` y
 * que el webhook consume: es la que decide si se suspende a la clínica, si se
 * pisa la fecha de renovación y si se aplica el plan. Los tests estructurales de
 * `billing-guards.test.ts` verifican que el webhook siga usando estos helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSuspendForFailedInvoice,
  isPlanTierUpgrade,
  nextBillingDateFields,
  subscriptionPeriodEndSeconds,
} from "./proration";

// ── Eventos sintéticos (forma real de Stripe) ───────────────────────────────

const invoicePaymentFailed = (billingReason: string | null) => ({
  id: "evt_1",
  type: "invoice.payment_failed" as const,
  data: { object: { id: "in_1", customer: "cus_1", billing_reason: billingReason } },
});

const subscriptionUpdated = (object: Record<string, unknown>) => ({
  id: "evt_2",
  type: "customer.subscription.updated" as const,
  data: { object: { id: "sub_1", customer: "cus_1", status: "active", ...object } },
});

const PERIOD_END = Math.floor(new Date("2026-08-18T12:00:00.000Z").getTime() / 1000);

// ── invoice.payment_failed → ¿suspende? ─────────────────────────────────────

test("invoice.payment_failed de un PRORRATEO no escribe past_due", () => {
  // Es el evento que dispara always_invoice al subir de plan. Suspender aquí le
  // quitaría a la clínica el acceso al plan que YA paga por intentar mejorarlo.
  const event = invoicePaymentFailed("subscription_update");
  assert.equal(canSuspendForFailedInvoice(event.data.object.billing_reason), false);
});

test("invoice.payment_failed de la RENOVACIÓN sí marca past_due", () => {
  // Regresión: el comportamiento que ya funcionaba no se puede romper.
  assert.equal(canSuspendForFailedInvoice(invoicePaymentFailed("subscription_cycle").data.object.billing_reason), true);
  assert.equal(canSuspendForFailedInvoice(invoicePaymentFailed("subscription_create").data.object.billing_reason), true);
});

test("invoice.payment_failed sin billing_reason no suspende", () => {
  assert.equal(canSuspendForFailedInvoice(invoicePaymentFailed(null).data.object.billing_reason), false);
});

// ── customer.subscription.updated → nextBillingDate ─────────────────────────

test("subscription.updated SIN current_period_end NO sobreescribe nextBillingDate", () => {
  const event = subscriptionUpdated({});
  const fields = nextBillingDateFields(event.data.object);
  assert.deepEqual(fields, {});
  assert.equal("nextBillingDate" in fields, false, "la llave no debe existir: Prisma escribiría null");
});

test("subscription.updated con current_period_end en la suscripción escribe la fecha", () => {
  const fields = nextBillingDateFields(subscriptionUpdated({ current_period_end: PERIOD_END }).data.object);
  assert.ok(fields.nextBillingDate instanceof Date);
  assert.equal(fields.nextBillingDate?.toISOString(), "2026-08-18T12:00:00.000Z");
});

test("subscription.updated con el periodo en el ITEM (API nueva) también escribe la fecha", () => {
  // En las versiones nuevas de la API el fin de periodo migró al item; sin este
  // fallback el campo llegaba undefined y la fecha se borraba.
  const event = subscriptionUpdated({ items: { data: [{ id: "si_1", current_period_end: PERIOD_END }] } });
  const fields = nextBillingDateFields(event.data.object);
  assert.equal(fields.nextBillingDate?.toISOString(), "2026-08-18T12:00:00.000Z");
});

test("subscription.updated con items vacío no rompe ni borra la fecha", () => {
  assert.deepEqual(nextBillingDateFields(subscriptionUpdated({ items: { data: [] } }).data.object), {});
  assert.deepEqual(nextBillingDateFields(subscriptionUpdated({ items: {} }).data.object), {});
  assert.deepEqual(nextBillingDateFields(null), {});
  assert.deepEqual(nextBillingDateFields(undefined), {});
});

test("subscriptionPeriodEndSeconds: la suscripción gana al item cuando ambos vienen", () => {
  const sub = { current_period_end: 100, items: { data: [{ current_period_end: 200 }] } };
  assert.equal(subscriptionPeriodEndSeconds(sub), 100);
  assert.equal(subscriptionPeriodEndSeconds({ items: { data: [{ current_period_end: 200 }] } }), 200);
  assert.equal(subscriptionPeriodEndSeconds({}), undefined);
});

// ── checkout.session.completed (plan-upgrade-diff) → ¿aplica el plan? ───────

const diffSession = (plan: string, paymentStatus = "paid") => ({
  id: "evt_3",
  type: "checkout.session.completed" as const,
  data: {
    object: {
      id: "cs_1",
      payment_status: paymentStatus,
      metadata: { kind: "plan-upgrade-diff", clinicId: "cl_1", plan },
    },
  },
});

test("el diferencial pagado aplica el plan solo si es un tier SUPERIOR", () => {
  const session = diffSession("PRO");
  assert.equal(isPlanTierUpgrade("BASIC", session.data.object.metadata.plan), true);
});

test("un voucher tardío NUNCA baja de plan", () => {
  // OXXO/SPEI tardan hasta 3 días: el evento puede llegar cuando la clínica ya
  // está en un plan mayor por otra vía. Escribir metadata.plan a ciegas la
  // BAJARÍA en silencio, cobrada y todo.
  assert.equal(isPlanTierUpgrade("CLINIC", "PRO"), false);
  assert.equal(isPlanTierUpgrade("PRO", "BASIC"), false);
  assert.equal(isPlanTierUpgrade("CLINIC", "BASIC"), false);
});

test("reenvío del MISMO evento: aplicar el plan dos veces es idempotente", () => {
  // Stripe reintenta y el dashboard tiene botón "Resend". La segunda entrega ve
  // la clínica YA en PRO → el guard la ignora en vez de reescribir/duplicar.
  const session = diffSession("PRO");
  const incoming = session.data.object.metadata.plan;
  assert.equal(isPlanTierUpgrade("BASIC", incoming), true, "1ª entrega: aplica");
  assert.equal(isPlanTierUpgrade("PRO", incoming), false, "2ª entrega: no-op");
});

test("el tier se compara con el orden canónico BASIC → PRO → CLINIC", () => {
  assert.equal(isPlanTierUpgrade("BASIC", "CLINIC"), true);
  assert.equal(isPlanTierUpgrade("BASIC", "BASIC"), false);
  assert.equal(isPlanTierUpgrade("PRO", "CLINIC"), true);
  // Plan desconocido/vacío en la clínica: cualquier plan válido cuenta como subida.
  assert.equal(isPlanTierUpgrade(null, "BASIC"), true);
  assert.equal(isPlanTierUpgrade("LEGACY", "BASIC"), true);
  // Plan entrante inválido: nunca se aplica.
  assert.equal(isPlanTierUpgrade("BASIC", "SUPER"), false);
  assert.equal(isPlanTierUpgrade("BASIC", null), false);
});

test("un voucher SIN acreditar no se toma como pagado", () => {
  // checkout.session.completed llega también con SPEI/OXXO pendiente: el plan
  // solo se aplica cuando payment_status es "paid" (o vía async_payment_succeeded).
  assert.equal(diffSession("PRO", "unpaid").data.object.payment_status === "paid", false);
  assert.equal(diffSession("PRO", "paid").data.object.payment_status === "paid", true);
});
