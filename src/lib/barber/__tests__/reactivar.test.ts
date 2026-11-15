// REACTIVAR = PAGAR EL MISMO PLAN (o uno mayor), decisión #10 de Rafael.
//   npx tsx --test src/lib/barber/__tests__/reactivar.test.ts
// Puro: sin base ni Stripe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPermitidoParaReactivar, suspendidaTrasPagar } from "@/lib/barber/cobros-core";

const pagado = { paidThroughAt: new Date("2026-12-14T16:00:00Z"), lastPaidAt: new Date("2026-11-14T16:00:00Z"), manualAccessAt: null };

test("el plan que tenía o uno mayor; nunca uno menor", () => {
  assert.equal(planPermitidoParaReactivar("AVANZADO", "AVANZADO"), true);
  assert.equal(planPermitidoParaReactivar("AVANZADO", "PROFESIONAL"), true);
  assert.equal(planPermitidoParaReactivar("AVANZADO", "BASICO"), false);
  assert.equal(planPermitidoParaReactivar("PROFESIONAL", "AVANZADO"), false);
  assert.equal(planPermitidoParaReactivar("BASICO", "BASICO"), true);
  // Un plan desconocido en la fila no frena a nadie (no se inventa un mínimo).
  assert.equal(planPermitidoParaReactivar("RARO", "BASICO"), true);
  assert.equal(planPermitidoParaReactivar(null, "BASICO"), true);
});

test("¿suspendida tras pagar? Solo sin acceso y habiendo pagado antes", () => {
  // Al corriente: baja de plan como hoy.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: true, subscriptionStatus: "active", stripeSubscriptionId: "sub", ledger: pagado }), false);
  // Vencida con cobros registrados.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "past_due", stripeSubscriptionId: "sub", ledger: pagado }), true);
  // Canceló (sin registro todavía): tuvo una suscripción que cobró.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "canceled", stripeSubscriptionId: "sub", ledger: null }), true);
  // Suspendida a mano por DaleControl tras haber pagado: también.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "suspended", stripeSubscriptionId: "sub", ledger: null }), true);
  // Alta nueva que nunca pagó: elige el plan que quiera.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "pending_payment", stripeSubscriptionId: null, ledger: null }), false);
  // Su primer cobro rechazó (Stripe dejó la suscripción «incomplete»): nunca pagó.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "incomplete", stripeSubscriptionId: "sub", ledger: null }), false);
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "incomplete_expired", stripeSubscriptionId: "sub", ledger: null }), false);
  // Cortesía sin Stripe que alguien suspendió a mano: nunca pagó.
  assert.equal(suspendidaTrasPagar({ tieneAcceso: false, subscriptionStatus: "suspended", stripeSubscriptionId: null, ledger: null }), false);
});
