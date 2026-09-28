// Ortodoncia — revisión cruzada de la Ola 1 (ver REPORTE-ws1-t1.md, "##
// Revisión cruzada"): con factura real abierta (Cobro, F2), el total/pagado
// del tratamiento tienen que venir de esa factura, no del precio tipeado al
// abrir el caso (`totalCostMxn`) ni del plan de pagos legacy
// (`paymentPlan.paidAmount`). Sin la factura resuelta (`realInvoiceTotal`
// sin pasar), el comportamiento de siempre no cambia — eso es justo lo que
// falla HOY (antes de este arreglo) si alguien asume que `totalCost` ya
// refleja la factura real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptToOrthoRedesignViewModel, type AdapterInput } from "../adapter";
import type { OrthoTabData } from "@/lib/orthodontics/load-data";

function legacyConPlan(overrides: Record<string, unknown> = {}): OrthoTabData {
  return {
    patientId: "pat_1",
    patientName: "Ana Pérez",
    isMinor: false,
    patientAge: 20,
    hasPediatricProfile: false,
    pediatricHabits: [],
    diagnosis: null,
    phases: [],
    monthInTreatment: 3,
    paymentPlan: { paidAmount: 5000 } as any,
    installments: [],
    photoSets: [],
    controls: [],
    digitalRecords: [],
    plan: {
      id: "plan_1",
      invoiceId: null,
      totalCostMxn: 33000,
      technique: "METAL_BRACKETS",
      prescriptionSlot: null,
      bondingType: null,
      prescriptionNotes: null,
      techniqueNotes: null,
      installedAt: null,
      startDate: null,
      estimatedDurationMonths: 24,
      status: "IN_PROGRESS",
      ...overrides,
    } as any,
  } as unknown as OrthoTabData;
}

function input(legacy: OrthoTabData, extra: Partial<AdapterInput> = {}): AdapterInput {
  return {
    legacy,
    attendancePct: 100,
    elasticsCompliancePct: 100,
    ...extra,
  };
}

test("sin invoiceId en el plan: el total sigue siendo totalCostMxn (comportamiento de siempre, sin cambios)", () => {
  const vm = adaptToOrthoRedesignViewModel(input(legacyConPlan({ invoiceId: null })));
  assert.equal(vm.treatment.totalCost, 33000);
  assert.equal(vm.treatment.paid, 5000);
});

test("EL CASO QUE FALLABA HOY: con invoiceId pero sin pasar la factura real, NO se inventa un número — se queda en totalCostMxn (nunca peor que antes)", () => {
  const vm = adaptToOrthoRedesignViewModel(
    input(legacyConPlan({ invoiceId: "inv_1" })), // realInvoiceTotal no se pasa
  );
  assert.equal(vm.treatment.totalCost, 33000, "sin la factura resuelta, cae al precio tipeado — no rompe nada mientras el loader no la resuelva");
});

test("con invoiceId Y factura real resuelta: el total/pagado son los de la factura, NO totalCostMxn/paymentPlan.paidAmount", () => {
  const vm = adaptToOrthoRedesignViewModel(
    input(legacyConPlan({ invoiceId: "inv_1" }), { realInvoiceTotal: 40000, realInvoicePaid: 12000 }),
  );
  assert.equal(vm.treatment.totalCost, 40000, "debe ganar el total de la factura real, no los $33,000 tipeados al abrir el caso");
  assert.equal(vm.treatment.paid, 12000, "debe ganar lo pagado de la factura real, no el paymentPlan legacy");
});

test("con invoiceId y realInvoiceTotal pero SIN realInvoicePaid: paid cae a 0, no al paymentPlan legacy (evita mezclar dos fuentes de dinero)", () => {
  const vm = adaptToOrthoRedesignViewModel(
    input(legacyConPlan({ invoiceId: "inv_1" }), { realInvoiceTotal: 40000 }),
  );
  assert.equal(vm.treatment.totalCost, 40000);
  assert.equal(vm.treatment.paid, 0);
});

test("sin plan (caso sin tratamiento todavía): total en 0, no revienta", () => {
  const legacy = legacyConPlan();
  (legacy as any).plan = null;
  (legacy as any).paymentPlan = null;
  const vm = adaptToOrthoRedesignViewModel(input(legacy));
  assert.equal(vm.treatment.totalCost, 0);
  assert.equal(vm.treatment.paid, 0);
});
