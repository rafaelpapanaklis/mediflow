// Orthodontics — pruebas de los KPIs y alertas del Tablero (T1-T7, L1-L5,
// ws1-t2, Ola 1). Puras: sin Prisma, sin DATABASE_URL.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeActiveCasesCount,
  computeMonthlyProjection,
  computeOverdueBalances,
  computePlacementsAndRemovals,
  computeProductionByDoctor,
  computeValoracionesSummary,
  listFinishingSoon,
  listMissingNextControl,
  listOverduePatients,
  listPastDue,
  type OrthoCaseSummary,
} from "../specialty-kpis";
import type { CobranzaDelCaso } from "../cobranza-caso";

function cobranza(overrides: Partial<CobranzaDelCaso> = {}): CobranzaDelCaso {
  return {
    cuotaDeHoy: null,
    pagadas: [],
    vencidas: [],
    proximas: [],
    saldoTotal: 0,
    saldoAFavor: 0,
    proximoVencimiento: null,
    ...overrides,
  };
}

function caso(overrides: Partial<OrthoCaseSummary> = {}): OrthoCaseSummary {
  return {
    planId: "plan1",
    patientId: "p1",
    patientName: "Paciente Uno",
    treatingDoctorId: "d1",
    treatingDoctorName: "Dra. Uno",
    status: "IN_PROGRESS",
    installedAt: new Date("2025-01-01T00:00:00Z"),
    estimatedDurationMonths: 18,
    droppedOutAt: null,
    statusUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    cobranza: null,
    ...overrides,
  };
}

describe("computeActiveCasesCount (T1)", () => {
  it("cuenta solo los estados en tratamiento", () => {
    const cases = [
      caso({ status: "PLANNED" }),
      caso({ status: "IN_PROGRESS" }),
      caso({ status: "ON_HOLD" }),
      caso({ status: "RETENTION" }),
      caso({ status: "COMPLETED" }),
      caso({ status: "DROPPED_OUT" }),
    ];
    assert.equal(computeActiveCasesCount(cases), 4);
  });
});

describe("computeOverdueBalances / listOverduePatients (T3 / L1)", () => {
  it("suma lo que falta de las cuotas vencidas, ignora casos sin factura", () => {
    const cases = [
      caso({
        patientId: "p1",
        cobranza: cobranza({
          vencidas: [
            { numero: 1, esEnganche: false, importe: 1000, vencimiento: "2026-01-01", abonado: 0, falta: 1000, estado: "vencida" },
          ],
        }),
      }),
      caso({
        patientId: "p2",
        cobranza: cobranza({
          vencidas: [
            { numero: 2, esEnganche: false, importe: 500, vencimiento: "2026-02-01", abonado: 200, falta: 300, estado: "vencida" },
          ],
        }),
      }),
      caso({ patientId: "p3", cobranza: null }), // sin factura — no cuenta
      caso({ patientId: "p4", cobranza: cobranza() }), // al día — no cuenta
    ];
    const summary = computeOverdueBalances(cases);
    assert.equal(summary.count, 2);
    assert.equal(summary.amountMxn, 1300);

    const list = listOverduePatients(cases);
    assert.equal(list.length, 2);
    assert.equal(list[0]?.amountMxn, 1000); // p1 primero: 1000 > 300, ordenado por monto desc
    assert.equal(list[1]?.amountMxn, 300);
  });
});

describe("listFinishingSoon / listPastDue (L4 / L5)", () => {
  const ahora = new Date("2026-06-01T12:00:00Z");

  it("finishingSoon: IN_PROGRESS con 0 o 1 mes restante", () => {
    const cases = [
      caso({ installedAt: new Date("2025-01-01T00:00:00Z"), estimatedDurationMonths: 17 }), // 17 meses transcurridos, quedan 0
      caso({ installedAt: new Date("2024-01-01T00:00:00Z"), estimatedDurationMonths: 18 }), // 29 meses transcurridos, ya pasado (no cuenta aquí)
      caso({ status: "RETENTION", installedAt: new Date("2025-01-01T00:00:00Z"), estimatedDurationMonths: 17 }), // no IN_PROGRESS
    ];
    const soon = listFinishingSoon(cases, ahora);
    assert.equal(soon.length, 1);
  });

  it("pastDue: ya rebasó la duración estimada", () => {
    const cases = [
      caso({ installedAt: new Date("2024-01-01T00:00:00Z"), estimatedDurationMonths: 12 }), // muy pasado
      caso({ installedAt: new Date("2026-05-01T00:00:00Z"), estimatedDurationMonths: 18 }), // recién empezado
    ];
    const pastDue = listPastDue(cases, ahora);
    assert.equal(pastDue.length, 1);
    assert.ok(pastDue[0]!.remainingMonths < 0);
  });
});

describe("computeMonthlyProjection (T6)", () => {
  it("agrupa las cuotas próximas por mes", () => {
    const ahora = new Date("2026-01-15T00:00:00Z");
    const cases = [
      caso({
        cobranza: cobranza({
          proximas: [
            { numero: 1, esEnganche: false, importe: 1000, vencimiento: "2026-02-10", abonado: 0, falta: 1000, estado: "porVencer" },
            { numero: 2, esEnganche: false, importe: 1000, vencimiento: "2026-03-10", abonado: 0, falta: 1000, estado: "porVencer" },
          ],
        }),
      }),
      caso({
        cobranza: cobranza({
          proximas: [
            { numero: 1, esEnganche: false, importe: 500, vencimiento: "2026-02-15", abonado: 0, falta: 500, estado: "porVencer" },
          ],
        }),
      }),
    ];
    const projection = computeMonthlyProjection(cases, ahora, 3);
    assert.equal(projection.length, 3);
    assert.equal(projection[0]?.monthKey, "2026-01");
    assert.equal(projection[0]?.amountMxn, 0);
    assert.equal(projection[1]?.monthKey, "2026-02");
    assert.equal(projection[1]?.amountMxn, 1500);
    assert.equal(projection[2]?.monthKey, "2026-03");
    assert.equal(projection[2]?.amountMxn, 1000);
  });
});

describe("computePlacementsAndRemovals (T7)", () => {
  it("cuenta colocaciones por installedAt y retiros por status este mes", () => {
    const ahora = new Date("2026-06-15T00:00:00Z");
    const cases = [
      caso({ installedAt: new Date("2026-06-01T00:00:00Z") }), // colocación este mes
      caso({ installedAt: new Date("2026-05-01T00:00:00Z") }), // mes pasado, no cuenta
      caso({ status: "RETENTION", statusUpdatedAt: new Date("2026-06-10T00:00:00Z"), installedAt: new Date("2025-01-01T00:00:00Z") }), // retiro este mes
      caso({ status: "COMPLETED", statusUpdatedAt: new Date("2026-01-01T00:00:00Z"), installedAt: new Date("2024-01-01T00:00:00Z") }), // completado, no este mes
    ];
    const result = computePlacementsAndRemovals(cases, ahora);
    assert.equal(result.placements, 1);
    assert.equal(result.removals, 1);
  });
});

describe("computeProductionByDoctor (T4)", () => {
  it("agrupa por doctor y ordena de mayor a menor", () => {
    const payments = [
      { doctorId: "d1", doctorName: "Dra. Uno", amountMxn: 1000 },
      { doctorId: "d1", doctorName: "Dra. Uno", amountMxn: 500 },
      { doctorId: "d2", doctorName: "Dr. Dos", amountMxn: 2000 },
    ];
    const result = computeProductionByDoctor(payments);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.doctorId, "d2");
    assert.equal(result[0]?.amountMxn, 2000);
    assert.equal(result[1]?.amountMxn, 1500);
  });
});

describe("computeValoracionesSummary (T5)", () => {
  it("cuenta aceptadas y pendientes por llamar", () => {
    const quotes = [
      { status: "ACCEPTED", acceptedAt: new Date(), rejectedAt: null },
      { status: "PRESENTED", acceptedAt: null, rejectedAt: null },
      { status: "PRESENTED", acceptedAt: null, rejectedAt: null },
      { status: "REJECTED", acceptedAt: null, rejectedAt: new Date() },
      { status: "DRAFT", acceptedAt: null, rejectedAt: null },
    ];
    const result = computeValoracionesSummary(quotes);
    assert.equal(result.total, 5);
    assert.equal(result.aceptadas, 1);
    assert.equal(result.pendientes, 2);
  });
});

describe("listMissingNextControl (L2)", () => {
  it("lista casos activos sin cita de control futura, sin duplicar por paciente", () => {
    const cases = [
      caso({ patientId: "p1", status: "IN_PROGRESS" }),
      caso({ patientId: "p2", status: "IN_PROGRESS" }),
      caso({ patientId: "p3", status: "COMPLETED" }), // no activo, no cuenta
    ];
    const withFuture = new Set(["p2"]);
    const missing = listMissingNextControl(cases, withFuture);
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.patientId, "p1");
  });
});
