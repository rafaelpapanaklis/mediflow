/**
 * plan-status · la regla ÚNICA de "vencida / al corriente / cobro fallido /
 * trial", y la prueba de que /admin y el gate real dicen LO MISMO sobre la
 * misma clínica.
 *
 * Run: npm run test:plan-status
 *
 * El caso que lo destapó: Menta Dental (BASIC) contrató el 24 de julio de 2026
 * y Stripe cobró la renovación del 24 de agosto sin problema. En la base quedó
 * subscriptionStatus=active y nextBillingDate=24-sep, pero trialEndsAt seguía
 * en 24-ago (la renovación nunca lo movía) y /admin la pintaba "EXPIRADO" con
 * un cálculo propio que solo miraba la fecha. Estaba al corriente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  daysUntil,
  getPlanStatus,
  isInTrial,
  isPlanExpired,
  isSubscriptionActive,
} from "../plan-status";
import { planStatusLabel } from "../plan-status-label";

const NOW = new Date("2026-08-26T18:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const STATUSES = [
  "active", "trialing", "paid",
  "past_due", "unpaid",
  "cancelled", "canceled", "paused",
  "pending_payment", "incomplete", "incomplete_expired",
  null,
] as const;

const MENTA = {
  subscriptionStatus: "active",
  stripeSubscriptionId: "sub_1TwoyNEgO7AoChdPSsNQM5kZ",
  nextBillingDate: new Date("2026-09-24T19:41:31.000Z"),
  trialEndsAt: new Date("2026-08-24T19:41:36.000Z"),
};

// ── El caso real ─────────────────────────────────────────────────────────────

test("Menta Dental: al corriente aunque trialEndsAt quedó un mes atrás", () => {
  assert.equal(isPlanExpired(MENTA, NOW), false, "el gate la deja entrar");
  const status = getPlanStatus(MENTA, NOW);
  assert.equal(status.kind, "active");
  assert.equal(status.expired, false);
  assert.equal(isInTrial(MENTA, NOW), false, "paga: NO está en trial aunque tenga fecha");
});

test("Menta Dental: /admin y el gate dicen lo mismo (Al corriente, no Expirado)", () => {
  const { label, tone } = planStatusLabel(getPlanStatus(MENTA, NOW), NOW);
  assert.match(label, /^Al corriente/);
  assert.doesNotMatch(label, /Vencida|Expirad/);
  assert.equal(tone, "success");
});

// ── isPlanExpired: la regla, sin cambio de semántica ─────────────────────────

test("isPlanExpired: vencida = periodo terminado Y sin suscripción viva", () => {
  for (const subscriptionStatus of STATUSES) {
    const live = isSubscriptionActive(subscriptionStatus);
    assert.equal(live, subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus));
    assert.equal(isPlanExpired({ subscriptionStatus, trialEndsAt: day(-1) }, NOW), !live, `pasado · ${subscriptionStatus}`);
    assert.equal(isPlanExpired({ subscriptionStatus, trialEndsAt: day(+1) }, NOW), false, `futuro · ${subscriptionStatus}`);
    assert.equal(isPlanExpired({ subscriptionStatus, trialEndsAt: day(-1).toISOString() }, NOW), !live, `ISO · ${subscriptionStatus}`);
  }
  assert.equal(isPlanExpired(null, NOW), false, "sin clínica no se bloquea (fail-open, como siempre)");
  assert.equal(isPlanExpired(undefined, NOW), false);
  assert.equal(isPlanExpired({ subscriptionStatus: "cancelled", trialEndsAt: null }, NOW), false, "sin fecha no hay vencimiento");
});

test("isPlanExpired: `now` es inyectable y por defecto es hoy", () => {
  const clinic = { subscriptionStatus: "cancelled", trialEndsAt: day(+1) };
  assert.equal(isPlanExpired(clinic, day(+2)), true);
  assert.equal(isPlanExpired(clinic, day(0)), false);
  assert.equal(isPlanExpired({ subscriptionStatus: "cancelled", trialEndsAt: new Date("2000-01-01") }), true);
});

// ── isInTrial: periodo por delante SIN suscripción viva ──────────────────────

test("isInTrial: una clínica que paga nunca está en trial, tenga la fecha que tenga", () => {
  for (const subscriptionStatus of STATUSES) {
    const live = isSubscriptionActive(subscriptionStatus);
    assert.equal(isInTrial({ subscriptionStatus, trialEndsAt: day(+10) }, NOW), !live, `futuro · ${subscriptionStatus}`);
    assert.equal(isInTrial({ subscriptionStatus, trialEndsAt: day(-10) }, NOW), false, `pasado · ${subscriptionStatus}`);
  }
  assert.equal(isInTrial(null, NOW), false);
  assert.equal(isInTrial({ subscriptionStatus: null, trialEndsAt: null }, NOW), false);
});

test("una clínica nunca está en trial Y vencida a la vez", () => {
  for (const subscriptionStatus of STATUSES) {
    for (const offset of [-400, -1, -0.001, 0.001, 1, 400]) {
      const clinic = { subscriptionStatus, trialEndsAt: day(offset) };
      assert.equal(isInTrial(clinic, NOW) && isPlanExpired(clinic, NOW), false, `${subscriptionStatus} @ ${offset}`);
    }
  }
});

// ── getPlanStatus: los cuatro estados de /admin ──────────────────────────────

test("getPlanStatus: kind 'expired' ⇔ isPlanExpired y kind 'active' ⇔ suscripción viva", () => {
  for (const subscriptionStatus of STATUSES) {
    for (const offset of [-400, -1, 1, 400]) {
      const clinic = { subscriptionStatus, trialEndsAt: day(offset), nextBillingDate: day(offset) };
      const status = getPlanStatus(clinic, NOW);
      const tag = `${subscriptionStatus} @ ${offset}`;
      assert.equal(status.kind === "expired", isPlanExpired(clinic, NOW), `expired · ${tag}`);
      assert.equal(status.expired, isPlanExpired(clinic, NOW), `expired flag · ${tag}`);
      assert.equal(status.kind === "active", isSubscriptionActive(subscriptionStatus), `active · ${tag}`);
      assert.equal(status.kind === "trial", isInTrial(clinic, NOW) && status.kind !== "past_due", `trial · ${tag}`);
      assert.equal(status.subscriptionStatus, subscriptionStatus);
      assert.equal(status.daysLeft, daysUntil(clinic.trialEndsAt, NOW));
    }
  }
});

test("los cuatro estados que Rafael necesita ver de un vistazo", () => {
  // AL CORRIENTE: paga; la fecha vieja no importa.
  assert.equal(getPlanStatus({ subscriptionStatus: "active", trialEndsAt: day(-30) }, NOW).kind, "active");
  assert.equal(getPlanStatus({ subscriptionStatus: "trialing", trialEndsAt: day(+10) }, NOW).kind, "active");
  // COBRO FALLIDO: Stripe no pudo cobrar, pero el periodo con acceso sigue → entra.
  const pastDue = getPlanStatus({ subscriptionStatus: "past_due", trialEndsAt: day(+20) }, NOW);
  assert.equal(pastDue.kind, "past_due");
  assert.equal(pastDue.expired, false);
  assert.equal(getPlanStatus({ subscriptionStatus: "unpaid", trialEndsAt: day(+20) }, NOW).kind, "past_due");
  // VENCIDA de verdad: periodo terminado y sin suscripción viva → el gate bloquea.
  const expiredAfterFail = getPlanStatus({ subscriptionStatus: "past_due", trialEndsAt: day(-2) }, NOW);
  assert.equal(expiredAfterFail.kind, "expired");
  assert.equal(expiredAfterFail.subscriptionStatus, "past_due", "el POR QUÉ (cobro fallido) sigue visible");
  assert.equal(getPlanStatus({ subscriptionStatus: "pending_payment", trialEndsAt: day(-0.001) }, NOW).kind, "expired");
  assert.equal(getPlanStatus({ subscriptionStatus: "cancelled", trialEndsAt: day(-7) }, NOW).kind, "expired");
  // TRIAL / cortesía / cancelada con periodo: sin suscripción viva, fecha por delante → entra.
  assert.equal(getPlanStatus({ subscriptionStatus: "pending_payment", trialEndsAt: day(+7) }, NOW).kind, "trial");
  assert.equal(getPlanStatus({ subscriptionStatus: null, trialEndsAt: day(+7) }, NOW).kind, "trial");
  assert.equal(getPlanStatus({ subscriptionStatus: "cancelled", trialEndsAt: day(+7) }, NOW).kind, "trial");
});

test("getPlanStatus: sin clínica o sin fecha no revienta", () => {
  assert.equal(getPlanStatus(null, NOW).kind, "trial");
  assert.equal(getPlanStatus(null, NOW).expired, false);
  const s = getPlanStatus({ subscriptionStatus: "active", trialEndsAt: null, nextBillingDate: "no es fecha" }, NOW);
  assert.equal(s.kind, "active");
  assert.equal(s.periodEnd, null);
  assert.equal(s.daysLeft, null);
  assert.equal(s.nextBillingDate, null);
});

// ── /admin y el gate: la etiqueta nunca contradice a isPlanExpired ───────────

test("la etiqueta de /admin dice 'Vencida' exactamente cuando el gate bloquea", () => {
  for (const subscriptionStatus of STATUSES) {
    for (const offset of [-400, -1, 1, 400]) {
      const clinic = { subscriptionStatus, trialEndsAt: day(offset), nextBillingDate: day(offset + 30) };
      const { label, tone } = planStatusLabel(getPlanStatus(clinic, NOW), NOW);
      const blocked = isPlanExpired(clinic, NOW);
      assert.equal(/^Vencida/.test(label), blocked, `${subscriptionStatus} @ ${offset}: "${label}"`);
      assert.equal(tone === "danger", blocked, `tono · ${subscriptionStatus} @ ${offset}`);
      assert.doesNotMatch(label, /Expirad/, "la palabra vieja no vuelve");
    }
  }
});

test("las etiquetas distinguen cobro fallido de vencida y explican el por qué", () => {
  const failing = planStatusLabel(getPlanStatus({ subscriptionStatus: "past_due", trialEndsAt: day(+12) }, NOW), NOW);
  assert.match(failing.label, /^Cobro fallido/);
  assert.equal(failing.tone, "warning");
  assert.match(failing.detail, /reintenta/);

  const dead = planStatusLabel(getPlanStatus({ subscriptionStatus: "past_due", trialEndsAt: day(-3) }, NOW), NOW);
  assert.equal(dead.label, "Vencida · cobro fallido");
  assert.match(dead.detail, /hace 3 días/);

  assert.equal(planStatusLabel(getPlanStatus({ subscriptionStatus: "cancelled", trialEndsAt: day(-3) }, NOW), NOW).label, "Vencida · cancelada");
  assert.equal(planStatusLabel(getPlanStatus({ subscriptionStatus: "pending_payment", trialEndsAt: day(-3) }, NOW), NOW).label, "Vencida · nunca pagó");
  assert.equal(planStatusLabel(getPlanStatus({ subscriptionStatus: null, trialEndsAt: day(-3) }, NOW), NOW).label, "Vencida · nunca pagó");

  const trial = planStatusLabel(getPlanStatus({ subscriptionStatus: "pending_payment", trialEndsAt: day(+5) }, NOW), NOW);
  assert.equal(trial.label, "Trial · 5d");
  const cancelledWithPeriod = planStatusLabel(getPlanStatus({ subscriptionStatus: "cancelled", trialEndsAt: day(+5) }, NOW), NOW);
  assert.equal(cancelledWithPeriod.label, "Cancelada · 5d de acceso");
});

test("al corriente muestra el próximo cobro, no la fecha vieja de trialEndsAt", () => {
  const { label } = planStatusLabel(getPlanStatus(MENTA, NOW), NOW);
  assert.match(label, /renueva/);
  // Sin nextBillingDate y con la fecha vieja: solo "Al corriente", nunca "-2d".
  const stale = planStatusLabel(getPlanStatus({ subscriptionStatus: "active", trialEndsAt: day(-2) }, NOW), NOW);
  assert.equal(stale.label, "Al corriente");
});

// ── daysUntil ────────────────────────────────────────────────────────────────

test("daysUntil: redondea hacia arriba, negativo si pasó, null sin fecha", () => {
  assert.equal(daysUntil(day(+0.2), NOW), 1);
  assert.equal(daysUntil(day(+5), NOW), 5);
  assert.equal(daysUntil(day(-2), NOW), -2);
  assert.equal(daysUntil(day(-0.5), NOW), 0);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil(undefined, NOW), null);
  assert.equal(daysUntil("no es fecha", NOW), null);
  assert.equal(daysUntil(day(+3).toISOString(), NOW), 3);
});
