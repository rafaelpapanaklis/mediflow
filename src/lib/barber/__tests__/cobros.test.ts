// Cobros de la suscripción de barber: leer facturas de Stripe, importe real
// y las cifras del admin (decisión #5 de Rafael, 15-nov-2026).
//   npx tsx --test src/lib/barber/__tests__/cobros.test.ts
// Puro: sin base ni Stripe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  esFacturaBarber,
  leerCobroDeFactura,
  mensualDesdeCentavos,
  terminosDeSuscripcion,
  type InvoiceLike,
} from "@/lib/barber/cobros-core";
import {
  clasificarCobro,
  pagoMensual,
  resumirIngresosBarber,
  type RegistroCobros,
} from "@/lib/barber/admin-ingresos";

const s = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const PRECIO_BARBER = {
  id: "price_pro_m",
  unit_amount: 74900,
  recurring: { interval: "month" },
  metadata: { dc_vertical: "barber", dc_plan: "PROFESIONAL", dc_interval: "month" },
};

/** Renovación del 14-dic de la barbería que se dio de alta el 14-nov. */
function renovacion(over: Partial<InvoiceLike> = {}): InvoiceLike {
  return {
    id: "in_renov",
    status: "paid",
    customer: "cus_1",
    subscription: "sub_1",
    subscription_details: { metadata: { dc_vertical: "barber", dc_kind: "barber-subscription", barbershopId: "shop_1" } },
    amount_paid: 74900,
    amount_due: 74900,
    currency: "mxn",
    created: s("2026-12-14T16:00:00Z"),
    status_transitions: { paid_at: s("2026-12-14T17:02:00Z") },
    lines: {
      data: [
        {
          amount: 74900,
          proration: false,
          type: "subscription",
          period: { start: s("2026-12-14T16:00:00Z"), end: s("2027-01-14T16:00:00Z") },
          price: PRECIO_BARBER,
        },
      ],
    },
    ...over,
  };
}

test("una factura pagada se lee con su importe REAL, el periodo de servicio y el plan", () => {
  const c = leerCobroDeFactura(renovacion(), "invoice.paid")!;
  assert.equal(c.status, "paid");
  assert.equal(c.amountCents, 74900);
  assert.equal(c.currency, "mxn");
  assert.equal(c.planId, "PROFESIONAL");
  assert.equal(c.interval, "month");
  assert.equal(c.subscriptionId, "sub_1");
  // El periodo es el de las LÍNEAS (14-dic → 14-ene), no invoice.period_*.
  assert.equal(c.periodStart?.toISOString(), "2026-12-14T16:00:00.000Z");
  assert.equal(c.periodEnd?.toISOString(), "2027-01-14T16:00:00.000Z");
  assert.equal(c.paidAt?.toISOString(), "2026-12-14T17:02:00.000Z");
});

test("el primer mes con cupón guarda lo que Stripe cobró, no el precio de lista", () => {
  const c = leerCobroDeFactura(renovacion({ amount_paid: 49900, amount_due: 49900 }), "invoice.paid")!;
  assert.equal(c.amountCents, 49900);
});

test("rechazo: se guarda como 'failed' con lo que se intentó cobrar; un borrador no se guarda", () => {
  const f = leerCobroDeFactura(
    renovacion({
      status: "open",
      amount_paid: 0,
      payment_intent: { last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" } },
    }),
    "invoice.payment_failed",
  )!;
  assert.equal(f.status, "failed");
  assert.equal(f.amountCents, 74900);
  assert.equal(f.failureCode, "insufficient_funds");
  assert.equal(f.paidAt, null);
  // Abierta pero el evento no es un rechazo (p. ej. invoice.paid fuera de orden con la factura aún abierta).
  assert.equal(leerCobroDeFactura(renovacion({ status: "open" }), "invoice.paid"), null);
  assert.equal(leerCobroDeFactura(renovacion({ status: "draft" }), "invoice.payment_failed"), null);
});

test("subir de plan a medio mes: la factura de prorrateo trae el plan nuevo y el fin del periodo", () => {
  const c = leerCobroDeFactura(
    renovacion({
      id: "in_prorrateo",
      amount_paid: 21000,
      lines: {
        data: [
          {
            amount: -10000,
            proration: true,
            period: { start: s("2026-11-30T00:00:00Z"), end: s("2026-12-14T16:00:00Z") },
            price: { ...PRECIO_BARBER, unit_amount: 32900, metadata: { dc_vertical: "barber", dc_plan: "AVANZADO" } },
          },
          {
            amount: 31000,
            proration: true,
            period: { start: s("2026-11-30T00:00:00Z"), end: s("2026-12-14T16:00:00Z") },
            price: PRECIO_BARBER,
          },
        ],
      },
    }),
    "invoice.paid",
  )!;
  assert.equal(c.planId, "PROFESIONAL");
  assert.equal(c.amountCents, 21000);
  assert.equal(c.periodEnd?.toISOString(), "2026-12-14T16:00:00.000Z");
});

test("solo pasan las facturas de la suscripción de barber: ni el dental ni las membresías de T4", () => {
  assert.equal(esFacturaBarber(renovacion()), true);
  // API nueva: la marca viaja en parent.subscription_details.
  assert.equal(
    esFacturaBarber(
      renovacion({
        subscription_details: null,
        parent: { subscription_details: { subscription: "sub_1", metadata: { dc_vertical: "barber" } } },
      }),
    ),
    true,
  );
  // Sin metadata de suscripción: la marca del PRECIO basta.
  assert.equal(esFacturaBarber(renovacion({ subscription_details: null })), true);
  // Dental: misma cuenta de Stripe, sin ninguna marca nuestra.
  assert.equal(
    esFacturaBarber(
      renovacion({
        subscription_details: { metadata: { clinicId: "c1" } },
        lines: { data: [{ amount: 59900, price: { id: "price_dental", recurring: { interval: "month" }, metadata: {} } }] },
      }),
    ),
    false,
  );
  // Membresía de un cliente final (T4): su suscripción va marcada con dcb.
  assert.equal(
    esFacturaBarber(renovacion({ subscription_details: { metadata: { dcb: "membership", dcbShop: "shop_1" } } })),
    false,
  );
  assert.equal(esFacturaBarber(null), false);
});

test("términos reales: importe × cantidad, ciclo y plan; un anual son 12 meses", () => {
  const t = terminosDeSuscripcion({
    id: "sub_anual",
    status: "active",
    items: {
      data: [
        {
          quantity: 1,
          current_period_end: s("2027-11-14T16:00:00Z"),
          price: { unit_amount: 749000, currency: "MXN", recurring: { interval: "year" }, metadata: { dc_plan: "PROFESIONAL" } },
        },
      ],
    },
  });
  assert.deepEqual(
    [t.priceCents, t.currency, t.interval, t.planId, t.currentPeriodEnd?.toISOString()],
    [749000, "mxn", "year", "PROFESIONAL", "2027-11-14T16:00:00.000Z"],
  );
  assert.equal(mensualDesdeCentavos(749000, "year").toFixed(2), "624.17");
  assert.equal(mensualDesdeCentavos(74900, "month").toFixed(2), "749.00");
});

// ── El admin con el registro de cobros ───────────────────────────────────

const TABLA = {
  BASICO: new Prisma.Decimal("199.00"),
  AVANZADO: new Prisma.Decimal("329.00"),
  PROFESIONAL: new Prisma.Decimal("749.00"),
};

function registro(entries: Array<[string, { vigente: boolean; mensual: string | null; cobradoMes: string }]>): RegistroCobros {
  const porBarberia = new Map(
    entries.map(([id, r]) => [
      id,
      {
        vigente: r.vigente,
        mensual: r.mensual === null ? null : new Prisma.Decimal(r.mensual),
        cobradoMes: new Prisma.Decimal(r.cobradoMes),
      },
    ]),
  );
  const cobradoMes = [...porBarberia.values()].reduce((a, r) => a.add(r.cobradoMes), new Prisma.Decimal(0));
  return { porBarberia, cobradoMes };
}

test("M1: el MRR usa lo que cobra Stripe (anual ÷ 12), no el precio de lista de hoy", () => {
  const matrices = [
    { id: "anual", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: "sub_a" },
    // Contrató a $699 y luego Rafael subió la tabla a $749: Stripe le sigue cobrando $699.
    { id: "vieja", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: "sub_v" },
  ];
  const cobros = registro([
    ["anual", { vigente: true, mensual: "624.17", cobradoMes: "0" }],
    ["vieja", { vigente: true, mensual: "699.00", cobradoMes: "699.00" }],
  ]);
  const r = resumirIngresosBarber(matrices, TABLA, cobros);
  assert.equal(r.mrr, "1323.17");
  assert.equal(r.fuente, "cobros");
  assert.equal(r.cobradoMes, "699.00");
  // Sin registro (SQL sin pegar) sale el cálculo de antes: 2 × lista.
  const lista = resumirIngresosBarber(matrices, TABLA);
  assert.equal(lista.mrr, "1498.00");
  assert.equal(lista.fuente, "lista");
  assert.equal(lista.cobradoMes, null);
});

test("M2: reactivada a mano con un id viejo de Stripe ya NO cuenta como «paga»", () => {
  const reactivada = { id: "r", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: "sub_viejo" };
  const cobros = registro([["r", { vigente: false, mensual: "749.00", cobradoMes: "0" }]]);
  assert.equal(clasificarCobro(reactivada, cobros), "cortesia");
  assert.equal(pagoMensual(reactivada, TABLA, cobros).toFixed(2), "0.00");
  // Antes (sin registro) salía como «paga»: es justo lo que se corrige.
  assert.equal(clasificarCobro(reactivada), "stripe");
});

test("producción 15-nov con el registro: la que pagó cuenta por su cobro; sin sembrarla saldría cortesía", () => {
  const PROD = [
    { id: "paga", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: "sub_paga" },
    { id: "c1", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
    { id: "c2", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
    { id: "c3", plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
    { id: "p", plan: "BASICO", subscriptionStatus: "pending_payment", stripeSubscriptionId: null },
  ];
  const sembrada = resumirIngresosBarber(PROD, TABLA, registro([["paga", { vigente: true, mensual: "749.00", cobradoMes: "749.00" }]]));
  assert.deepEqual([sembrada.pagan, sembrada.cortesia, sembrada.sinPagar, sembrada.mrr, sembrada.cobradoMes], [1, 3, 1, "749.00", "749.00"]);
  const sinSembrar = resumirIngresosBarber(PROD, TABLA, registro([]));
  assert.deepEqual([sinSembrar.pagan, sinSembrar.cortesia, sinSembrar.mrr], [0, 4, "0.00"]);
});

test("con cobro vigente pero sin términos guardados, el pago al mes cae al precio de lista", () => {
  const m = { id: "x", plan: "AVANZADO", subscriptionStatus: "active", stripeSubscriptionId: "sub_x" };
  const cobros = registro([["x", { vigente: true, mensual: null, cobradoMes: "329.00" }]]);
  assert.equal(pagoMensual(m, TABLA, cobros).toFixed(2), "329.00");
});

test("un cobro vigente con la barbería sin acceso (past_due, suspendida) no suma", () => {
  const cobros = registro([["x", { vigente: true, mensual: "749.00", cobradoMes: "749.00" }]]);
  for (const st of ["past_due", "suspended", "canceled"]) {
    assert.equal(clasificarCobro({ id: "x", subscriptionStatus: st, stripeSubscriptionId: "sub_x" }, cobros), "sin_pagar");
  }
});
