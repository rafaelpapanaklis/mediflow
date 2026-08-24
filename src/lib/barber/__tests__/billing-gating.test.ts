/**
 * DaleControl BARBER — pruebas OFFLINE del gate por plan y del cobro.
 *
 * Run (sin BD ni Stripe; el hook resuelve "server-only" y stubbea prisma):
 *   node --import tsx --import ./scripts/barber-test-hook.mjs --test src/lib/barber/__tests__/billing-gating.test.ts
 * (ver el reporte en ORQUESTA.md para el hook exacto usado en la verificación)
 *
 * Qué se prueba: la capa de DECISIÓN que consumen las rutas y el webhook —
 * límites y features leídos de la tabla (con números SINTÉTICOS, no los del
 * seed, para demostrar que nada está escrito en código), el filtro de eventos
 * ajenos (dental / T4), la idempotencia de aplicar la misma suscripción dos
 * veces, el veto de tier del prorrateo y el contrato con Stripe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BarberPlanGateError,
  barberGateErrorPayload,
  evaluateBarberFeature,
  evaluateBarberLimit,
  limitReachedMessage,
  pickBarberPlanForLimit,
} from "@/lib/barber/gating";
import {
  applyBarberSubscription,
  buildBarberSubscriptionUpdateParams,
  handleBarberStripeEvent,
  isBarberPriceUsable,
  isBarberWebhookEventType,
  planAmountCents,
  planFirstMonthDiscountCents,
  previewAmountDueCents,
  resolveBarberChangeDirection,
  subscriptionPatchFromStripe,
  subscriptionPeriodEndSeconds,
  toCents,
  type BarberBillingDb,
  type BarberShopRef,
} from "@/lib/barber/billing";
import { getBarberT } from "@/i18n/dictionaries/barber";
import {
  BARBER_UNLIMITED,
  FALLBACK_BARBER_PLAN_CONFIG,
  barberNavItemsWhileUnpaid,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";
import { BARBER_NAV_ITEMS } from "@/lib/barber/types";

test("menú impago: solo la sección cuenta sin Configuración (camino claro a pagar)", () => {
  const nav = barberNavItemsWhileUnpaid(BARBER_NAV_ITEMS);
  assert.deepEqual(nav.map((i) => i.key), ["suscripcion"]);
});

// ── Planes SINTÉTICOS (números distintos del seed a propósito) ───────────
function plan(over: Partial<BarberResolvedPlan> & Pick<BarberResolvedPlan, "id" | "name">): BarberResolvedPlan {
  return {
    priceMonthly: 100,
    priceYearly: null,
    firstMonthPrice: null,
    maxBarbers: 1,
    maxBranches: 1,
    messageQuota: 10,
    features: {},
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
    sortOrder: 0,
    isActive: true,
    ...over,
  };
}
const CHICO = plan({ id: "BASICO", name: "Chico", priceMonthly: 111, maxBarbers: 1, maxBranches: 1, features: { agenda: true } });
const MEDIANO = plan({ id: "AVANZADO", name: "Mediano", priceMonthly: 222, maxBarbers: 5, maxBranches: 1, features: { agenda: true, walkinQueue: true } });
const GRANDE = plan({
  id: "PROFESIONAL",
  name: "Grande",
  priceMonthly: 333,
  priceYearly: 3330.5,
  firstMonthPrice: 33.3,
  maxBarbers: BARBER_UNLIMITED,
  maxBranches: BARBER_UNLIMITED,
  features: { agenda: true, walkinQueue: true, multiBranch: true },
});
const PLANS = [CHICO, MEDIANO, GRANDE];
const t = getBarberT("es");

// ── Límites duros ────────────────────────────────────────────────────────
test("límite de barberos: Chico (1) con 1 en uso bloquea y nombra al plan más barato que lo permite, con SU precio de la tabla", () => {
  const d = evaluateBarberLimit({ plan: CHICO, plans: PLANS, key: "barbers", used: 1 });
  assert.equal(d.ok, false);
  assert.equal(d.requiredPlan?.id, "AVANZADO");
  const msg = limitReachedMessage(t, CHICO, d);
  assert.match(msg, /Chico/);
  assert.match(msg, /Mediano/);
  assert.match(msg, /222/); // precio LEÍDO del plan sintético, no del seed
  assert.doesNotMatch(msg, new RegExp(String(FALLBACK_BARBER_PLAN_CONFIG.AVANZADO.priceMonthly)));
});

test("límite ilimitado (-1) siempre deja pasar", () => {
  const d = evaluateBarberLimit({ plan: GRANDE, plans: PLANS, key: "barbers", used: 999, adding: 50 });
  assert.equal(d.ok, true);
  assert.equal(d.requiredPlan, null);
});

test("degradación: 4 barberos en un plan de 1 → excedida, bloquea altas, no hay borrado", () => {
  const d = evaluateBarberLimit({ plan: CHICO, plans: PLANS, key: "barbers", used: 4 });
  assert.equal(d.overLimit, true);
  assert.equal(d.ok, false);
  // 4 + 1 = 5 caben justo en Mediano (5); con 5 en uso el que lo permite es Grande.
  assert.equal(d.requiredPlan?.id, "AVANZADO");
  const d5 = evaluateBarberLimit({ plan: CHICO, plans: PLANS, key: "barbers", used: 5 });
  assert.equal(d5.requiredPlan?.id, "PROFESIONAL");
});

test("sedes: maxBranches cuenta la matriz; abrir la 2ª en un plan de 1 se bloquea", () => {
  const d = evaluateBarberLimit({ plan: MEDIANO, plans: PLANS, key: "branches", used: 1 });
  assert.equal(d.ok, false);
  assert.equal(pickBarberPlanForLimit(PLANS, "branches", 2, "AVANZADO")?.id, "PROFESIONAL");
});

test("ningún plan lo permite → requiredPlan null y mensaje de soporte", () => {
  const solo = [CHICO, plan({ id: "AVANZADO", name: "Mediano", maxBarbers: 2, isActive: false })];
  const d = evaluateBarberLimit({ plan: CHICO, plans: solo, key: "barbers", used: 3 });
  assert.equal(d.requiredPlan, null);
  assert.match(limitReachedMessage(t, CHICO, d), /soporte/);
});

// ── Features por plan ────────────────────────────────────────────────────
test("feature: walkinQueue no está en Chico y sí en Mediano/Grande", () => {
  assert.equal(evaluateBarberFeature(CHICO, "walkinQueue"), false);
  assert.equal(evaluateBarberFeature(MEDIANO, "walkinQueue"), true);
  assert.equal(evaluateBarberFeature(GRANDE, "multiBranch"), true);
  assert.equal(evaluateBarberFeature(null, "agenda"), false);
});

test("gate errors → 402 (sin suscripción) / 403 (feature o límite) y FORBIDDEN de permisos", () => {
  assert.equal(barberGateErrorPayload(new BarberPlanGateError("SUBSCRIPTION_INACTIVE", "x"))?.status, 402);
  assert.equal(barberGateErrorPayload(new BarberPlanGateError("FEATURE_LOCKED", "x", { feature: "walkinQueue", requiredPlan: "AVANZADO" }))?.status, 403);
  const lim = barberGateErrorPayload(new BarberPlanGateError("LIMIT_REACHED", "x", { limit: "barbers" }));
  assert.equal(lim?.status, 403);
  assert.equal(lim?.body.code, "LIMIT_REACHED");
  assert.equal(barberGateErrorPayload(new Error("otro")), null);
});

// ── Dinero: Decimal → centavos ───────────────────────────────────────────
test("toCents usa Decimal: 3330.5 → 333050; 33.3 → 3330; sin errores de float", () => {
  assert.equal(toCents(3330.5), 333050);
  assert.equal(toCents("33.3"), 3330);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(planAmountCents(GRANDE, "year"), 333050);
  assert.equal(planAmountCents(CHICO, "year"), null);
  assert.equal(planFirstMonthDiscountCents(GRANDE), 33300 - 3330);
  assert.equal(planFirstMonthDiscountCents(CHICO), 0);
});

// ── Precios de Stripe: jamás uno ajeno ───────────────────────────────────
test("isBarberPriceUsable rechaza un precio sin marca barber aunque coincida el importe", () => {
  const expect = { cents: 11100, interval: "month" as const };
  const dentalLike = { id: "price_d", active: true, currency: "mxn", unit_amount: 11100, recurring: { interval: "month" }, metadata: { plan: "BASIC" } };
  const ours = { ...dentalLike, id: "price_b", metadata: { dc_vertical: "barber", dc_plan: "BASICO" } };
  assert.equal(isBarberPriceUsable(dentalLike, expect), false);
  assert.equal(isBarberPriceUsable(ours, expect), true);
  assert.equal(isBarberPriceUsable({ ...ours, unit_amount: 11101 }, expect), false);
  assert.equal(isBarberPriceUsable({ ...ours, active: false }, expect), false);
  assert.equal(isBarberPriceUsable({ ...ours, recurring: { interval: "year" } }, expect), false);
  // Marca en el producto (precio creado a mano por Rafael con metadata en el producto)
  const viaProduct = { ...dentalLike, id: "price_p", metadata: {}, product: { metadata: { dc_vertical: "barber" } } };
  assert.equal(isBarberPriceUsable(viaProduct, expect), true);
});

// ── Suscripción → estado absoluto ────────────────────────────────────────
const PERIOD_END = 1_790_000_000;
function stripeSub(over: Record<string, unknown> = {}) {
  return {
    id: "sub_A",
    status: "active",
    customer: "cus_1",
    metadata: { dc_vertical: "barber", dc_kind: "barber-subscription", barbershopId: "shop_root", dc_plan: "AVANZADO" },
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_1",
          current_period_end: PERIOD_END,
          price: { id: "price_x", unit_amount: 22200, recurring: { interval: "month" }, metadata: { dc_vertical: "barber", dc_plan: "AVANZADO" } },
        },
      ],
    },
    ...over,
  };
}

test("subscriptionPatchFromStripe: status tal cual, plan desde el precio, fin de periodo desde el item", () => {
  const patch = subscriptionPatchFromStripe(stripeSub({ status: "past_due" }));
  assert.deepEqual(patch, { subscriptionStatus: "past_due", stripeSubscriptionId: "sub_A", plan: "AVANZADO" });
  assert.equal(subscriptionPeriodEndSeconds(stripeSub()), PERIOD_END);
  // API pineada: current_period_end en la suscripción
  assert.equal(subscriptionPeriodEndSeconds({ id: "s", status: "active", current_period_end: 5, items: { data: [{}] } }), 5);
  // plan por id de precio guardado en la tabla cuando el precio no trae metadata
  const noMeta = stripeSub({ metadata: { dc_vertical: "barber" }, items: { data: [{ price: { id: "price_saved" } }] } });
  assert.equal(subscriptionPatchFromStripe(noMeta, [plan({ id: "PROFESIONAL", name: "G", stripePriceIdMonthly: "price_saved" })]).plan, "PROFESIONAL");
  assert.equal(subscriptionPatchFromStripe(noMeta).plan, undefined);
});

function fakeDb(shops: BarberShopRef[]) {
  const writes: Array<{ op: string; args: any }> = [];
  const db: BarberBillingDb = {
    barbershop: {
      async findFirst(args: any) {
        const w = args?.where ?? {};
        return (
          shops.find((s) => (w.id ? s.id === w.id : true) && (w.stripeCustomerId ? s.stripeCustomerId === w.stripeCustomerId : true)) ?? null
        );
      },
      async update(args: any) {
        writes.push({ op: "update", args });
        return {};
      },
      async updateMany(args: any) {
        writes.push({ op: "updateMany", args });
        return { count: 0 };
      },
    },
  };
  return { db, writes };
}

test("applyBarberSubscription es idempotente: el mismo evento dos veces → escrituras idénticas, cero inserts", async () => {
  const { db, writes } = fakeDb([{ id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: null }]);
  const r1 = await applyBarberSubscription(db, stripeSub());
  const r2 = await applyBarberSubscription(db, stripeSub());
  assert.equal(r1.applied, true);
  assert.equal(r2.applied, true);
  assert.equal(writes.length, 4); // (update matriz + updateMany sucursales) × 2
  assert.deepEqual(writes[0], writes[2]);
  assert.deepEqual(writes[1], writes[3]);
  assert.ok(writes.every((w) => w.op !== "create"));
  assert.deepEqual(writes[0].args.data, { subscriptionStatus: "active", stripeSubscriptionId: "sub_A", plan: "AVANZADO" });
  assert.deepEqual(writes[1].args.where, { parentId: "shop_root" });
});

test("eco de una suscripción vieja y cancelada NO pisa a la vigente; una nueva viva sí se adopta", async () => {
  const { db, writes } = fakeDb([{ id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_NEW" }]);
  const stale = await applyBarberSubscription(db, stripeSub({ id: "sub_OLD", status: "canceled" }));
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, "stale-subscription");
  assert.equal(writes.length, 0);
  const adopted = await applyBarberSubscription(db, stripeSub({ id: "sub_NEWER", status: "active" }));
  assert.equal(adopted.applied, true);
  assert.equal(writes[0].args.data.stripeSubscriptionId, "sub_NEWER");
});

test("metadata.barbershopId que no cuadra con el customer no engaña: se resuelve por customer", async () => {
  const { db, writes } = fakeDb([
    { id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: null },
    { id: "shop_other", stripeCustomerId: "cus_2", stripeSubscriptionId: null },
  ]);
  const r = await applyBarberSubscription(db, stripeSub({ metadata: { dc_vertical: "barber", barbershopId: "shop_other" } }));
  assert.equal(r.applied, true);
  assert.equal(r.shopId, "shop_root");
  assert.equal(writes[0].args.where.id, "shop_root");
});

test("una suscripción sin marca barber (dental) no se aplica nunca", async () => {
  const { db, writes } = fakeDb([{ id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: null }]);
  const r = await applyBarberSubscription(db, stripeSub({ metadata: { clinicId: "c1", plan: "PRO" }, items: { data: [{ price: { id: "p", metadata: { plan: "PRO" } } }] } }));
  assert.equal(r.applied, false);
  assert.equal(r.reason, "not-barber");
  assert.equal(writes.length, 0);
});

// ── Webhook: filtro de eventos + reenvío ─────────────────────────────────
test("solo checkout.session.* y customer.subscription.* son nuestros (payment_intent.* es de T4)", () => {
  assert.equal(isBarberWebhookEventType("checkout.session.completed"), true);
  assert.equal(isBarberWebhookEventType("customer.subscription.updated"), true);
  assert.equal(isBarberWebhookEventType("payment_intent.succeeded"), false);
  assert.equal(isBarberWebhookEventType("invoice.paid"), false);
});

test("handleBarberStripeEvent: reenviar el mismo checkout.session.completed dos veces converge sin duplicar", async () => {
  const { db, writes } = fakeDb([{ id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: null }]);
  let retrieves = 0;
  const stripe = { subscriptions: { async retrieve() { retrieves += 1; return stripeSub(); } } };
  const event = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", mode: "subscription", metadata: { dc_kind: "barber-subscription", barbershopId: "shop_root" }, subscription: "sub_A" } },
  };
  const a = await handleBarberStripeEvent(stripe, db, event);
  const b = await handleBarberStripeEvent(stripe, db, event);
  assert.equal(a.handled, true);
  assert.equal(b.handled, true);
  assert.equal(retrieves, 2); // relee la verdad viva cada vez
  assert.equal(writes.length, 4);
  assert.deepEqual(writes[0], writes[2]);
});

test("handleBarberStripeEvent ignora sesiones ajenas (dental, sin dc_kind) y suscripciones sin marca", async () => {
  const { db, writes } = fakeDb([{ id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: null }]);
  const stripe = { subscriptions: { async retrieve() { throw new Error("no debe llamarse"); } } };
  const dentalCheckout = { id: "evt_d", type: "checkout.session.completed", data: { object: { id: "cs_d", metadata: { kind: "platform-subscription", clinicId: "c1" }, subscription: "sub_d" } } };
  const dentalSub = { id: "evt_s", type: "customer.subscription.updated", data: { object: { id: "sub_d", status: "active", customer: "cus_1", metadata: { clinicId: "c1" }, items: { data: [{ price: { metadata: { plan: "PRO" } } }] } } } };
  const t4 = { id: "evt_pi", type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } };
  for (const ev of [dentalCheckout, dentalSub, t4]) {
    const r = await handleBarberStripeEvent(stripe, db, ev);
    assert.equal(r.handled, false, ev.type);
  }
  assert.equal(writes.length, 0);
});

test("customer.subscription.deleted relee la suscripción y deja 'canceled' en matriz y sucursales", async () => {
  const { db, writes } = fakeDb([{ id: "shop_root", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_A" }]);
  const stripe = { subscriptions: { async retrieve() { return stripeSub({ status: "canceled" }); } } };
  const r = await handleBarberStripeEvent(stripe, db, { id: "evt_del", type: "customer.subscription.deleted", data: { object: stripeSub({ status: "canceled" }) } });
  assert.equal(r.handled, true);
  assert.equal(writes[0].args.data.subscriptionStatus, "canceled");
  assert.equal(writes[1].args.data.subscriptionStatus, "canceled");
});

// ── Cambio de plan: dirección y contrato con Stripe ──────────────────────
test("dirección: el importe manda pero el tier veta (bajar de plan jamás cobra hoy)", () => {
  assert.equal(resolveBarberChangeDirection({ currentCents: 100, targetCents: 200, currentPlanId: "BASICO", targetPlanId: "AVANZADO" }), "upgrade");
  assert.equal(resolveBarberChangeDirection({ currentCents: 100, targetCents: 200, currentPlanId: "PROFESIONAL", targetPlanId: "AVANZADO" }), "downgrade");
  assert.equal(resolveBarberChangeDirection({ currentCents: 300, targetCents: 200 }), "downgrade");
  assert.equal(resolveBarberChangeDirection({ currentCents: 200, targetCents: 200 }), "same");
});

test("update de suscripción: upgrade = always_invoice + error_if_incomplete; downgrade = create_prorations; nunca billing_cycle_anchor", () => {
  const up = buildBarberSubscriptionUpdateParams({ itemId: "si_1", priceId: "price_n", direction: "upgrade", metadata: { dc_plan: "PROFESIONAL" } });
  assert.equal(up.proration_behavior, "always_invoice");
  assert.equal(up.payment_behavior, "error_if_incomplete");
  assert.deepEqual(up.items, [{ id: "si_1", price: "price_n" }]);
  const down = buildBarberSubscriptionUpdateParams({ itemId: "si_1", priceId: "price_n", direction: "downgrade", metadata: {} });
  assert.equal(down.proration_behavior, "create_prorations");
  assert.equal("payment_behavior" in down, false);
  assert.equal("billing_cycle_anchor" in up, false);
});

test("preview: sin líneas de prorrateo o con renovación incluida → null (no se muestra un importe falso)", () => {
  const ok = { amount_due: 1234, lines: { data: [{ proration: true, amount: -500, period: { start: 1 } }, { proration: true, amount: 1734, period: { start: 1 } }] } };
  assert.equal(previewAmountDueCents(ok, PERIOD_END), 1234);
  assert.equal(previewAmountDueCents({ amount_due: 9999, lines: { data: [{ proration: false, amount: 9999 }] } }, PERIOD_END), null);
  const withRenewal = { amount_due: 40000, lines: { data: [{ proration: true, amount: 1000, period: { start: 1 } }, { proration: false, amount: 39000, period: { start: PERIOD_END } }] } };
  assert.equal(previewAmountDueCents(withRenewal, PERIOD_END), null);
  assert.equal(previewAmountDueCents({ amount_due: -50, lines: { data: [{ proration: true, amount: -50 }] } }, null), 0);
});
