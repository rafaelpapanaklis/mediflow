/**
 * Ortodoncia — Control y agenda (ws1-t4). Revisión cruzada de ws1-t1:
 * `getTreatmentCardContextForAppointment` no comprobaba visibilidad de
 * paciente. Este test cubre el caso que fallaba antes del arreglo: un
 * usuario SIN acceso a un paciente restringido (`visibleUserIds` no lo
 * incluye) ya no puede leer su plan/wires/foto-sets con solo conocer el
 * treatmentPlanId y el appointmentId.
 *
 * Necesita --experimental-test-module-mocks (mock.module sustituye
 * "@/lib/prisma" y "./../_helpers"). `canSeePatient` corre REAL (no se
 * mockea) — mismo patrón que imagen/__tests__/_context.test.ts: se prueba
 * la integración de verdad, no solo que se llamó a algo.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/app/actions/orthodontics/__tests__/getTreatmentCardContextForAppointment.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { canSeePatient } from "@/lib/patient-visibility";

interface PlanRow {
  id: string;
  clinicId: string;
  patientId: string;
  installedAt: Date | null;
  startDate: Date | null;
}
interface PatientRow {
  id: string;
  visibleUserIds: string[] | null;
}
interface AppointmentRow {
  id: string;
  clinicId: string;
  patientId: string;
  startsAt: Date;
  endsAt: Date;
}

let plans: PlanRow[] = [];
let patients: PatientRow[] = [];
let appointments: AppointmentRow[] = [];
let ctx = { userId: "user-1", role: "DOCTOR", clinicId: "clinic-1" };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findFirst: async ({ where }: { where: { id: string; clinicId: string } }) => {
          const p = plans.find((row) => row.id === where.id && row.clinicId === where.clinicId);
          return p ?? null;
        },
      },
      appointment: {
        findFirst: async ({
          where,
        }: {
          where: { id: string; clinicId: string; patientId: string };
        }) => {
          const a = appointments.find(
            (row) =>
              row.id === where.id &&
              row.clinicId === where.clinicId &&
              row.patientId === where.patientId,
          );
          return a ?? null;
        },
      },
      orthoWireStep: { findMany: async () => [] },
      orthoTreatmentCard: { findMany: async () => [] },
      orthodonticPhase: { findFirst: async () => null },
      orthoPhotoSet: { findMany: async () => [] },
    },
  },
});

// `loadPatientForOrtho` real vive en `_helpers.ts`, que importa
// `getAuthContext` (→ next/headers, rompe fuera de un request de Next). Se
// mockea el módulo entero, pero `loadPatientForOrtho` se reimplementa igual
// que el original: mismo criterio (clinicId + canSeePatient REAL), sobre los
// datos de este test — así se prueba la integración de verdad.
mock.module("../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ({ ok: true, data: { ctx } }),
    loadPatientForOrtho: async ({ patientId }: { patientId: string }) => {
      const p = patients.find((row) => row.id === patientId);
      if (!p) return { ok: false, error: "Paciente no encontrado" };
      if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, p.visibleUserIds)) {
        return { ok: false, error: "Paciente no encontrado" };
      }
      return { ok: true, data: { id: p.id } };
    },
  },
});

function reset() {
  plans = [];
  patients = [];
  appointments = [];
  ctx = { userId: "doctor-sin-acceso", role: "DOCTOR", clinicId: "clinic-1" };
}

test("doctor SIN acceso (excluido de visibleUserIds) no puede leer el contexto de la hoja", async () => {
  reset();
  plans.push({
    id: "plan-1",
    clinicId: "clinic-1",
    patientId: "patient-privado",
    installedAt: null,
    startDate: null,
  });
  patients.push({ id: "patient-privado", visibleUserIds: ["doctor-con-acceso"] });
  const { getTreatmentCardContextForAppointment } = await import(
    "../getTreatmentCardContextForAppointment"
  );
  const res = await getTreatmentCardContextForAppointment("appt-1", "plan-1");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, "Paciente no encontrado");
});

test("doctor CON acceso (sí está en visibleUserIds) puede leer el contexto", async () => {
  reset();
  plans.push({
    id: "plan-2",
    clinicId: "clinic-1",
    patientId: "patient-privado",
    installedAt: null,
    startDate: null,
  });
  patients.push({ id: "patient-privado", visibleUserIds: ["doctor-sin-acceso"] });
  appointments.push({
    id: "appt-2",
    clinicId: "clinic-1",
    patientId: "patient-privado",
    startsAt: new Date("2026-10-01T10:00:00Z"),
    endsAt: new Date("2026-10-01T10:30:00Z"),
  });
  const { getTreatmentCardContextForAppointment } = await import(
    "../getTreatmentCardContextForAppointment"
  );
  const res = await getTreatmentCardContextForAppointment("appt-2", "plan-2");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.patientId, "patient-privado");
});

test("paciente sin restricción (visibleUserIds vacío) es visible para cualquiera — default histórico", async () => {
  reset();
  plans.push({
    id: "plan-3",
    clinicId: "clinic-1",
    patientId: "patient-abierto",
    installedAt: null,
    startDate: null,
  });
  patients.push({ id: "patient-abierto", visibleUserIds: [] });
  appointments.push({
    id: "appt-3",
    clinicId: "clinic-1",
    patientId: "patient-abierto",
    startsAt: new Date("2026-10-01T10:00:00Z"),
    endsAt: new Date("2026-10-01T10:30:00Z"),
  });
  const { getTreatmentCardContextForAppointment } = await import(
    "../getTreatmentCardContextForAppointment"
  );
  const res = await getTreatmentCardContextForAppointment("appt-3", "plan-3");
  assert.equal(res.ok, true);
});
