/**
 * "En trial" en el marketplace y en las especialidades del sidebar exige NO
 * tener suscripción viva (isInTrial de plan-status), no solo la fecha.
 *
 * Run: npm run test:plan-status
 *
 * Antes la fecha sola decidía: a una clínica que PAGA se le abrían TODAS las
 * especialidades y se le saltaba el gate del plan durante su primer mes
 * (trialEndsAt = fin del periodo pagado). Con la renovación moviendo
 * trialEndsAt, eso habría pasado a ser PARA SIEMPRE y para todas las que pagan.
 */
import "./_sin-server-only"; // PRIMERO: get-active-clinic-modules → plans.ts importa "server-only"
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess } from "@/lib/marketplace/access-control-core";
import {
  SPECIALTY_MODULE_KEYS,
  deriveActiveClinicModuleKeys,
} from "@/lib/clinical-shared/get-active-clinic-modules";

const NOW = new Date("2026-08-26T18:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

test("clínica que PAGA con trialEndsAt por delante NO está en trial: solo lo comprado", () => {
  for (const subscriptionStatus of ["active", "trialing", "paid"]) {
    const snap = { trialEndsAt: day(+20), subscriptionStatus, modules: [] };
    const access = evaluateAccess(snap, "orthodontics", NOW);
    assert.equal(access.hasAccess, false, subscriptionStatus);
    assert.equal(access.reason, "not_purchased", subscriptionStatus);
    assert.deepEqual(deriveActiveClinicModuleKeys(snap, NOW), [], subscriptionStatus);
  }
});

test("clínica que paga con un módulo comprado y vigente: acceso por compra, no por trial", () => {
  const snap = {
    trialEndsAt: day(+20),
    subscriptionStatus: "active",
    modules: [{ moduleKey: "orthodontics", status: "active", currentPeriodEnd: day(+40) }],
  };
  const access = evaluateAccess(snap, "orthodontics", NOW);
  assert.equal(access.hasAccess, true);
  assert.equal(access.reason, "purchased");
  assert.deepEqual(deriveActiveClinicModuleKeys(snap, NOW), ["orthodontics"]);
});

test("sin suscripción viva y con periodo por delante SÍ es trial (comportamiento legado intacto)", () => {
  for (const subscriptionStatus of [null, undefined, "pending_payment", "cancelled", "past_due"]) {
    const snap = { trialEndsAt: day(+20), subscriptionStatus, modules: [] };
    assert.equal(evaluateAccess(snap, "orthodontics", NOW).reason, "trial", String(subscriptionStatus));
    assert.deepEqual([...deriveActiveClinicModuleKeys(snap, NOW)].sort(), [...SPECIALTY_MODULE_KEYS].sort(), String(subscriptionStatus));
  }
});

test("snapshot sin subscriptionStatus (llamadores viejos): la fecha decide como antes", () => {
  const snap = { trialEndsAt: day(+20), modules: [] };
  assert.equal(evaluateAccess(snap, "orthodontics", NOW).reason, "trial");
  assert.equal(evaluateAccess({ ...snap, trialEndsAt: day(-1) }, "orthodontics", NOW).reason, "not_purchased");
});
