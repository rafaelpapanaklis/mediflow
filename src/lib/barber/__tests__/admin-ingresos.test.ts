// Quién paga y cuánto entra al mes en el vertical barber (panel de plataforma).
//   npx tsx --test src/lib/barber/__tests__/admin-ingresos.test.ts
//
// El caso de producción del 15-nov-2026: 5 barberías; UNA paga Profesional
// por Stripe, TRES están «active» activadas a mano (cortesía) y una sigue en
// pending_payment. Rafael espera ver $749 de ingreso, no 4 × $749.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { clasificarCobro, pagoMensual, resumirIngresosBarber } from "@/lib/barber/admin-ingresos";
import { anidarSedes } from "@/components/admin/barberias/shared";

// Lo que trae barber_plan_configs hoy (las pruebas reciben la tabla, como el código).
const TABLA = {
  BASICO: new Prisma.Decimal("199.00"),
  AVANZADO: new Prisma.Decimal("329.00"),
  PROFESIONAL: new Prisma.Decimal("749.00"),
};

const PRODUCCION = [
  { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: "sub_paga" },
  { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
  { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
  { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
  { plan: "BASICO", subscriptionStatus: "pending_payment", stripeSubscriptionId: null },
];

test("1 Profesional por Stripe + 3 cortesías + 1 sin pagar → $749 y 1 que paga", () => {
  const r = resumirIngresosBarber(PRODUCCION, TABLA);
  assert.equal(r.barberias, 5);
  assert.equal(r.pagan, 1);
  assert.equal(r.cortesia, 3);
  assert.equal(r.sinPagar, 1);
  assert.equal(r.prueba, 0);
  assert.equal(r.mrr, "749.00");
  assert.deepEqual(
    r.porPlan.map((p) => [p.planId, p.pagan, p.mrr]),
    [["BASICO", 0, "0.00"], ["AVANZADO", 0, "0.00"], ["PROFESIONAL", 1, "749.00"]],
  );
});

test("una cortesía no es ingreso: paga $0 aunque su plan valga $749", () => {
  assert.equal(clasificarCobro(PRODUCCION[1]), "cortesia");
  assert.equal(pagoMensual(PRODUCCION[1], TABLA).toFixed(2), "0.00");
  assert.equal(pagoMensual(PRODUCCION[0], TABLA).toFixed(2), "749.00");
});

test("el precio sale de la tabla: si Rafael lo cambia en /admin/settings, cambia el MRR", () => {
  const r = resumirIngresosBarber(PRODUCCION, { ...TABLA, PROFESIONAL: new Prisma.Decimal("799.50") });
  assert.equal(r.mrr, "799.50");
});

test("Stripe sin cobrar todavía no suma: past_due y trialing", () => {
  assert.equal(clasificarCobro({ subscriptionStatus: "past_due", stripeSubscriptionId: "sub_x" }), "sin_pagar");
  assert.equal(clasificarCobro({ subscriptionStatus: "trialing", stripeSubscriptionId: "sub_x" }), "prueba");
  assert.equal(clasificarCobro({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_x" }), "sin_pagar");
  assert.equal(clasificarCobro({ subscriptionStatus: "suspended", stripeSubscriptionId: "sub_x" }), "sin_pagar");
  assert.equal(clasificarCobro({ subscriptionStatus: "pending_payment", stripeSubscriptionId: null }), "sin_pagar");
  const r = resumirIngresosBarber(
    [
      { plan: "AVANZADO", subscriptionStatus: "past_due", stripeSubscriptionId: "sub_a" },
      { plan: "AVANZADO", subscriptionStatus: "trialing", stripeSubscriptionId: "sub_b" },
      { plan: "AVANZADO", subscriptionStatus: "active", stripeSubscriptionId: "sub_c" },
    ],
    TABLA,
  );
  assert.equal(r.mrr, "329.00");
  assert.deepEqual([r.pagan, r.prueba, r.sinPagar, r.cortesia], [1, 1, 1, 0]);
});

test("el booleano «tiene Stripe» vale igual que el id", () => {
  assert.equal(clasificarCobro({ subscriptionStatus: "active", stripeSubscriptionId: true }), "stripe");
  assert.equal(clasificarCobro({ subscriptionStatus: "active", stripeSubscriptionId: false }), "cortesia");
});

test("sin barberías: todo en cero, sin NaN", () => {
  const r = resumirIngresosBarber([], TABLA);
  assert.equal(r.mrr, "0.00");
  assert.equal(r.barberias, 0);
});

// ── La lista anida las sucursales bajo su matriz ────────────────────────

test("las sucursales van detrás de su matriz, sin perder el orden de las matrices", () => {
  const filas = [
    { id: "s1", parentId: "m2" },
    { id: "m1", parentId: null },
    { id: "m2", parentId: null },
    { id: "s2", parentId: "m1" },
  ];
  assert.deepEqual(
    anidarSedes(filas).map((f) => `${f.sede ? "  " : ""}${f.fila.id}`),
    ["m1", "  s2", "m2", "  s1"],
  );
});

test("una sucursal cuya matriz quedó fuera por un filtro no desaparece", () => {
  const out = anidarSedes([{ id: "s9", parentId: "fuera" }, { id: "m1", parentId: null }]);
  assert.deepEqual(out.map((f) => [f.fila.id, f.sede]), [["s9", false], ["m1", false]]);
});
