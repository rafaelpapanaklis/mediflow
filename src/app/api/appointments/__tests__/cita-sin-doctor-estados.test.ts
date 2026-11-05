/**
 * Cita «Sin doctor» al cambiar de estado (ws1-t11 · fase 2 · P1, D3 y D9).
 *
 * Run: npm run test:cita-sin-doctor
 *
 * HANDLERS REALES de `PATCH /api/appointments/:id/status`, `POST …/check-in`
 * y `PATCH …/complete`, con Prisma de mentira:
 *  · llegar: «¿Quién lo atiende?» es opcional;
 *  · iniciar la consulta pide doctor (el DOCTOR que la inicia se la queda);
 *  · un DOCTOR puede tomar una «Sin doctor» (llegada, sillón, iniciar,
 *    terminar) pero no cancelarla ni marcar «no vino»; la de OTRO doctor, 403
 *    como siempre;
 *  · terminar una «Sin doctor» con su nota la deja a nombre del autor.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const DRA = "clx9doc0a000108l4aaaa0001";
const DR2 = "seed-doctor-2";

let existingRow: any;
let reclamos: any[];
let visibilidad: any[];
let movimientos: any[];
let auditorias: any[];
let nota: any;
let constraintChoca: boolean;

const session = {
  user: { id: "u-recep", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] as string[] },
  clinic: {
    id: "c1", name: "Centro Dental QA", category: "DENTAL", timezone: TZ, defaultSlotMinutes: 30,
    agendaDayStart: 0, agendaDayEnd: 24, schedules: [],
  },
  timeConfig: { timezone: TZ, slotMinutes: 30, dayStart: 0, dayEnd: 24 },
};

function hoyEn(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

beforeEach(() => {
  // Una cita de HOY (no se adelanta), sin doctor, confirmada.
  existingRow = {
    id: "a1", clinicId: "c1", patientId: "p1", doctorId: null, resourceId: null, status: "CONFIRMED",
    startsAt: hoyEn(-10), endsAt: hoyEn(20), startedAt: null, overrideReason: null, overriddenBy: null, overriddenAt: null,
    googleCalendarEventId: null, type: "Limpieza",
  };
  reclamos = [];
  visibilidad = [];
  movimientos = [];
  auditorias = [];
  nota = null;
  constraintChoca = false;
  session.user.id = "u-recep";
  session.user.role = "RECEPTIONIST";
});

function filaCompleta() {
  return {
    ...existingRow,
    patient: { id: "p1", firstName: "Ana", lastName: "García" },
    doctor: existingRow.doctorId ? { id: existingRow.doctorId, firstName: "Luis", lastName: "Ruiz" } : null,
  };
}

const tx = {
  appointment: {
    updateMany: async ({ where, data }: any) => {
      if (constraintChoca && data.doctorId) throw Object.assign(new Error("exclusion constraint"), { code: "23P01" });
      if (where.status !== existingRow.status) return { count: 0 };
      reclamos.push(data);
      existingRow = { ...existingRow, ...data };
      return { count: 1 };
    },
    findFirst: async () => filaCompleta(),
  },
  medicalRecord: { update: async () => ({}) },
};

const prismaStub: any = {
  appointment: {
    findFirst: async () => ({ ...existingRow }),
    findMany: async () => [],
  },
  user: {
    findFirst: async ({ where }: any) => {
      if (where.id === null || where.id === undefined) throw new Error("PrismaClientValidationError: id null");
      return where.id === DRA || where.id === DR2 ? { id: where.id } : null;
    },
  },
  medicalRecord: { findFirst: async () => nota },
  clinic: { findUnique: async () => ({ locale: "es" }) },
  clinicFeatureFlag: { findMany: async () => [] },
  appointmentTimeline: { findUnique: async () => null, upsert: async () => ({}) },
  $transaction: async (fn: any) => fn(tx),
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: (s: any, roles: string[]) => (roles.includes(s.user.role) ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })) },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/agenda/server", {
  namedExports: { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, doctorId: a.doctorId }) },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async () => null,
    ensureUserCanSeePatient: async (...args: unknown[]) => { visibilidad.push(args); },
    canSeePatient: () => true,
  },
});
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined } });
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { cancelPendingRemindersForAppointment: async () => undefined, applyReminderReschedule: async () => undefined },
});
(mock as any).module("@/lib/whatsapp/avisos-cita", { namedExports: { avisarCitaPorWhatsApp: async () => null } });
(mock as any).module("@/lib/anticipos/cita-cancelada.server", {
  namedExports: { decidirDineroDeCitaCancelada: async () => ({ ok: true }), dineroDeLaCita: async () => null },
});
(mock as any).module("@/lib/movimientos-paciente/registrar", {
  namedExports: { registrarMovimientoDelPaciente: async (a: any) => { movimientos.push(a); } },
});
(mock as any).module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => TZ } });
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => undefined } });
(mock as any).module("@/lib/walk-in/cerrar-fila-de-la-cita", { namedExports: { cerrarFilaDeLaCita: async () => undefined } });
(mock as any).module("@/lib/agenda/agenda-flexible.server", {
  namedExports: { leerAgendaFlexibleConFallo: async () => ({ ajustes: { encendida: false }, fallo: false }), leerAgendaFlexible: async () => ({ encendida: false }) },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (a: any) => { auditorias.push(a); } } });
(mock as any).module("@/lib/odontogram/snapshot", {
  namedExports: {
    changesToTreatments: async () => [], createOrUpdateSnapshot: async () => ({ id: "s1" }), diffSnapshots: () => [],
    ensureDentalCatalog: async () => undefined, findPreviousSnapshot: async () => null, readCurrentEntries: async () => [],
  },
});

function req(body: unknown): any {
  return { json: async () => body, headers: new Headers(), nextUrl: new URL("http://localhost/x"), url: "http://localhost/x" };
}
async function estado(body: unknown) {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const res = await PATCH(req(body), { params: Promise.resolve({ id: "a1" }) });
  return { status: res.status, body: await res.json() };
}
async function llegada(body: unknown) {
  const { POST } = await import("@/app/api/appointments/[id]/check-in/route");
  const res = await POST(req(body), { params: Promise.resolve({ id: "a1" }) });
  return { status: res.status, body: await res.json() };
}
async function terminar(body: unknown = {}) {
  const { PATCH } = await import("@/app/api/appointments/[id]/complete/route");
  const res = await PATCH(req(body), { params: Promise.resolve({ id: "a1" }) });
  return { status: res.status, body: await res.json() };
}

// ═══════════════ iniciar la consulta (D9) ═══════════════

test("iniciar · un ADMIN no inicia una «Sin doctor» sin decir quién atiende (409 con el texto)", async () => {
  session.user.role = "ADMIN";
  session.user.id = "u-admin";
  existingRow.status = "CHECKED_IN";
  const r = await estado({ status: "IN_PROGRESS" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "doctor_required_to_start");
  assert.match(r.body.reason, /quién atiende/);
  assert.equal(reclamos.length, 0);
});

test("iniciar · recepción (su rol no inicia consultas) recibe el 403 de siempre, no «elige doctor»", async () => {
  existingRow.status = "CHECKED_IN";
  const r = await estado({ status: "IN_PROGRESS" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "forbidden");
});

test("iniciar · un ADMIN eligiendo al doctor: se asigna en el mismo cambio, con su visibilidad y su movimiento", async () => {
  session.user.role = "ADMIN";
  session.user.id = "u-admin";
  existingRow.status = "CHECKED_IN";
  const r = await estado({ status: "IN_PROGRESS", doctorId: DRA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, DRA);
  assert.equal(reclamos[0].status, "IN_PROGRESS");
  assert.equal(visibilidad.length, 1);
  assert.deepEqual(movimientos.at(-1).cambios.doctorId, { before: null, after: DRA });
});

test("llegada/iniciar · quien no es DOCTOR no se puede asignar a sí mismo si no recibe citas (recepción, admin que no atiende)", async () => {
  existingRow.status = "CHECKED_IN";
  session.user.role = "ADMIN";
  session.user.id = "u-admin";
  let r = await estado({ status: "IN_PROGRESS", doctorId: "u-admin" });
  assert.equal(r.status, 404);
  existingRow.status = "CONFIRMED";
  session.user.role = "RECEPTIONIST";
  session.user.id = "u-recep";
  r = await llegada({ doctorId: "u-recep" });
  assert.equal(r.status, 404);
  assert.equal(reclamos.length, 0);
});

test("iniciar · el elegido tiene que poder recibir citas", async () => {
  session.user.role = "ADMIN";
  existingRow.status = "CHECKED_IN";
  const r = await estado({ status: "IN_PROGRESS", doctorId: "otro-que-no-atiende" });
  assert.equal(r.status, 404);
  assert.equal(reclamos.length, 0);
});

test("iniciar · el doctor elegido ya tiene otra cita a esa hora → 409 claro (no 500)", async () => {
  session.user.role = "ADMIN";
  existingRow.status = "CHECKED_IN";
  constraintChoca = true;
  const r = await estado({ status: "IN_PROGRESS", doctorId: DRA });
  assert.equal(r.status, 409);
  assert.match(r.body.reason, /ya tiene otra cita/);
});

test("iniciar · un DOCTOR que inicia una «Sin doctor» se la queda", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  existingRow.status = "CHECKED_IN";
  const r = await estado({ status: "IN_PROGRESS" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, DRA);
});

test("iniciar · una cita CON doctor se inicia como siempre (no se reasigna por aquí)", async () => {
  session.user.role = "ADMIN";
  existingRow.status = "CHECKED_IN";
  existingRow.doctorId = DR2;
  const r = await estado({ status: "IN_PROGRESS", doctorId: DRA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, undefined);
});

// ═══════════════ el DOCTOR y las «Sin doctor» (D3) ═══════════════

test("DOCTOR · inicia directo desde «confirmada» una «Sin doctor» y se la queda", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  const r = await estado({ status: "IN_PROGRESS" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, DRA);
});

test("DOCTOR · no cancela ni marca «no vino» una «Sin doctor» (no es suya)", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  for (const s of ["CANCELLED", "NO_SHOW"]) {
    const r = await estado({ status: s });
    assert.equal(r.status, 403, s);
  }
  assert.equal(reclamos.length, 0);
});

test("DOCTOR · no se la puede dar a OTRO doctor", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  existingRow.status = "CHECKED_IN";
  const r = await estado({ status: "IN_PROGRESS", doctorId: DR2 });
  assert.equal(r.status, 403);
});

test("DOCTOR · la cita de OTRO doctor sigue siendo 403", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  existingRow.doctorId = DR2;
  const r = await estado({ status: "IN_PROGRESS" });
  assert.equal(r.status, 403);
});

// ═══════════════ llegada («¿Quién lo atiende?», opcional) ═══════════════

test("llegada · sin cuerpo, la de siempre (sigue «Sin doctor»)", async () => {
  const r = await llegada(undefined);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].status, "CHECKED_IN");
  assert.equal(reclamos[0].doctorId, undefined);
  assert.equal(r.body.doctorId, null);
});

test("llegada · con «¿Quién lo atiende?» se asigna al llegar", async () => {
  const r = await llegada({ doctorId: DRA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, DRA);
  assert.equal(visibilidad.length, 1);
  assert.equal(r.body.doctorId, DRA);
});

// ═══════════════ terminar ═══════════════

test("terminar · un DOCTOR que cierra una «Sin doctor» se la queda", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  existingRow.status = "IN_PROGRESS";
  const r = await terminar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, DRA);
});

test("terminar · un ADMIN que cierra una «Sin doctor» con nota la deja a nombre del autor de la nota", async () => {
  session.user.role = "ADMIN";
  session.user.id = "u-admin";
  existingRow.status = "IN_PROGRESS";
  nota = { id: "n1", doctorId: DR2, specialtyData: { status: "SIGNED" }, subjective: "x", objective: "x", assessment: "x", plan: "x" };
  const r = await terminar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, DR2);
  assert.deepEqual(visibilidad[0]?.slice(1), ["p1", DR2, "c1"], "el autor que queda como doctor puede ver al paciente");
});

test("terminar · sin nota y sin DOCTOR, se cierra «Sin doctor» (D9)", async () => {
  session.user.role = "ADMIN";
  session.user.id = "u-admin";
  existingRow.status = "IN_PROGRESS";
  const r = await terminar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reclamos[0].doctorId, undefined);
});
