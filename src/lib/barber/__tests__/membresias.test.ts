import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_MEMBERSHIP_LINE_PREFIX,
  addDays,
  buildConsumeWhere,
  centsToMoney,
  computePeriodEnd,
  coverageReason,
  daysUntil,
  describeMembershipPlan,
  formatCents,
  isDepositLine,
  isMembershipLine,
  membershipLineDescription,
  membershipUrgency,
  moneyToCents,
  nextPeriodEnd,
  normalizeMembershipPlanInput,
  percentOfCents,
  pickCoveredLine,
  remainingCuts,
  shouldSweepToExpired,
  type ClientMembershipState,
} from "../memberships-core";

// Correr:  npx tsx --test src/lib/barber/__tests__/membresias.test.ts

const NOW = new Date("2026-08-24T12:00:00.000Z");

function membership(over: Partial<ClientMembershipState> = {}): ClientMembershipState {
  return {
    status: "ACTIVE",
    endAt: addDays(NOW, 10),
    cutsUsed: 0,
    includedCuts: 2,
    paymentMethod: "CASH",
    stripeSubscriptionId: null,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Dinero: enteros de centavos, cero float
// ═══════════════════════════════════════════════════════════════════════

test("el dinero se maneja en centavos enteros y no pierde precisión", () => {
  assert.equal(moneyToCents("349.50"), 34950);
  assert.equal(moneyToCents("349"), 34900);
  assert.equal(moneyToCents("349."), 34900);
  assert.equal(moneyToCents("1,299.99"), 129999);
  assert.equal(moneyToCents(599), 59900);
  assert.equal(moneyToCents(""), 0);
  assert.equal(moneyToCents(null), 0);
  assert.equal(moneyToCents("no-es-dinero"), 0);

  // El clásico de coma flotante: 0.1 + 0.2 en centavos es exacto.
  assert.equal(moneyToCents("0.10") + moneyToCents("0.20"), 30);
  assert.equal(centsToMoney(30), "0.30");

  // Ida y vuelta sin deriva sobre 1000 sumas.
  let acc = 0;
  for (let i = 0; i < 1000; i++) acc += moneyToCents("0.07");
  assert.equal(acc, 7000);
  assert.equal(centsToMoney(acc), "70.00");
});

test("el tercer decimal se redondea, no se trunca", () => {
  assert.equal(moneyToCents("10.005"), 1001);
  assert.equal(moneyToCents("10.004"), 1000);
});

test("porcentaje exacto sobre centavos", () => {
  assert.equal(percentOfCents(30000, 30), 9000); // 30% de $300 = $90
  assert.equal(percentOfCents(34950, 50), 17475);
  assert.equal(percentOfCents(33333, 33.33), 11110); // redondeo al centavo
  assert.equal(percentOfCents(10000, 0), 0);
});

test("centsToMoney conserva el signo (la línea de crédito es negativa)", () => {
  assert.equal(centsToMoney(-35000), "-350.00");
  assert.equal(centsToMoney(-5), "-0.05");
});

// ═══════════════════════════════════════════════════════════════════════
// Vigencia y cupo
// ═══════════════════════════════════════════════════════════════════════

test("cortes restantes: nunca negativos, null = ilimitado", () => {
  assert.equal(remainingCuts(2, 0), 2);
  assert.equal(remainingCuts(2, 2), 0);
  // Aunque la BD trajera basura, el número que se pinta nunca baja de cero.
  assert.equal(remainingCuts(2, 5), 0);
  assert.equal(remainingCuts(null, 99), null);
});

test("una membresía de 2 cortes cubre el 1º y el 2º, y el 3º se cobra", () => {
  assert.equal(coverageReason(membership({ cutsUsed: 0 }), NOW), "COVERED");
  assert.equal(coverageReason(membership({ cutsUsed: 1 }), NOW), "COVERED");
  assert.equal(coverageReason(membership({ cutsUsed: 2 }), NOW), "QUOTA_EXHAUSTED");
});

test("la ilimitada nunca se queda sin cupo", () => {
  assert.equal(coverageReason(membership({ includedCuts: null, cutsUsed: 500 }), NOW), "COVERED");
});

test("vencida, pausada y cancelada no cubren", () => {
  assert.equal(coverageReason(membership({ endAt: addDays(NOW, -1) }), NOW), "EXPIRED");
  assert.equal(coverageReason(membership({ status: "EXPIRED" }), NOW), "EXPIRED");
  assert.equal(coverageReason(membership({ status: "PAUSED" }), NOW), "INACTIVE");
  assert.equal(coverageReason(membership({ status: "CANCELLED" }), NOW), "INACTIVE");
  assert.equal(coverageReason(null, NOW), "NO_MEMBERSHIP");
});

// ═══════════════════════════════════════════════════════════════════════
// Periodos: vencer sin Stripe, renovar sin perder días
// ═══════════════════════════════════════════════════════════════════════

test("el fin de periodo sale del plan, no de Stripe", () => {
  assert.equal(computePeriodEnd(NOW, 30).toISOString(), "2026-09-23T12:00:00.000Z");
  assert.equal(computePeriodEnd(NOW, 15).toISOString(), "2026-09-08T12:00:00.000Z");
  // periodDays inválido cae a 30 días.
  assert.equal(computePeriodEnd(NOW, 0).toISOString(), "2026-09-23T12:00:00.000Z");
});

test("renovar encadena al periodo actual: el cliente no pierde días", () => {
  const stillValid = addDays(NOW, 5);
  assert.equal(nextPeriodEnd(stillValid, 30, NOW).toISOString(), addDays(NOW, 35).toISOString());
  // Si ya venció, el periodo nuevo arranca hoy (no se regalan los días muertos).
  const expired = addDays(NOW, -9);
  assert.equal(nextPeriodEnd(expired, 30, NOW).toISOString(), addDays(NOW, 30).toISOString());
});

test("una membresía de EFECTIVO vence sola: no necesita Stripe ni gracia", () => {
  const cash = membership({ endAt: addDays(NOW, -1), stripeSubscriptionId: null });
  assert.equal(shouldSweepToExpired(cash, NOW), true);

  const cashToday = membership({ endAt: addDays(NOW, 1) });
  assert.equal(shouldSweepToExpired(cashToday, NOW), false);
});

test("la de tarjeta recurrente respeta 3 días de gracia antes de marcarse vencida", () => {
  const auto = (days: number) =>
    membership({ endAt: addDays(NOW, days), stripeSubscriptionId: "sub_123" });
  // Recién pasado el corte: sigue activa mientras entra el cobro.
  assert.equal(shouldSweepToExpired(auto(-1), NOW), false);
  assert.equal(shouldSweepToExpired(auto(-2), NOW), false);
  // Pasada la gracia sí se marca vencida.
  assert.equal(shouldSweepToExpired(auto(-3), NOW), true);
  assert.equal(shouldSweepToExpired(auto(-10), NOW), true);
});

test("por vencer = 7 días o menos; vencida = fecha pasada", () => {
  assert.equal(membershipUrgency(membership({ endAt: addDays(NOW, 20) }), NOW), "OK");
  assert.equal(membershipUrgency(membership({ endAt: addDays(NOW, 7) }), NOW), "SOON");
  assert.equal(membershipUrgency(membership({ endAt: addDays(NOW, 1) }), NOW), "SOON");
  assert.equal(membershipUrgency(membership({ endAt: addDays(NOW, -1) }), NOW), "EXPIRED");
  assert.equal(daysUntil(addDays(NOW, 3), NOW), 3);
  assert.equal(daysUntil(addDays(NOW, -3), NOW), -3);
});

// ═══════════════════════════════════════════════════════════════════════
// El candado atómico del cupo
// ═══════════════════════════════════════════════════════════════════════

test("el where del descuento lleva el cupo DENTRO (no se lee y luego se escribe)", () => {
  const where = buildConsumeWhere({
    clientMembershipId: "cm_1",
    barbershopId: "shop_1",
    includedCuts: 2,
    now: NOW,
  });
  // El filtro multi-tenant SIEMPRE va (un undefined aquí borraría el filtro).
  assert.equal(where.barbershopId, "shop_1");
  assert.equal(where.id, "cm_1");
  assert.equal(where.status, "ACTIVE");
  assert.deepEqual(where.endAt, { gt: NOW });
  // Y el candado del cupo, que es lo que hace imposible el negativo.
  assert.deepEqual(where.cutsUsed, { lt: 2 });
});

test("la ilimitada omite la condición de cupo a propósito", () => {
  const where = buildConsumeWhere({
    clientMembershipId: "cm_1",
    barbershopId: "shop_1",
    includedCuts: null,
    now: NOW,
  });
  assert.equal("cutsUsed" in where, false);
});

// ═══════════════════════════════════════════════════════════════════════
// Qué línea del ticket cubre la membresía
// ═══════════════════════════════════════════════════════════════════════

test("la membresía cubre el servicio MÁS CARO del ticket", () => {
  const idx = pickCoveredLine([
    { serviceId: "s1", description: "Delineado", unitPriceCents: 8000, qty: 1 },
    { serviceId: "s2", description: "Corte + barba", unitPriceCents: 28000, qty: 1 },
    { serviceId: "s3", description: "Cejas", unitPriceCents: 6000, qty: 1 },
  ]);
  assert.equal(idx, 1);
});

test("ignora productos, líneas libres, líneas en cero y las marcadoras", () => {
  assert.equal(
    pickCoveredLine([
      { serviceId: null, description: "Cera para el cabello", unitPriceCents: 22000, qty: 1 },
      { serviceId: "s1", description: "Cortesía", unitPriceCents: 0, qty: 1 },
    ]),
    -1,
  );
  // Una línea de membresía ya aplicada no puede volver a "cubrirse".
  assert.equal(
    pickCoveredLine([
      {
        serviceId: "s1",
        description: membershipLineDescription("Ilimitado", "Corte"),
        unitPriceCents: 18000,
        qty: 1,
      },
    ]),
    -1,
  );
});

test("los marcadores de línea distinguen membresía de anticipo", () => {
  const mem = membershipLineDescription("Corte ilimitado", "Corte de cabello");
  assert.ok(mem.startsWith(BARBER_MEMBERSHIP_LINE_PREFIX));
  assert.equal(isMembershipLine(mem), true);
  assert.equal(isDepositLine(mem), false);
  assert.equal(isMembershipLine("Corte de cabello"), false);
  assert.equal(isMembershipLine(null), false);
});

// ═══════════════════════════════════════════════════════════════════════
// Validación del plan que define la barbería
// ═══════════════════════════════════════════════════════════════════════

test("el plan exige nombre y precio, y acepta ilimitado", () => {
  assert.equal(normalizeMembershipPlanInput({ name: "", price: "349" }).ok, false);
  assert.equal(normalizeMembershipPlanInput({ name: "X", price: "0" }).ok, false);
  assert.equal(normalizeMembershipPlanInput({ name: "X", price: "-5" }).ok, false);

  const ok = normalizeMembershipPlanInput({
    name: "  Corte ilimitado  ",
    price: "599.00",
    unlimited: true,
    periodDays: 30,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.name, "Corte ilimitado");
    assert.equal(ok.value.priceCents, 59900);
    assert.equal(ok.value.includedCuts, null);
    assert.equal(ok.value.periodDays, 30);
  }
});

test("cortes incluidos: entero >= 1, y el periodo va de 1 a 365 días", () => {
  assert.equal(normalizeMembershipPlanInput({ name: "X", price: "1", includedCuts: 0 }).ok, false);
  assert.equal(normalizeMembershipPlanInput({ name: "X", price: "1", includedCuts: 1.5 }).ok, false);
  assert.equal(
    normalizeMembershipPlanInput({ name: "X", price: "1", includedCuts: 2, periodDays: 400 }).ok,
    false,
  );
  assert.equal(
    normalizeMembershipPlanInput({ name: "X", price: "1", includedCuts: 2, periodDays: 0 }).ok,
    false,
  );
});

test("la descripción del plan se lee como la vendería el dueño", () => {
  assert.equal(describeMembershipPlan({ includedCuts: 2, periodDays: 30 }), "2 cortes al mes");
  assert.equal(describeMembershipPlan({ includedCuts: 1, periodDays: 15 }), "1 corte cada quincena");
  assert.equal(
    describeMembershipPlan({ includedCuts: null, periodDays: 30 }),
    "Cortes ilimitados al mes",
  );
  assert.equal(
    describeMembershipPlan({ includedCuts: 2, periodDays: 30 }, "en"),
    "2 cuts per month",
  );
});

test("el precio se formatea en pesos, sin decimales cuando es entero", () => {
  assert.equal(formatCents(34900).replace(/ /g, " "), "$349");
  assert.equal(formatCents(34950).replace(/ /g, " "), "$349.50");
});
