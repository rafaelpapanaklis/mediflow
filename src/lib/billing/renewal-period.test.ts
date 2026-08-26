/**
 * La renovación deja las DOS fechas coherentes.
 *
 * Run: npm run test:billing
 *
 * Bug real (Menta Dental, agosto 2026): `customer.subscription.updated`
 * escribía nextBillingDate (fin de periodo real de Stripe) pero NUNCA
 * trialEndsAt, que es la fecha que mira el gate (isPlanExpired). Desde la
 * primera renovación trialEndsAt se quedaba congelado en la contratación y se
 * atrasaba un mes por ciclo. Con `active` no bloqueaba, pero el primer
 * `past_due` de un reintento sacaba a la clínica al instante con el periodo
 * pagado, y /admin la pintaba "Expirado".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PERIOD_GRANTING_STATUSES,
  manualPeriodFields,
  nextBillingDateFields,
  subscriptionPeriodFields,
} from "./proration";
import { getPlanStatus, isPlanExpired } from "../plan-status";

const NOW = new Date("2026-08-26T18:00:00.000Z");
const PERIOD_END = new Date("2026-09-24T19:41:31.000Z");
const PERIOD_END_SECONDS = Math.floor(PERIOD_END.getTime() / 1000);

/** Forma real de un customer.subscription.updated (API nueva: el periodo vive en el item). */
const renewal = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "sub_1TwoyNEgO7AoChdPSsNQM5kZ",
  customer: "cus_1",
  status,
  items: { data: [{ current_period_end: PERIOD_END_SECONDS }] },
  ...extra,
});

// ── subscriptionPeriodFields ────────────────────────────────────────────────

test("renovación (active): nextBillingDate y trialEndsAt salen IGUALES del mismo fin de periodo", () => {
  const fields = subscriptionPeriodFields(renewal("active"));
  assert.deepEqual(fields, { nextBillingDate: PERIOD_END, trialEndsAt: PERIOD_END });
  assert.equal(fields.trialEndsAt!.getTime(), fields.nextBillingDate!.getTime());
});

test("trialing (trial de Stripe) también concede el periodo", () => {
  assert.deepEqual(subscriptionPeriodFields(renewal("trialing")), { nextBillingDate: PERIOD_END, trialEndsAt: PERIOD_END });
  assert.deepEqual(Array.from(PERIOD_GRANTING_STATUSES).sort(), ["active", "trialing"]);
});

test("past_due / unpaid / canceled / incomplete: mueve el próximo cobro pero NO el acceso", () => {
  for (const status of ["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]) {
    const fields = subscriptionPeriodFields(renewal(status));
    assert.deepEqual(fields, { nextBillingDate: PERIOD_END }, status);
    assert.equal("trialEndsAt" in fields, false, `${status}: la llave no debe existir (Prisma escribiría null)`);
  }
});

test("sin fin de periodo: no toca NINGUNA fecha (ni null, ni undefined)", () => {
  for (const sub of [renewal("active", { items: { data: [{}] } }), renewal("active", { items: {} }), null, undefined, {}]) {
    const fields = subscriptionPeriodFields(sub);
    assert.deepEqual(fields, {});
    assert.equal("nextBillingDate" in fields, false);
    assert.equal("trialEndsAt" in fields, false);
  }
});

test("current_period_end en la raíz (API vieja) también vale", () => {
  const legacy = { id: "sub_1", status: "active", current_period_end: PERIOD_END_SECONDS };
  assert.deepEqual(subscriptionPeriodFields(legacy), { nextBillingDate: PERIOD_END, trialEndsAt: PERIOD_END });
});

// ── Menta Dental de punta a punta ───────────────────────────────────────────

test("Menta Dental: tras la renovación el gate Y /admin la ven al corriente, y un past_due un rato no la saca", () => {
  const contratacion = {
    subscriptionStatus: "active",
    trialEndsAt: new Date("2026-08-24T19:41:36.000Z"),    // lo que escribió activatePlatformSubscription el 24-jul
    nextBillingDate: new Date("2026-08-24T19:41:31.000Z"),
  };

  // 24-ago: Stripe avanza el periodo (status active) y llega subscription.updated.
  const renovada = { ...contratacion, subscriptionStatus: "active", ...subscriptionPeriodFields(renewal("active")) };
  assert.equal(renovada.trialEndsAt.getTime(), renovada.nextBillingDate.getTime(), "las dos fechas coherentes");
  assert.equal(isPlanExpired(renovada, NOW), false);
  assert.equal(getPlanStatus(renovada, NOW).kind, "active");

  // Una hora después el cobro falla: past_due. El periodo pagado sigue por delante → entra.
  const reintento = { ...renovada, subscriptionStatus: "past_due", ...subscriptionPeriodFields(renewal("past_due")) };
  assert.equal(reintento.trialEndsAt.getTime(), PERIOD_END.getTime(), "past_due no mueve el acceso, pero tampoco lo pierde");
  assert.equal(isPlanExpired(reintento, NOW), false, "cobro fallido ≠ vencida");
  assert.equal(getPlanStatus(reintento, NOW).kind, "past_due");

  // El periodo termina y sigue sin pagar: ahí sí queda vencida.
  const after = new Date(PERIOD_END.getTime() + 60_000);
  assert.equal(isPlanExpired(reintento, after), true);
  assert.equal(getPlanStatus(reintento, after).kind, "expired");
  assert.equal(getPlanStatus(reintento, after).subscriptionStatus, "past_due", "/admin ve el POR QUÉ");
});

test("regresión: con el handler viejo (solo nextBillingDate) el mismo past_due la sacaba al instante", () => {
  const contratacion = {
    subscriptionStatus: "active",
    trialEndsAt: new Date("2026-08-24T19:41:36.000Z"),
    nextBillingDate: new Date("2026-08-24T19:41:31.000Z"),
  };
  const viejo = { ...contratacion, subscriptionStatus: "past_due", ...nextBillingDateFields(renewal("past_due")) };
  assert.equal(viejo.nextBillingDate.getTime(), PERIOD_END.getTime(), "el próximo cobro sí se movía…");
  assert.equal(viejo.trialEndsAt.getTime(), contratacion.trialEndsAt.getTime(), "…pero el acceso no");
  assert.equal(isPlanExpired(viejo, NOW), true, "la bomba: fuera al instante con el periodo pagado");
});

test("un `unpaid` que sigue rodando periodos NO gana acceso eterno", () => {
  let clinic = {
    subscriptionStatus: "unpaid",
    trialEndsAt: new Date("2026-08-24T19:41:36.000Z"),
    nextBillingDate: new Date("2026-08-24T19:41:31.000Z"),
  };
  for (let month = 1; month <= 6; month++) {
    const periodEnd = Math.floor(new Date(2026, 8 + month, 24).getTime() / 1000);
    clinic = { ...clinic, ...subscriptionPeriodFields(renewal("unpaid", { items: { data: [{ current_period_end: periodEnd }] } })) };
  }
  assert.equal(clinic.trialEndsAt.getTime(), new Date("2026-08-24T19:41:36.000Z").getTime());
  assert.equal(isPlanExpired(clinic, NOW), true);
});

// ── manualPeriodFields (verify_payment / activate_clinic / factura pagada) ──

test("manualPeriodFields: mueve las dos fechas al mismo valor cuando el acceso venía atrás", () => {
  const periodEnd = new Date("2026-09-26T18:00:00.000Z");
  const fields = manualPeriodFields({ trialEndsAt: new Date("2026-08-01T00:00:00.000Z") }, periodEnd);
  assert.deepEqual(fields, { nextBillingDate: periodEnd, trialEndsAt: periodEnd });
});

test("manualPeriodFields: nunca acorta una cortesía o prepago por delante", () => {
  const periodEnd = new Date("2026-09-26T18:00:00.000Z");
  const cortesia = new Date("2027-01-15T00:00:00.000Z");
  const fields = manualPeriodFields({ trialEndsAt: cortesia }, periodEnd);
  assert.equal(fields.nextBillingDate.getTime(), periodEnd.getTime());
  assert.equal(fields.trialEndsAt.getTime(), cortesia.getTime());
});

test("manualPeriodFields: sin clínica previa o sin fecha usa el periodo nuevo", () => {
  const periodEnd = new Date("2026-09-26T18:00:00.000Z");
  assert.deepEqual(manualPeriodFields(null, periodEnd), { nextBillingDate: periodEnd, trialEndsAt: periodEnd });
  assert.deepEqual(manualPeriodFields({ trialEndsAt: null }, periodEnd), { nextBillingDate: periodEnd, trialEndsAt: periodEnd });
  assert.deepEqual(manualPeriodFields({ trialEndsAt: "no es fecha" }, periodEnd), { nextBillingDate: periodEnd, trialEndsAt: periodEnd });
});

// ── Estructural: el webhook usa el helper de las DOS fechas ─────────────────

test("customer.subscription.updated escribe las dos fechas con subscriptionPeriodFields", () => {
  const source = readFileSync(path.join(process.cwd(), "src/app/api/webhooks/stripe/route.ts"), "utf8");
  const caseAt = source.indexOf('case "customer.subscription.updated"');
  assert.ok(caseAt > 0, "no se encontró el handler");
  const body = source.slice(caseAt, source.indexOf('case "customer.subscription.deleted"', caseAt));
  assert.match(body, /const periodFields = subscriptionPeriodFields\(sub\);/, "la renovación debe mover trialEndsAt junto con nextBillingDate");
  assert.match(body, /\.\.\.periodFields,/, "el resultado del helper tiene que ir al update");
  assert.doesNotMatch(body, /nextBillingDateFields\(/, "el helper viejo solo movía nextBillingDate");
});
