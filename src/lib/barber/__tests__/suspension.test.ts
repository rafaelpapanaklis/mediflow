// SIN DÍAS DE GRACIA (decisión #10 de Rafael, 15-nov-2026): la barbería queda
// suspendida al terminar el día (de México) en que termina su periodo pagado.
//   npx tsx --test src/lib/barber/__tests__/suspension.test.ts
// Puro + applyBarberSubscription con dobles: sin base ni Stripe.
import "./_sin-server-only";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_VENCIDA_STATUS,
  barberiaVencida,
  corteAplica,
  estadoEfectivo,
  fechaMexico,
  periodoPagadoVencido,
  type BarberLedger,
} from "@/lib/barber/cobros-core";

const d = (iso: string) => new Date(iso);

/** Alta el 14-nov a las 10:00 de México (16:00Z): paga hasta el 14-dic 10:00. */
const PAGADO_HASTA = d("2026-12-14T16:00:00Z");
const ledger = (over: Partial<BarberLedger> = {}): BarberLedger => ({
  paidThroughAt: PAGADO_HASTA,
  lastPaidAt: d("2026-11-14T16:01:00Z"),
  manualAccessAt: null,
  ...over,
});

test("el día del aniversario se trabaja completo; a las 00:00 (México) del siguiente se corta", () => {
  // 14-dic 23:59:59 en México = 15-dic 05:59:59Z → todavía es su día.
  assert.equal(periodoPagadoVencido(PAGADO_HASTA, d("2026-12-15T05:59:59Z")), false);
  // 15-dic 00:00:00 en México = 06:00:00Z → suspendida.
  assert.equal(periodoPagadoVencido(PAGADO_HASTA, d("2026-12-15T06:00:00Z")), true);
  // Antes del cobro, a media mañana del aniversario: nada.
  assert.equal(periodoPagadoVencido(PAGADO_HASTA, d("2026-12-14T18:00:00Z")), false);
  assert.equal(fechaMexico(d("2026-12-15T05:59:59Z")), "2026-12-14");
});

test("contratada a las 23:30 de México: el aniversario es el día de México, no el de UTC", () => {
  // 14-nov 23:30 MX = 15-nov 05:30Z → paga hasta 14-dic 23:30 MX (15-dic 05:30Z).
  const tarde = d("2026-12-15T05:30:00Z");
  assert.equal(fechaMexico(tarde), "2026-12-14");
  assert.equal(periodoPagadoVencido(tarde, d("2026-12-15T05:59:00Z")), false);
  assert.equal(periodoPagadoVencido(tarde, d("2026-12-15T06:00:00Z")), true);
});

test("sin cobros registrados el corte NO aplica: nada se cierra por falta de datos", () => {
  assert.equal(corteAplica(null), false);
  assert.equal(corteAplica({ paidThroughAt: null, lastPaidAt: null, manualAccessAt: null }), false);
  assert.equal(barberiaVencida(null, d("2030-01-01T00:00:00Z")), false);
  assert.equal(estadoEfectivo("active", null, d("2030-01-01T00:00:00Z")), "active");
});

test("reactivada A MANO después de su último cobro: es cortesía, el corte no la vuelve a cerrar", () => {
  const manual = ledger({ manualAccessAt: d("2027-01-03T18:00:00Z") });
  assert.equal(corteAplica(manual), false);
  assert.equal(barberiaVencida(manual, d("2027-02-01T18:00:00Z")), false);
  // …hasta que vuelve a pagar: desde ese cobro manda otra vez la fecha.
  const pagoDespues = ledger({
    manualAccessAt: d("2027-01-03T18:00:00Z"),
    lastPaidAt: d("2027-01-10T18:00:00Z"),
    paidThroughAt: d("2027-02-10T18:00:00Z"),
  });
  assert.equal(corteAplica(pagoDespues), true);
  assert.equal(barberiaVencida(pagoDespues, d("2027-02-11T07:00:00Z")), true);
});

test("estado efectivo: solo CIERRA lo que Stripe todavía da por bueno; nunca abre", () => {
  const despues = d("2026-12-15T06:00:00Z");
  const antes = d("2026-12-15T05:00:00Z");
  assert.equal(estadoEfectivo("active", ledger(), despues), BARBER_VENCIDA_STATUS);
  assert.equal(estadoEfectivo("trialing", ledger(), despues), BARBER_VENCIDA_STATUS);
  assert.equal(estadoEfectivo("paid", ledger(), despues), BARBER_VENCIDA_STATUS);
  assert.equal(estadoEfectivo("active", ledger(), antes), "active");
  for (const st of ["past_due", "canceled", "unpaid", "suspended", "pending_payment"]) {
    assert.equal(estadoEfectivo(st, ledger(), despues), st);
    assert.equal(estadoEfectivo(st, ledger(), antes), st);
  }
});

// ── El webhook no reabre una barbería vencida ────────────────────────────

test("un customer.subscription.updated «active» con el periodo pagado vencido escribe past_due en matriz y sedes", async () => {
  const { applyBarberSubscription } = await import("@/lib/barber/billing");
  const writes: any[] = [];
  const db = {
    barbershop: {
      findFirst: async () => ({ id: "shop_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" }),
      update: async (a: any) => writes.push(["matriz", a.data.subscriptionStatus]),
      updateMany: async (a: any) => writes.push(["sedes", a.data.subscriptionStatus]),
    },
    cobros: {
      leerRegistro: async () => ledger(),
      guardarCobro: async () => "guardado" as const,
      guardarTerminos: async () => "guardado" as const,
    },
  };
  const sub = {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    metadata: { dc_vertical: "barber", barbershopId: "shop_1" },
    items: { data: [{ price: { unit_amount: 74900, recurring: { interval: "month" }, metadata: { dc_plan: "PROFESIONAL" } } }] },
  };
  const r = await applyBarberSubscription(db, sub, { now: d("2026-12-15T06:00:00Z") });
  assert.equal(r.patch?.subscriptionStatus, "past_due");
  assert.deepEqual(writes, [["matriz", "past_due"], ["sedes", "past_due"]]);

  // El mismo evento un rato antes de la medianoche: sigue abierta.
  writes.length = 0;
  await applyBarberSubscription(db, sub, { now: d("2026-12-15T05:00:00Z") });
  assert.deepEqual(writes, [["matriz", "active"], ["sedes", "active"]]);

  // Sin registro de cobros (doble sin `cobros`): exactamente lo de antes.
  writes.length = 0;
  const { cobros: _sin, ...sinRegistro } = db;
  await applyBarberSubscription(sinRegistro, sub, { now: d("2030-01-01T00:00:00Z") });
  assert.deepEqual(writes, [["matriz", "active"], ["sedes", "active"]]);
});
