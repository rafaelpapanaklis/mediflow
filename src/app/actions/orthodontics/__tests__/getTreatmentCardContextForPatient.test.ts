/**
 * Ortodoncia — Control y agenda, Ronda 6 (ws1-t8, «El día de la
 * ortodoncista»). M6/hallazgo 6: "Registrar control" desde la ficha
 * resuelve la cita de control de HOY del paciente (si la hay) — antes
 * abría siempre en blanco, sin ligar nada a la cita del día.
 *
 * Necesita --experimental-test-module-mocks (mock.module sustituye
 * "@/lib/prisma" y "./../_helpers").
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/app/actions/orthodontics/__tests__/getTreatmentCardContextForPatient.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

interface PlanRow {
  id: string;
  clinicId: string;
  patientId: string;
  installedAt: Date | null;
  startDate: Date | null;
}
interface AppointmentRow {
  id: string;
  clinicId: string;
  patientId: string;
  type: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  doctorId?: string | null;
}

let plans: PlanRow[] = [];
let appointments: AppointmentRow[] = [];
let ctx = { userId: "user-1", role: "DOCTOR", clinicId: "clinic-1" };

// Hoy en México (UTC-6, sin horario de verano) — el mismo día de calendario
// que hoyEnZona/calendarDayRangeUtc resolverían para "America/Mexico_City".
const AHORA = new Date();
const HOY_10AM_UTC = new Date(
  Date.UTC(AHORA.getUTCFullYear(), AHORA.getUTCMonth(), AHORA.getUTCDate(), 16, 0, 0),
);

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findFirst: async ({ where }: { where: { id: string; clinicId: string } }) =>
          plans.find((p) => p.id === where.id && p.clinicId === where.clinicId) ?? null,
      },
      clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
      appointment: {
        // Revisión final de ws1-t9 (fallo nuevo 2): la acción trae TODAS las citas de hoy y elige con
        // citaParaLigarLaHoja (la de la dirección, o la primera de control que la sesión puede mover).
        findMany: async ({
          where,
        }: {
          where: { clinicId: string; patientId: string; status: { notIn: string[] }; startsAt: { gte: Date; lt: Date } };
        }) =>
          appointments
            .filter(
              (a) =>
                a.clinicId === where.clinicId &&
                a.patientId === where.patientId &&
                !where.status.notIn.includes(a.status) &&
                a.startsAt >= where.startsAt.gte &&
                a.startsAt < where.startsAt.lt,
            )
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
        findFirst: async ({
          where,
        }: {
          where: {
            clinicId: string;
            patientId: string;
            status: { notIn: string[] };
            startsAt: { gte: Date; lt: Date };
          };
        }) => {
          const matches = appointments
            .filter(
              (a) =>
                a.clinicId === where.clinicId &&
                a.patientId === where.patientId &&
                !where.status.notIn.includes(a.status) &&
                a.startsAt >= where.startsAt.gte &&
                a.startsAt < where.startsAt.lt,
            )
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
          return matches[0] ?? null;
        },
      },
      orthoWireStep: { findMany: async () => [] },
      orthoTreatmentCard: { findMany: async () => [] },
      orthodonticPhase: { findFirst: async () => null },
      orthoPhotoSet: { findMany: async () => [] },
    },
  },
});

mock.module("../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ({ ok: true, data: { ctx } }),
    loadPatientForOrtho: async ({ patientId }: { patientId: string }) => ({
      ok: true,
      data: { id: patientId },
    }),
  },
});

function reset() {
  plans = [];
  appointments = [];
  ctx = { userId: "user-1", role: "DOCTOR", clinicId: "clinic-1" };
}

test("con una cita de control de HOY, el contexto queda ligado a ella", async () => {
  reset();
  plans.push({ id: "plan-1", clinicId: "clinic-1", patientId: "p-1", installedAt: null, startDate: null });
  appointments.push({
    id: "appt-hoy",
    clinicId: "clinic-1",
    patientId: "p-1",
    type: TIPO_CITA_CONTROL_ORTO,
    status: "SCHEDULED",
    doctorId: "user-1", // la sesión es DOCTOR: solo se liga a SUS citas
    startsAt: HOY_10AM_UTC,
    endsAt: new Date(HOY_10AM_UTC.getTime() + 30 * 60000),
  });
  const { getTreatmentCardContextForPatient } = await import("../getTreatmentCardContextForPatient");
  const res = await getTreatmentCardContextForPatient("plan-1");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.appointmentId, "appt-hoy");
});

test("sin ninguna cita de control hoy, se abre igual pero sin cita ligada", async () => {
  reset();
  plans.push({ id: "plan-2", clinicId: "clinic-1", patientId: "p-2", installedAt: null, startDate: null });
  const { getTreatmentCardContextForPatient } = await import("../getTreatmentCardContextForPatient");
  const res = await getTreatmentCardContextForPatient("plan-2");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.appointmentId, null);
});

test("una cita de HOY que no es de control se ignora (no se finge una que no es)", async () => {
  reset();
  plans.push({ id: "plan-3", clinicId: "clinic-1", patientId: "p-3", installedAt: null, startDate: null });
  appointments.push({
    id: "appt-otra",
    clinicId: "clinic-1",
    patientId: "p-3",
    type: "Urgencia de ortodoncia",
    status: "SCHEDULED",
    startsAt: HOY_10AM_UTC,
    endsAt: new Date(HOY_10AM_UTC.getTime() + 30 * 60000),
  });
  const { getTreatmentCardContextForPatient } = await import("../getTreatmentCardContextForPatient");
  const res = await getTreatmentCardContextForPatient("plan-3");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.appointmentId, null);
});
