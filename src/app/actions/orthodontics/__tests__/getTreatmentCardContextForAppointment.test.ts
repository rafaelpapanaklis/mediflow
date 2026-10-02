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
let faseEnCurso: string | null = null;

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
      // ws1-t8 (revisión de ws1-t9, fallo 2): al abrir desde la cita se busca una hoja firmada de hoy sin cita
      // que ligar (ligar-hoja-firmada-db.ts); aquí no hay ninguna.
      orthoTreatmentCard: { findMany: async () => [], findFirst: async () => null },
      orthodonticPhase: { findFirst: async () => (faseEnCurso ? { phaseKey: faseEnCurso } : null) },
      orthoPhotoSet: { findMany: async () => [] },
      // Ronda 6 (ws1-t8): `buildTreatmentCardContext` ahora recibe el
      // timezone de la clínica (hallazgo 7, tarjetaDeControlDeHoy) — el
      // wrapper lo resuelve con esta consulta antes de delegar.
      clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
    },
  },
});

// El ligador de la hoja firmada sin cita invita a reseña al cerrar la cita (importa `server-only`).
mock.module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => undefined } });

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
  faseEnCurso = null;
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

test("ws1-t10: la hoja nueva lleva la fase EN CURSO y el mes real desde la colocación al día de la visita", async () => {
  reset();
  faseEnCurso = "LEVELING";
  plans.push({
    id: "plan-4",
    clinicId: "clinic-1",
    patientId: "patient-abierto",
    installedAt: new Date("2026-08-15T16:00:00Z"),
    startDate: null,
  });
  patients.push({ id: "patient-abierto", visibleUserIds: [] });
  appointments.push({
    id: "appt-4",
    clinicId: "clinic-1",
    patientId: "patient-abierto",
    startsAt: new Date("2026-09-29T16:00:00Z"),
    endsAt: new Date("2026-09-29T16:30:00Z"),
  });
  const { getTreatmentCardContextForAppointment } = await import("../getTreatmentCardContextForAppointment");
  const res = await getTreatmentCardContextForAppointment("appt-4", "plan-4");
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.defaultsForNew.phase, "LEVELING");
    assert.equal(res.data.defaultsForNew.monthAt, 1.5);
  }
});

test("ws1-t10: sin fase en curso ni hojas, la hoja nueva arranca en Alineación (la misma que muestra el cajón)", async () => {
  reset();
  plans.push({ id: "plan-5", clinicId: "clinic-1", patientId: "patient-abierto", installedAt: null, startDate: null });
  patients.push({ id: "patient-abierto", visibleUserIds: [] });
  appointments.push({
    id: "appt-5",
    clinicId: "clinic-1",
    patientId: "patient-abierto",
    startsAt: new Date("2026-09-29T16:00:00Z"),
    endsAt: new Date("2026-09-29T16:30:00Z"),
  });
  const { getTreatmentCardContextForAppointment } = await import("../getTreatmentCardContextForAppointment");
  const res = await getTreatmentCardContextForAppointment("appt-5", "plan-5");
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.defaultsForNew.phase, "ALIGNMENT");
    assert.equal(res.data.defaultsForNew.monthAt, 0);
  }
});
