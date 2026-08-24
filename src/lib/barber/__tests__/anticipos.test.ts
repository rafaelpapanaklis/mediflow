import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_FOREIGN_WEBHOOK_EVENTS,
  BARBER_PAYMENTS_WEBHOOK_EVENTS,
  DEFAULT_BARBER_DEPOSIT_POLICY,
  buildDepositMetadata,
  buildMembershipMetadata,
  classifyPaymentIntent,
  computeDepositCents,
  depositAudienceApplies,
  describeDepositPolicy,
  isChargeableAmount,
  isOurWebhookEvent,
  isWithinRefundWindow,
  normalizeDepositPolicy,
  quoteDeposit,
  toStripeRecurring,
  type BarberDepositPolicy,
} from "../payments-core";

// Correr:  npx tsx --test src/lib/barber/__tests__/anticipos.test.ts

const NOW = new Date("2026-08-24T12:00:00.000Z");

function policy(over: Partial<BarberDepositPolicy> = {}): BarberDepositPolicy {
  return normalizeDepositPolicy({ ...DEFAULT_BARBER_DEPOSIT_POLICY, enabled: true, ...over });
}

// ═══════════════════════════════════════════════════════════════════════
// Frontera con T6: los webhooks NO se solapan
// ═══════════════════════════════════════════════════════════════════════

test("nuestro webhook y el de la suscripción del SaaS no comparten NI UN evento", () => {
  const ours: string[] = Array.from(BARBER_PAYMENTS_WEBHOOK_EVENTS);
  const theirs = new Set<string>(Array.from(BARBER_FOREIGN_WEBHOOK_EVENTS));
  const overlap = ours.filter((e) => theirs.has(e));
  assert.deepEqual(overlap, [], `eventos duplicados en los dos endpoints: ${overlap.join(", ")}`);
});

test("solo escuchamos payment_intent.* — nada de checkout, subscription ni invoice", () => {
  for (const e of BARBER_PAYMENTS_WEBHOOK_EVENTS) {
    assert.ok(e.startsWith("payment_intent."), `${e} no es un payment_intent`);
  }
  assert.equal(isOurWebhookEvent("payment_intent.succeeded"), true);
  assert.equal(isOurWebhookEvent("checkout.session.completed"), false);
  assert.equal(isOurWebhookEvent("customer.subscription.updated"), false);
  assert.equal(isOurWebhookEvent("invoice.paid"), false);
});

test("un PaymentIntent ajeno (el SaaS de T6) se ignora, no se procesa", () => {
  // Sin metadata nuestra y sin factura: no es de esta ola.
  assert.equal(classifyPaymentIntent({ metadata: {}, invoice: null }), "ignore");
  assert.equal(
    classifyPaymentIntent({ metadata: { plan: "PROFESIONAL" }, invoice: null }),
    "ignore",
  );
  // Con nuestra metadata sí.
  assert.equal(
    classifyPaymentIntent({
      metadata: buildDepositMetadata({ barbershopId: "s1", appointmentId: "a1" }),
    }),
    "deposit",
  );
  assert.equal(
    classifyPaymentIntent({
      metadata: buildMembershipMetadata({ barbershopId: "s1", clientId: "c1", membershipId: "m1" }),
    }),
    "membership",
  );
  // Un cobro de factura hay que resolverlo contra la suscripción antes de decidir.
  assert.equal(classifyPaymentIntent({ metadata: {}, invoice: "in_123" }), "membership_invoice");
});

test("la metadata lleva SIEMPRE la barbería (nunca se confía en el body)", () => {
  const m = buildDepositMetadata({ barbershopId: "shop_1", appointmentId: "appt_1", clientId: "c1" });
  assert.equal(m.dcb, "deposit");
  assert.equal(m.dcbShop, "shop_1");
  assert.equal(m.dcbAppt, "appt_1");
  assert.equal(m.dcbClient, "c1");
});

// ═══════════════════════════════════════════════════════════════════════
// Cuánto anticipo y a quién
// ═══════════════════════════════════════════════════════════════════════

test("monto fijo y porcentaje del servicio", () => {
  assert.equal(computeDepositCents(policy({ mode: "FIXED", fixedCents: 10000 }), 30000), 10000);
  assert.equal(computeDepositCents(policy({ mode: "PERCENT", percent: 30 }), 30000), 9000);
  assert.equal(computeDepositCents(policy({ mode: "PERCENT", percent: 33.33 }), 33333), 11110);
});

test("el anticipo NUNCA es mayor que el servicio", () => {
  // Fijo de $500 sobre un corte de $180: se pide $180, no $500.
  assert.equal(computeDepositCents(policy({ mode: "FIXED", fixedCents: 50000 }), 18000), 18000);
  assert.equal(computeDepositCents(policy({ mode: "PERCENT", percent: 100 }), 18000), 18000);
});

test("el tope máximo recorta el porcentaje", () => {
  const p = policy({ mode: "PERCENT", percent: 50, maxCents: 15000 });
  assert.equal(computeDepositCents(p, 60000), 15000); // 50% serían $300
  assert.equal(computeDepositCents(p, 20000), 10000); // aquí el 50% no llega al tope
});

test("con la política apagada nunca se pide anticipo", () => {
  assert.equal(computeDepositCents(policy({ enabled: false }), 30000), 0);
  const q = quoteDeposit(policy({ enabled: false }), 30000, { doneVisits: 0, noShows: 3 });
  assert.equal(q.required, false);
  assert.equal(q.reason, "DISABLED");
});

test("audiencia ALL: a todos", () => {
  const p = policy({ audience: "ALL" });
  assert.equal(depositAudienceApplies(p, { doneVisits: 40, noShows: 0 }), true);
  assert.equal(depositAudienceApplies(p, null), true);
});

test("audiencia NEW: solo a quien nunca ha completado una visita", () => {
  const p = policy({ audience: "NEW" });
  assert.equal(depositAudienceApplies(p, { doneVisits: 0, noShows: 0 }), true);
  assert.equal(depositAudienceApplies(p, { doneVisits: 1, noShows: 0 }), false);
  // Sin ficha todavía (reserva pública de alguien nuevo) = cliente nuevo.
  assert.equal(depositAudienceApplies(p, null), true);
});

test("audiencia NO_SHOW: solo a quien ya faltó — al cliente fiel no se le pide", () => {
  const p = policy({ audience: "NO_SHOW" });
  assert.equal(depositAudienceApplies(p, { doneVisits: 20, noShows: 0 }), false);
  assert.equal(depositAudienceApplies(p, { doneVisits: 20, noShows: 1 }), true);
  assert.equal(depositAudienceApplies(p, null), false);
});

test("la cotización completa explica por qué se pide (o por qué no)", () => {
  const p = policy({ audience: "NO_SHOW", mode: "FIXED", fixedCents: 10000 });
  const fiel = quoteDeposit(p, 30000, { doneVisits: 12, noShows: 0 });
  assert.equal(fiel.required, false);
  assert.equal(fiel.reason, "NOT_IN_AUDIENCE");
  assert.equal(fiel.amountCents, 0);

  const faltista = quoteDeposit(p, 30000, { doneVisits: 3, noShows: 2 });
  assert.equal(faltista.required, true);
  assert.equal(faltista.reason, "REQUIRED");
  assert.equal(faltista.amountCents, 10000);

  // Servicio sin precio: no se inventa un cobro.
  assert.equal(quoteDeposit(p, 0, { doneVisits: 0, noShows: 5 }).reason, "ZERO_AMOUNT");
});

// ═══════════════════════════════════════════════════════════════════════
// La política que ve el cliente ANTES de pagar
// ═══════════════════════════════════════════════════════════════════════

test("el texto dice el monto, que se aplica al servicio y hasta cuándo se devuelve", () => {
  const text = describeDepositPolicy(policy({ refundWindowHours: 24 }), { amountCents: 10000 });
  assert.ok(text.includes("100"), "debe decir cuánto");
  assert.ok(/aplica/i.test(text), "debe decir que se aplica al servicio");
  assert.ok(text.includes("24"), "debe decir la ventana de cancelación");
});

test("sin ventana de reembolso lo dice claro, no lo esconde", () => {
  const text = describeDepositPolicy(policy({ refundWindowHours: 0 }), { amountCents: 10000 });
  assert.ok(/no es reembolsable/i.test(text));
});

test("si la barbería escribe su propio texto, ese manda", () => {
  const text = describeDepositPolicy(policy({ policyText: "Aquí mandamos nosotros." }), {
    amountCents: 10000,
  });
  assert.equal(text, "Aquí mandamos nosotros.");
});

test("la ventana de reembolso se mide contra la hora de la cita", () => {
  const p = policy({ refundWindowHours: 24 });
  const cita = new Date("2026-08-26T12:00:00.000Z"); // en 48 h
  assert.equal(isWithinRefundWindow(p, cita, NOW), true);
  // A 12 h de la cita ya pasó la ventana.
  assert.equal(isWithinRefundWindow(p, cita, new Date("2026-08-26T00:00:00.000Z")), false);
  // Ventana 0 = nunca reembolsable.
  assert.equal(isWithinRefundWindow(policy({ refundWindowHours: 0 }), cita, NOW), false);
});

// ═══════════════════════════════════════════════════════════════════════
// Normalización: nada de basura llega a la BD
// ═══════════════════════════════════════════════════════════════════════

test("la política se normaliza: porcentajes fuera de rango, horas y cuentas falsas", () => {
  const p = normalizeDepositPolicy({
    enabled: "sí", // no es true booleano → apagado
    mode: "REGALADO",
    percent: 250,
    refundWindowHours: -5,
    audience: "TODOS",
    stripeAccountId: "no-soy-una-cuenta",
  });
  assert.equal(p.enabled, false);
  assert.equal(p.mode, DEFAULT_BARBER_DEPOSIT_POLICY.mode);
  assert.equal(p.percent, 100);
  assert.equal(p.refundWindowHours, 0);
  assert.equal(p.audience, DEFAULT_BARBER_DEPOSIT_POLICY.audience);
  assert.equal(p.stripeAccountId, "", "una cuenta con formato inválido no se guarda a medias");
});

test("solo se acepta un acct_ con el formato real de Stripe Connect", () => {
  assert.equal(normalizeDepositPolicy({ stripeAccountId: "acct_1AbCdEf" }).stripeAccountId, "acct_1AbCdEf");
  assert.equal(normalizeDepositPolicy({ stripeAccountId: " acct_1AbCdEf " }).stripeAccountId, "acct_1AbCdEf");
  assert.equal(normalizeDepositPolicy({ stripeAccountId: "sk_live_peligro" }).stripeAccountId, "");
});

test("el monto fijo acepta pesos o centavos según la llave que llegue", () => {
  assert.equal(normalizeDepositPolicy({ fixed: "150.50" }).fixedCents, 15050);
  assert.equal(normalizeDepositPolicy({ fixedCents: 15050 }).fixedCents, 15050);
});

// ═══════════════════════════════════════════════════════════════════════
// Stripe: montos y periodicidad
// ═══════════════════════════════════════════════════════════════════════

test("Stripe no acepta cobros por debajo del mínimo en MXN", () => {
  assert.equal(isChargeableAmount(999), false);
  assert.equal(isChargeableAmount(1000), true);
  assert.equal(isChargeableAmount(34900), true);
});

test("la periodicidad del plan se traduce a la de Stripe", () => {
  assert.deepEqual(toStripeRecurring(30), { interval: "month", interval_count: 1 });
  assert.deepEqual(toStripeRecurring(7), { interval: "week", interval_count: 1 });
  assert.deepEqual(toStripeRecurring(14), { interval: "week", interval_count: 2 });
  assert.deepEqual(toStripeRecurring(365), { interval: "year", interval_count: 1 });
  // Quincenal de 15 días no tiene equivalente redondo: se expresa en días.
  assert.deepEqual(toStripeRecurring(15), { interval: "day", interval_count: 15 });
  // Fuera de rango se acota, nunca se manda algo que Stripe rechace.
  assert.deepEqual(toStripeRecurring(9999), { interval: "year", interval_count: 1 });
  assert.deepEqual(toStripeRecurring(0), { interval: "month", interval_count: 1 });
});
