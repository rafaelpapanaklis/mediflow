// H10 (QA ws1-t9): la ficha decía "Sin programar" aunque había un control
// de HOY ya creado desde la Agenda — porque `deriveNextAppointment` solo
// miraba `legacy.controls` (OrthodonticControlAppointment, una tabla aparte
// que llena un asistente del módulo de especialidad en pausa y que nadie
// usa hoy). El Tablero y Alertas sí veían la cita porque leen `Appointment`
// directo. Este test reproduce el caso: sin `nextRealAppointment`, sigue
// cayendo en `legacy.controls` (comportamiento de siempre); con él, gana.
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
    paymentPlan: null,
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

test("EL CASO QUE FALLABA HOY: cita de control creada en Agenda (Appointment), nada en OrthodonticControlAppointment: la ficha ya no dice «Sin programar»", () => {
  const startsAt = new Date("2026-09-28T15:00:00.000Z");
  const endsAt = new Date("2026-09-28T15:30:00.000Z");
  const vm = adaptToOrthoRedesignViewModel(
    input(legacyConPlan(), {
      // El loader resuelve `nextAppointmentDoctor`/`nextAppointmentChair`
      // a partir de `nextRealAppointment` antes de llamar al adapter (ver
      // loader.ts) — aquí se pasan ya resueltos, como haría el loader real.
      nextAppointmentDoctor: { firstName: "Mariana", lastName: "Cortés" },
      nextAppointmentChair: "Sillón 2",
      nextRealAppointment: {
        startsAt,
        endsAt,
        doctor: { firstName: "Mariana", lastName: "Cortés" },
        chair: "Sillón 2",
      },
    }),
  );
  assert.notEqual(vm.nextAppointment, null, "no debe quedar 'Sin programar' con una cita real futura");
  assert.equal(vm.nextAppointment?.date, startsAt.toISOString());
  assert.equal(vm.nextAppointment?.durationMin, 30);
  assert.equal(vm.nextAppointment?.doctor, "Dr/a. Mariana Cortés");
  assert.equal(vm.nextAppointment?.chair, "Sillón 2");
});

test("sin cita real: sigue cayendo a legacy.controls (comportamiento de siempre, sin cambios)", () => {
  const legacy = legacyConPlan();
  (legacy as any).controls = [
    { scheduledAt: new Date(Date.now() + 3600_000), attendance: "PENDING" },
  ];
  const vm = adaptToOrthoRedesignViewModel(input(legacy));
  assert.notEqual(vm.nextAppointment, null);
});

test("sin cita real y sin legacy.controls: 'Sin programar' (null), como antes", () => {
  const vm = adaptToOrthoRedesignViewModel(input(legacyConPlan()));
  assert.equal(vm.nextAppointment, null);
});
