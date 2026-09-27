/**
 * Aviso a RECEPCIÓN de anticipos por revisar (ws1-t3) — ahora con DOS fuentes:
 * el anticipo del bot (Mercado Pago, vía AppointmentDepositPayment.anomaly) y,
 * desde fase 2, «Registrar anticipo recibido» (efectivo/transferencia/
 * terminal), cuya anomalía —si la cita no se pudo confirmar sola— queda en
 * Payment.notes marcada con "⚠️" (mismo criterio que aplicarPagoDeFactura).
 *
 * Necesita --experimental-test-module-mocks (mock.module sustituye
 * "@/lib/prisma"). El módulo bajo prueba se importa DESPUÉS del mock.
 *
 * Run: npm run test:avisos-recepcion
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let appointmentDepositPaymentRows: any[] = [];
let appointmentDepositRows: any[] = [];
let paymentRows: any[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      appointmentDepositPayment: {
        findMany: async ({ where }: any) =>
          appointmentDepositPaymentRows.filter(
            (r) => r.clinicId === where.clinicId && r.anomaly != null && r.deposit.origin === where.deposit.origin,
          ),
      },
      appointmentDeposit: {
        findMany: async ({ where }: any) =>
          appointmentDepositRows.filter(
            (r) =>
              r.clinicId === where.clinicId &&
              r.origin === where.origin &&
              where.method.in.includes(r.method) &&
              r.status === where.status &&
              r.paymentId != null,
          ),
      },
      payment: {
        findMany: async ({ where }: any) =>
          paymentRows.filter((p) => where.id.in.includes(p.id) && typeof p.notes === "string" && p.notes.includes(where.notes.contains)),
      },
    },
  },
});

function reset() {
  appointmentDepositPaymentRows = [];
  appointmentDepositRows = [];
  paymentRows = [];
}

test("sin nada que revisar: lista vacía", async () => {
  reset();
  const { anticiposPorRevisar } = await import("../avisos-recepcion.server");
  const r = await anticiposPorRevisar("c1");
  assert.deepEqual(r, []);
});

test("anomalía del BOT (Mercado Pago): sigue apareciendo, sin cambios de fase 1", async () => {
  reset();
  appointmentDepositPaymentRows = [
    {
      clinicId: "c1",
      amount: 150,
      anomaly: "Segundo pago del mismo anticipo: revisar y devolver si no corresponde.",
      createdAt: new Date("2026-09-01T10:00:00Z"),
      deposit: { id: "dep1", origin: "panel", patient: { firstName: "Ana", lastName: "Ruiz" } },
    },
  ];
  const { anticiposPorRevisar } = await import("../avisos-recepcion.server");
  const r = await anticiposPorRevisar("c1");
  assert.equal(r.length, 1);
  assert.equal(r[0].depositId, "dep1");
  assert.equal(r[0].paciente, "Ana Ruiz");
  assert.match(r[0].motivo, /Segundo pago/);
});

test("fase 2 — «Registrar anticipo recibido» con anomalía (hueco perdido): SÍ aparece", async () => {
  reset();
  appointmentDepositRows = [
    {
      id: "dep2",
      clinicId: "c1",
      origin: "panel",
      method: "transferencia",
      status: "PAID",
      paymentId: "pay1",
      createdAt: new Date("2026-09-02T11:00:00Z"),
      patient: { firstName: "Luis", lastName: "Pérez" },
    },
  ];
  paymentRows = [
    {
      id: "pay1",
      amount: 300,
      notes: "⚠️ El anticipo se cobró, pero la cita ya no estaba disponible para confirmarla sola (estado: CANCELLED). Revísala con el paciente.",
    },
  ];
  const { anticiposPorRevisar } = await import("../avisos-recepcion.server");
  const r = await anticiposPorRevisar("c1");
  assert.equal(r.length, 1);
  assert.equal(r[0].depositId, "dep2");
  assert.equal(r[0].paciente, "Luis Pérez");
  assert.equal(r[0].monto, 300);
  assert.match(r[0].motivo, /cita ya no estaba disponible/);
  assert.doesNotMatch(r[0].motivo, /⚠️/, "la marca se limpia del texto que ve recepción");
});

test("fase 2 — anticipo manual SIN anomalía (todo salió bien): NO aparece", async () => {
  reset();
  appointmentDepositRows = [
    {
      id: "dep3",
      clinicId: "c1",
      origin: "panel",
      method: "manual",
      status: "PAID",
      paymentId: "pay2",
      createdAt: new Date("2026-09-03T09:00:00Z"),
      patient: { firstName: "Marta", lastName: "Gómez" },
    },
  ];
  paymentRows = [{ id: "pay2", amount: 500, notes: "Efectivo en mostrador" }];
  const { anticiposPorRevisar } = await import("../avisos-recepcion.server");
  const r = await anticiposPorRevisar("c1");
  assert.deepEqual(r, []);
});
