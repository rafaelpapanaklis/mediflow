/**
 * Aprobar el reagendado de una cita «Sin doctor» exige que SIGA sin doctor
 * (ws1-t10 v2 · m4 de la revisión de t12).
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * Los bloqueos, la comida y los choques se miran con el doctor leído al
 * principio. Si alguien le asigna doctor a la «Sin doctor» mientras recepción
 * aprueba, la cita caería en la comida o el bloqueo del doctor nuevo sin aviso:
 * el movimiento se condiciona a `doctorId: null` y, si ya tiene doctor, 409 y
 * la solicitud sigue pendiente. Con doctor, la consulta es la de siempre.
 *
 * HANDLER REAL con dobles; sin base ni red. Ids de siembra y de Dentalink.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const CL = "seed-clinica-salamanca";
const CITA = "dentalink-cita-48213";
const DOC = "clx9doc0a000108l4aaaa0001";

let filaEnBase: any; // la cita como está AHORA en la base
let leidaAlPrincipio: any; // la cita como la leyó el handler al principio
let movimientos: any[];
let reagendados: any[];

beforeEach(() => {
  const base = {
    id: CITA, clinicId: CL, patientId: "p1", doctorId: null, resourceId: null, status: "SCHEDULED",
    overrideReason: null, holdExpiresAt: null, type: "Limpieza",
    startsAt: new Date("2031-03-11T16:00:00Z"), endsAt: new Date("2031-03-11T16:30:00Z"),
  };
  filaEnBase = { ...base };
  leidaAlPrincipio = { ...base };
  movimientos = [];
  reagendados = [];
});

const session = {
  user: { id: "u-recep", role: "RECEPTIONIST", clinicId: CL, displayName: "Recepción", permissionsOverride: [] as string[] },
  clinic: { id: CL, name: "Centro Dental Salamanca QA", timezone: TZ },
};

const prismaStub: any = {
  appointmentChangeRequest: {
    findFirst: async () => ({
      id: "cr1", clinicId: CL, patientId: "p1", type: "RESCHEDULE", status: "PENDING",
      proposedStartsAt: new Date("2031-03-11T18:00:00Z"), proposedEndsAt: new Date("2031-03-11T18:30:00Z"),
      appointment: { ...leidaAlPrincipio }, patient: { id: "p1", firstName: "Ana", lastName: "García" },
    }),
    updateMany: async () => ({ count: 1 }),
  },
  appointment: {
    findFirst: async ({ where }: any) => {
      // El re-check de choques: no hay otra cita a esa hora.
      if (where.OR || where.startsAt) return null;
      return where.id === filaEnBase.id && where.clinicId === filaEnBase.clinicId ? { ...filaEnBase } : null;
    },
    findMany: async () => [],
    updateMany: async ({ where, data }: any) => {
      movimientos.push({ where, data });
      const casa =
        where.id === filaEnBase.id &&
        where.clinicId === filaEnBase.clinicId &&
        !where.status?.notIn?.includes(filaEnBase.status) &&
        (!("doctorId" in where) || where.doctorId === filaEnBase.doctorId);
      return { count: casa ? 1 : 0 };
    },
  },
  agendaBlock: { findMany: async () => [] },
  doctorSchedule: { findMany: async () => [] },
  clinicFeatureFlag: { findMany: async () => [] },
  $queryRaw: async () => [],
  $transaction: async (fn: any) => fn(prismaStub),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
mock.module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null, isOverlapError: () => false },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
mock.module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
mock.module("@/lib/reminders/reschedule.server", {
  namedExports: {
    applyReminderReschedule: async (_tx: unknown, a: unknown) => { reagendados.push(a); return { cancelled: 0, created: 0 }; },
    cancelPendingRemindersForAppointment: async () => 0,
  },
});
mock.module("@/lib/appointment-change/notify", { namedExports: { notifyPatientChangeResolution: async () => undefined } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/agenda-bloqueos/politica.server", { namedExports: { rechazoPorBloqueo: async () => null } });
mock.module("@/lib/agenda/sobreagendar.server", { namedExports: { quitarMarcaDeSobreagenda: async () => undefined } });
mock.module("@/lib/anticipos/cita-cancelada.server", { namedExports: { marcarPendienteSiHayDinero: async () => undefined } });
mock.module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => TZ } });

async function aprobar() {
  const { POST } = await import("@/app/api/appointment-change-requests/[id]/resolve/route");
  const req: any = { json: async () => ({ action: "APPROVE" }), headers: new Headers(), url: "http://localhost/x", nextUrl: new URL("http://localhost/x") };
  const res = await POST(req, { params: Promise.resolve({ id: "cr1" }) });
  return { status: res.status, body: await res.json() };
}

test("🔴 aprobar el reagendado de una «Sin doctor» exige que siga sin doctor (doctorId: null en el movimiento)", async () => {
  const r = await aprobar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(movimientos.length, 1);
  assert.equal(movimientos[0].where.doctorId, null);
  assert.ok("doctorId" in movimientos[0].where, "la condición va explícita: `doctorId: null` = IS NULL");
  assert.equal(reagendados.length, 1);
});

test("🔴 si le asignaron doctor mientras se aprobaba: 409 claro, la cita no se mueve ni se re-encola", async () => {
  filaEnBase.doctorId = DOC; // otra persona se la asignó entre la lectura y la transacción
  const r = await aprobar();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "appointment_doctor_changed");
  assert.match(r.body.reason, /se le asignó un doctor/);
  assert.equal(reagendados.length, 0);
});

test("una «Sin doctor» que se canceló entretanto sigue diciendo «ya no está activa»", async () => {
  filaEnBase.status = "CANCELLED";
  const r = await aprobar();
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "appointment_not_active");
});

test("con doctor, el movimiento es el de siempre (sin condición de doctor)", async () => {
  leidaAlPrincipio.doctorId = DOC;
  filaEnBase.doctorId = DOC;
  const r = await aprobar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal("doctorId" in movimientos[0].where, false);
});
