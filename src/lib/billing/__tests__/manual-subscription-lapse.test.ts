/**
 * SUB-01 · El pagador de SPEI/OXXO deja de ser "activo para siempre" — y las
 * SEDES no caen en el barrido.
 *
 * Run: npm run test:subscription-lapse
 *
 * Los dos lados del criterio importan por igual:
 *   • si el cron es demasiado flojo, sigue habiendo barra libre (el fallo que
 *     SUB-01 reporta);
 *   • si es demasiado agresivo, apaga el panel a gente que sí pagó — y el caso
 *     más peligroso no es el obvio: una SEDE nace con exactamente la misma forma
 *     que un pagador manual vencido (active, sin stripeSubscriptionId,
 *     trialEndsAt ya pasado). Lo único que la salva es nextBillingDate = null.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL_LAPSE_STATUS,
  manualLapseWhere,
  shouldLapseManualSubscription,
} from "../manual-subscription-lapse";

const AHORA = new Date("2026-08-18T12:00:00.000Z");
const ANTES = new Date("2026-07-18T12:00:00.000Z");
const DESPUES = new Date("2026-09-18T12:00:00.000Z");

/** Pagador de SPEI/OXXO cuyo mes ya venció: el caso de SUB-01. */
function pagadorManualVencido(over: Record<string, any> = {}) {
  return {
    subscriptionStatus: "active",
    stripeSubscriptionId: null,
    nextBillingDate: ANTES,
    trialEndsAt: ANTES,
    ...over,
  };
}

// ── 1 · El fallo que se cierra ───────────────────────────────────────

test("el pagador manual con el periodo vencido SI caduca", () => {
  assert.equal(shouldLapseManualSubscription(pagadorManualVencido(), AHORA), true);
});

test("el estado destino es past_due, que ya esta cableado en todas las pantallas", () => {
  // "unpaid" no lo mapea nadie; past_due lo escribe ya el propio webhook de
  // Stripe al fallar una tarjeta, y /admin/payments lo lista como morosa.
  assert.equal(MANUAL_LAPSE_STATUS, "past_due");
});

test("idempotente: lo que ya esta en past_due no se vuelve a tocar", () => {
  assert.equal(
    shouldLapseManualSubscription(pagadorManualVencido({ subscriptionStatus: "past_due" }), AHORA),
    false,
  );
  for (const estado of ["cancelled", "paused", "trialing", "pending_payment", "paid", null]) {
    assert.equal(
      shouldLapseManualSubscription(pagadorManualVencido({ subscriptionStatus: estado }), AHORA),
      false,
      `estado ${estado} no deberia entrar`,
    );
  }
});

// ── 2 · A quien NO se puede tocar ────────────────────────────────────

test("LA SEDE NO SE TOCA: misma forma que un manual vencido, pero sin nextBillingDate", () => {
  // Tal como la crea /api/clinics: active, monthlyPrice 0, sin suscripcion y con
  // trialEndsAt = el instante de creacion (o sea, ya pasado).
  const sede = {
    subscriptionStatus: "active",
    stripeSubscriptionId: null,
    monthlyPrice: 0,
    nextBillingDate: null,
    trialEndsAt: ANTES,
  };
  assert.equal(
    shouldLapseManualSubscription(sede, AHORA),
    false,
    "el cron apagaria todas las sucursales del producto",
  );
});

test("la clinica de TARJETA no se toca nunca, ni con las fechas vencidas", () => {
  assert.equal(
    shouldLapseManualSubscription(
      pagadorManualVencido({ stripeSubscriptionId: "sub_1Nxyz" }),
      AHORA,
    ),
    false,
  );
});

test("no se toca a quien le queda periodo por delante", () => {
  assert.equal(
    shouldLapseManualSubscription(pagadorManualVencido({ nextBillingDate: DESPUES }), AHORA),
    false,
  );
});

test("no se toca a quien tiene trial vivo aunque nextBillingDate ya pasara", () => {
  // manualPaidUntil = MAX(trialEndsAt, nextBillingDate): si el trial sigue vivo,
  // la clinica esta cubierta. Mirar solo nextBillingDate la suspenderia.
  assert.equal(
    shouldLapseManualSubscription(
      pagadorManualVencido({ nextBillingDate: ANTES, trialEndsAt: DESPUES }),
      AHORA,
    ),
    false,
  );
});

test("la clinica activada a mano desde /admin sobrevive su periodo y caduca al acabarse", () => {
  // activate_clinic mueve SOLO nextBillingDate y deja trialEndsAt como estaba
  // (normalmente ya pasado). Mirar solo trialEndsAt la suspenderia el mismo dia.
  const activadaPorAdmin = pagadorManualVencido({ nextBillingDate: DESPUES, trialEndsAt: ANTES });
  assert.equal(shouldLapseManualSubscription(activadaPorAdmin, AHORA), false);
  // Y un mes despues de que se acabe el plazo concedido:
  assert.equal(shouldLapseManualSubscription(activadaPorAdmin, new Date("2026-10-18T12:00:00.000Z")), true);
});

test("el limite es estricto: justo en la fecha todavia no caduca", () => {
  assert.equal(
    shouldLapseManualSubscription(
      pagadorManualVencido({ nextBillingDate: AHORA, trialEndsAt: ANTES }),
      AHORA,
    ),
    false,
  );
});

test("fechas basura o ausentes no caducan a nadie", () => {
  assert.equal(shouldLapseManualSubscription(pagadorManualVencido({ nextBillingDate: undefined }), AHORA), false);
  assert.equal(shouldLapseManualSubscription(pagadorManualVencido({ nextBillingDate: "no-es-fecha" }), AHORA), false);
  assert.equal(shouldLapseManualSubscription({}, AHORA), false);
});

test("acepta fechas serializadas como string (las que llegan por JSON)", () => {
  assert.equal(
    shouldLapseManualSubscription(
      pagadorManualVencido({ nextBillingDate: ANTES.toISOString(), trialEndsAt: ANTES.toISOString() }),
      AHORA,
    ),
    true,
  );
});

// ── 3 · El where de Prisma dice lo MISMO que el predicado ────────────

test("manualLapseWhere y el predicado no se pueden desincronizar", () => {
  const where = manualLapseWhere(AHORA) as Record<string, any>;
  assert.equal(where.subscriptionStatus, "active");
  assert.equal(where.stripeSubscriptionId, null);
  // El `not: null` es lo que deja fuera a las sedes. Si desaparece de aqui, el
  // cron se las lleva por delante.
  assert.equal(where.nextBillingDate.not, null, "sin `not: null` el cron suspende sedes");
  assert.equal(where.nextBillingDate.lt, AHORA);
  assert.equal(where.trialEndsAt.lt, AHORA);
});
