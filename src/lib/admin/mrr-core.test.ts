/**
 * Tests del MRR del panel /admin.
 *
 * Run: npm run test:mrr
 *
 * Qué protege (esto ya se rompió una vez en producción):
 *  - /admin y /admin/payments enseñaban números distintos porque cada uno tenía
 *    su propio cálculo: uno sumaba Clinic.monthlyPrice (columna que Stripe
 *    Checkout nunca escribe → MRR $0 con 5 clínicas activas) y el otro el
 *    precio del plan. Aquí se comprueba que UNA sola función responde a los dos.
 *  - La precedencia: precio negociado > precio de lista del plan.
 *  - Que una clínica en trial NO cuente como MRR.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMrr,
  findIncludedBranchIds,
  includedBranchesHint,
  isMrrBillable,
  mrrBreakdownHint,
  EMPTY_MRR,
  type BranchBillingRow,
  type ClinicOwnerRow,
  type MrrClinicRow,
} from "./mrr-core";

// Precios de plan_configs (los que devuelve loadPlanPrices). El orden de las
// claves es el del catálogo y define el orden del desglose.
const PRICES = { BASIC: 419, PRO: 689, CLINIC: 1719 };

const clinic = (
  plan: string | null,
  monthlyPrice: number | null = 0,
  subscriptionStatus: string | null = "active",
) => ({ plan, monthlyPrice, subscriptionStatus });

// ── Precedencia ─────────────────────────────────────────────────────────────

test("sin monthlyPrice vale el precio del plan (el caso de Stripe Checkout)", () => {
  const mrr = computeMrr([clinic("PRO"), clinic("BASIC")], PRICES);
  assert.equal(mrr.total, 689 + 419);
});

test("monthlyPrice > 0 manda sobre el precio de lista (precio negociado)", () => {
  const mrr = computeMrr([clinic("CLINIC", 1200)], PRICES);
  assert.equal(mrr.total, 1200);
  assert.equal(mrr.byPlan[0].negotiated, 1, "se marca como negociada para poder auditarla");
  assert.equal(mrr.byPlan[0].listPrice, 1719, "el desglose sigue enseñando la lista");
});

test("monthlyPrice 0 o null NO deja la clínica en cero: cae al precio del plan", () => {
  assert.equal(computeMrr([clinic("PRO", 0)], PRICES).total, 689);
  assert.equal(computeMrr([clinic("PRO", null)], PRICES).total, 689);
});

test("un plan que no existe en plan_configs vale 0, no un precio inventado", () => {
  const mrr = computeMrr([clinic("LEGACY"), clinic(null)], PRICES);
  assert.equal(mrr.total, 0);
  assert.equal(mrr.clinics, 2, "sigue contando las clínicas aunque no aporten");
});

// ── El bug que motivó todo esto ─────────────────────────────────────────────

test("5 clínicas activas sin monthlyPrice ya NO dan $0", () => {
  const activas = [
    clinic("BASIC"), clinic("BASIC"), clinic("PRO"), clinic("CLINIC"), clinic("CLINIC"),
  ];
  const mrr = computeMrr(activas, PRICES);
  assert.equal(mrr.total, 419 * 2 + 689 + 1719 * 2);
  assert.equal(mrr.total, 4965);
});

test("/admin y /admin/payments dan el MISMO número con las mismas filas", () => {
  const activas = [clinic("BASIC"), clinic("PRO", 900), clinic("CLINIC")];
  // /admin reusa las filas que ya cargó; /admin/payments las consulta aparte.
  // Es la misma función, así que el total no puede divergir.
  const desdeDashboard = computeMrr(activas, PRICES);
  const desdePagos     = computeMrr(activas.slice(), PRICES);
  assert.equal(desdeDashboard.total, desdePagos.total);
  assert.equal(desdeDashboard.total, 419 + 900 + 1719);
});

// ── Qué cuenta como activa ──────────────────────────────────────────────────

test("solo cuenta subscriptionStatus 'active': trialing y paid NO son MRR", () => {
  assert.equal(isMrrBillable({ subscriptionStatus: "active" }), true);
  // "trialing" y "paid" sí abren el panel (ACTIVE_SUBSCRIPTION_STATUSES) pero
  // una clínica en trial paga $0: contarla inflaría el MRR.
  assert.equal(isMrrBillable({ subscriptionStatus: "trialing" }), false);
  assert.equal(isMrrBillable({ subscriptionStatus: "paid" }), false);
  assert.equal(isMrrBillable({ subscriptionStatus: "past_due" }), false);
  assert.equal(isMrrBillable({ subscriptionStatus: null }), false);
});

// ── Desglose auditable ──────────────────────────────────────────────────────

test("el desglose suma exactamente el total y respeta el orden del catálogo", () => {
  const mrr = computeMrr(
    [clinic("CLINIC"), clinic("BASIC"), clinic("PRO"), clinic("BASIC", 500)],
    PRICES,
  );
  assert.deepEqual(mrr.byPlan.map((l) => l.plan), ["BASIC", "PRO", "CLINIC"]);
  assert.equal(mrr.byPlan.reduce((s, l) => s + l.total, 0), mrr.total);
  assert.equal(mrr.byPlan.reduce((s, l) => s + l.clinics, 0), mrr.clinics);
  const basic = mrr.byPlan[0];
  assert.equal(basic.clinics, 2);
  assert.equal(basic.total, 419 + 500);
});

test("sin clínicas activas el MRR es 0 y el desglose lo dice", () => {
  const mrr = computeMrr([], PRICES);
  assert.deepEqual(mrr, EMPTY_MRR);
  assert.equal(mrrBreakdownHint(mrr), "Sin clínicas activas");
});

test("el hint del KPI enseña de dónde sale cada peso", () => {
  const mrr = computeMrr([clinic("BASIC"), clinic("BASIC"), clinic("CLINIC")], PRICES);
  assert.equal(mrrBreakdownHint(mrr), "2 BASIC · 1 CLINIC");
});

// ── Sedes incluidas en el plan de la madre ──────────────────────────────────
//
// El caso que infló el MRR 3×: un CLINIC con sus sedes. POST /api/clinics crea
// cada sede `active` con `monthlyPrice: 0` y sin cobro propio; `computeMrr`
// leía ese 0 como «sin precio negociado» y le ponía la lista. Rafael decidió:
// la sede incluida vale $0.

const DUENA = "supa-duena";
const ahoraMenos = (dias: number) => new Date(Date.UTC(2026, 8, 22) - dias * 86_400_000);

/** Una fila como la cargan las pantallas: id + plan + cobro + dueño. */
function fila(
  id: string,
  over: Partial<BranchBillingRow & MrrClinicRow> = {},
): BranchBillingRow & MrrClinicRow {
  return {
    id,
    plan: "CLINIC",
    createdAt: ahoraMenos(100),
    subscriptionStatus: "active",
    monthlyPrice: 0,
    stripeSubscriptionId: null,
    paypalSubscriptionId: null,
    subscriptionId: null,
    nextBillingDate: null,
    ...over,
  };
}

/** Lo que hacen las pantallas: marcar y valuar. */
function mrrDe(filas: Array<BranchBillingRow & MrrClinicRow>, owners: ClinicOwnerRow[]) {
  const sedes = findIncludedBranchIds(filas, owners);
  return computeMrr(
    filas
      .filter((c) => c.subscriptionStatus === "active")
      .map((c) => ({ ...c, includedBranch: sedes.has(c.id) })),
    PRICES,
  );
}

/** La madre paga por Stripe; sus sedes nacieron después y sin cobro propio. */
const madre = fila("madre", { createdAt: ahoraMenos(300), stripeSubscriptionId: "sub_madre", nextBillingDate: ahoraMenos(-20) });
const sede1 = fila("sede-1", { createdAt: ahoraMenos(200) });
const sede2 = fila("sede-2", { createdAt: ahoraMenos(150) });
const sede3 = fila("sede-3", { createdAt: ahoraMenos(100) });
const deLaDuena = (...ids: string[]) => ids.map((clinicId) => ({ supabaseId: DUENA, clinicId }));

test("una madre CLINIC con 3 sedes incluidas cuenta UNA vez el precio de CLINIC", () => {
  const filas = [madre, sede1, sede2, sede3];
  const owners = deLaDuena("madre", "sede-1", "sede-2", "sede-3");

  // Antes: el 0 caía a la lista → 4 × 1719.
  assert.equal(computeMrr(filas, PRICES).total, 4 * 1719, "así estaba: cada sede sumaba la lista");

  const mrr = mrrDe(filas, owners);
  assert.equal(mrr.total, 1719, "solo paga la madre");
  assert.equal(mrr.includedBranches, 3, "y se dice cuántas sedes no se cuentan");
  assert.equal(mrr.clinics, 1, "el desglose no cuenta las sedes como clínicas que cobran");
  assert.equal(mrrBreakdownHint(mrr), "1 CLINIC");
  assert.equal(includedBranchesHint(mrr.includedBranches), "No incluye 3 sedes incluidas en el plan de su clínica madre");
});

test("el caso que vio Rafael: $5,157 (madre + 2 sedes) baja a $1,719", () => {
  const filas = [madre, sede1, sede2];
  const owners = deLaDuena("madre", "sede-1", "sede-2");
  assert.equal(computeMrr(filas, PRICES).total, 5157);
  assert.equal(mrrDe(filas, owners).total, 1719);
});

test("una clínica suelta con su plan sigue sumando su lista, aunque tenga monthlyPrice 0", () => {
  // El OTRO cero: «sin precio negociado, cóbrale la lista». Sin hermana que
  // haga de madre no hay de quién ser sede.
  const suelta = fila("suelta", { plan: "PRO", stripeSubscriptionId: "sub_suelta" });
  const sueltaSinRastro = fila("suelta-2", { plan: "BASIC" });
  const mrr = mrrDe(
    [suelta, sueltaSinRastro],
    [{ supabaseId: "otra", clinicId: "suelta" }, { supabaseId: "otra-mas", clinicId: "suelta-2" }],
  );
  assert.equal(mrr.total, 689 + 419);
  assert.equal(mrr.includedBranches, 0);
  assert.equal(includedBranchesHint(mrr.includedBranches), null, "sin sedes no se pinta la línea");
});

test("una sede con precio negociado propio suma ese precio, no $0 ni la lista", () => {
  const negociada = fila("sede-neg", { monthlyPrice: 900, createdAt: ahoraMenos(50) });
  const mrr = mrrDe([madre, sede1, negociada], deLaDuena("madre", "sede-1", "sede-neg"));
  assert.equal(mrr.total, 1719 + 900);
  assert.equal(mrr.includedBranches, 1, "sólo sede-1 va incluida");
  assert.equal(mrr.byPlan[0].negotiated, 1);
});

test("una clínica con SU PROPIA suscripción suma aunque comparta dueño", () => {
  // Dos clínicas del mismo dueño, cada una pagando lo suyo: ninguna es sede
  // incluida de la otra.
  const otraConStripe = fila("otra-stripe", { plan: "PRO", createdAt: ahoraMenos(10), stripeSubscriptionId: "sub_otra" });
  const otraConSpei   = fila("otra-spei",   { plan: "BASIC", createdAt: ahoraMenos(9), nextBillingDate: ahoraMenos(-5) });
  const otraConPaypal = fila("otra-paypal", { plan: "PRO", createdAt: ahoraMenos(8), paypalSubscriptionId: "I-PAYPAL" });
  const mrr = mrrDe(
    [madre, otraConStripe, otraConSpei, otraConPaypal],
    deLaDuena("madre", "otra-stripe", "otra-spei", "otra-paypal"),
  );
  assert.equal(mrr.total, 1719 + 689 + 419 + 689);
  assert.equal(mrr.includedBranches, 0);
});

test("sin ninguna pagadora en el grupo, la madre es la activa más antigua", () => {
  // Una madre activada sin rastro de cobro (p. ej. a mano en la base). Si no,
  // las tres se quedarían sumando la lista y el arreglo no haría nada.
  const madreSinRastro = fila("madre-x", { createdAt: ahoraMenos(300) });
  const mrr = mrrDe([sede2, madreSinRastro, sede1], deLaDuena("madre-x", "sede-1", "sede-2"));
  assert.equal(mrr.total, 1719, "la madre sigue valiendo su lista");
  assert.equal(mrr.includedBranches, 2);
});

test("una clínica en trial o vencida del mismo dueño no es sede incluida", () => {
  const enTrial = fila("trial", { subscriptionStatus: "trialing" });
  const vencida = fila("vencida", { subscriptionStatus: "past_due" });
  const sedes = findIncludedBranchIds([madre, enTrial, vencida], deLaDuena("madre", "trial", "vencida"));
  assert.equal(sedes.size, 0);
});

test("una sede cuya madre dejó de pagar sigue sin sumar: no hay cobro de nadie", () => {
  const madreCancelada = { ...madre, subscriptionStatus: "cancelled" };
  const mrr = mrrDe([madreCancelada, sede1], deLaDuena("madre", "sede-1"));
  assert.equal(mrr.total, 0, "ni la madre (cancelada) ni la sede suman");
  assert.equal(mrr.includedBranches, 1);
});

test("el 0 sin marca de sede sigue valiendo la lista: computeMrr no adivina", () => {
  // La marca la pone findIncludedBranchIds, no el cero.
  assert.equal(computeMrr([clinic("CLINIC", 0)], PRICES).total, 1719);
  assert.equal(computeMrr([{ ...clinic("CLINIC", 0), includedBranch: true }], PRICES).total, 0);
  // Y un precio negociado manda incluso si alguien la marcara como sede.
  assert.equal(computeMrr([{ ...clinic("CLINIC", 500), includedBranch: true }], PRICES).total, 500);
});
