/**
 * ENVÍOS DUPLICADOS POR CARRERAS — ws1-t10, M11 de la auditoría de seguridad
 * del 30-sep-2026.
 *
 * Run: npm run test:envios-duplicados
 *
 * El fallo: un doble clic, un reintento de red o dos recepcionistas a la vez
 * leían la fila «pendiente» los dos, actualizaban los dos (`update` sin
 * condición) y avisaban al paciente los dos. Aquí se lanzan DOS peticiones
 * simultáneas contra los handlers reales y se cuenta cuántos avisos salen.
 *
 * El doble de Prisma es una base en memoria con la semántica que importa:
 * `updateMany` evalúa su `where` contra la fila ACTUAL y devuelve cuántas
 * cambió (como Postgres con el candado de fila); `update` es incondicional.
 * Las lecturas devuelven una copia y ceden el turno (`setImmediate`), para que
 * la segunda petición lea antes de que la primera escriba: la carrera real.
 *
 * ⛔ No sale nada a nadie: el emisor de avisos es un doble que solo apunta.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Base en memoria ─────────────────────────────────────────────────────────
type Row = Record<string, any>;
const tick = () => new Promise<void>((r) => setImmediate(r));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "AND") return true; // los candados de hueco no importan aquí
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(actual);
      if ("notIn" in v) return !(v.notIn as any[]).includes(actual);
      if ("not" in v) return actual !== v.not;
      return true; // rangos y otros: la prueba no los usa
    }
    if (v instanceof Date) return actual instanceof Date && actual.getTime() === v.getTime();
    return actual === v;
  });
}

function tabla(rows: Map<string, Row>) {
  return {
    findFirst: async ({ where }: any = {}) => {
      const r = [...rows.values()].find((x) => matches(x, where));
      const copia = r ? structuredClone(r) : null;
      await tick(); // la copia ya se leyó: lo que escriba otro mientras tanto no la cambia
      return copia;
    },
    findUnique: async ({ where }: any = {}) => {
      const r = rows.get(where.id);
      const copia = r ? structuredClone(r) : null;
      await tick();
      return copia;
    },
    findMany: async ({ where }: any = {}) => {
      const copia = [...rows.values()].filter((x) => matches(x, where)).map((x) => structuredClone(x));
      await tick();
      return copia;
    },
    update: async ({ where, data }: any) => {
      const r = rows.get(where.id);
      if (!r) throw new Error("P2025");
      Object.assign(r, data);
      return structuredClone(r);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows.values()) {
        if (matches(r, where)) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: any) => {
      const id = data.id ?? `n${rows.size + 1}`;
      const r = { ...data, id };
      rows.set(id, r);
      return structuredClone(r);
    },
  };
}

let appts: Map<string, Row>;
let crs: Map<string, Row>;
let brs: Map<string, Row>;
let pacientes: Map<string, Row>;
/** Avisos que habrían salido por WhatsApp (emisor de citas). */
let avisos: { evento: string; appointmentId: string }[];
/** Notificaciones de resolución de cambio de cita. */
let notificadas: string[];

const prismaStub: any = {
  $executeRaw: async () => 1,
  $transaction: async (fn: any) => fn(prismaStub),
  get appointment() { return tabla(appts); },
  get appointmentChangeRequest() { return tabla(crs); },
  get bookingRequest() { return tabla(brs); },
  get patient() { return tabla(pacientes); },
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
};

const session = {
  user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] },
  clinic: {
    id: "c1", name: "Clínica", category: "DENTAL", timezone: "America/Mexico_City",
    defaultSlotMinutes: 30, schedules: [],
  },
};

const M = mock as any;
M.module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
M.module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null, isOverlapError: () => false },
});
M.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
M.module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
M.module("@/lib/reminders/reschedule.server", {
  namedExports: { applyReminderReschedule: async () => undefined, cancelPendingRemindersForAppointment: async () => undefined },
});
M.module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
M.module("@/lib/whatsapp/avisos-cita", {
  namedExports: {
    avisarCitaPorWhatsApp: async (a: any) => {
      avisos.push({ evento: a.evento, appointmentId: a.appointmentId });
      return { enviado: true };
    },
  },
});
M.module("@/lib/agenda/resource-schedule.server", { namedExports: { loadResourceSchedule: async () => [] } });
// portal del paciente
M.module("@/lib/patient-portal/guard", {
  namedExports: {
    getPatientPortalContext: async () => ({ account: { id: "acc1" }, links: [{ patientId: "p1", clinicId: "c1" }] }),
    pacienteUnauthorized: () => new Response("{}", { status: 401 }),
  },
});
M.module("@/lib/movimientos-paciente/registrar", {
  namedExports: { registrarMovimientoDelPaciente: async () => undefined, registrarMovimientoExterno: async () => undefined },
});
M.module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
M.module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, ensureUserCanSeePatient: async () => undefined, canSeePatient: () => true },
});
M.module("@/lib/agenda/server", { namedExports: { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status }) } });
M.module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => "America/Mexico_City" } });
M.module("@/lib/anticipos/cita-cancelada.server", {
  namedExports: {
    marcarPendienteSiHayDinero: async () => undefined,
    dineroDeLaCita: async () => null,
    decidirDineroDeCitaCancelada: async () => ({ ok: true, aplicada: null, motivo: null }),
  },
});
// resolve de solicitudes de cambio
M.module("@/lib/appointment-change/notify", {
  namedExports: { notifyPatientChangeResolution: async (id: string) => { notificadas.push(id); } },
});
M.module("@/lib/appointment-change/slots", {
  namedExports: {
    isSlotFree: async () => true,
    CHANGEABLE_STATUSES: ["SCHEDULED", "CONFIRMED"],
    canPatientChange: () => true,
  },
});
M.module("@/lib/agenda-bloqueos/consulta.server", { namedExports: { leerBloqueosDelRango: async () => [] } });
M.module("@/lib/agenda-bloqueos/politica.server", { namedExports: { rechazoPorBloqueo: async () => null } });
M.module("@/lib/horario-doctor/consulta.server", { namedExports: { leerHorariosDeDoctores: async () => new Map() } });
// aceptar solicitudes web
M.module("@/lib/patients/next-patient-number", {
  namedExports: { nextPatientNumber: async () => 1, withPatientNumberRetry: async (fn: any) => fn() },
});
M.module("@/lib/booking-requests/server", {
  namedExports: {
    activeDoctors: async () => [{ id: "d1", firstName: "Luis", lastName: "Ruiz" }],
    freeSlotsForDay: async () => [],
    isMissingTable: () => false,
  },
});
M.module("@/lib/whatsapp/inbox-log", { namedExports: { findPatientsByWhatsAppPhone: async () => [] } });

beforeEach(() => {
  avisos = [];
  notificadas = [];
  pacientes = new Map();
  const base = (id: string, extra: Row = {}) => ({
    id, clinicId: "c1", patientId: "p1", doctorId: "d1", resourceId: null,
    status: "SCHEDULED", requiresValidation: true,
    startsAt: new Date(Date.now() + 3 * 864e5), endsAt: new Date(Date.now() + 3 * 864e5 + 18e5),
    ...extra,
  });
  appts = new Map([["a1", base("a1")], ["a2", base("a2")]]);
  crs = new Map([
    ["r1", {
      id: "r1", clinicId: "c1", patientId: "p1", appointmentId: "a1", type: "CANCEL", status: "PENDING",
      reason: "no puedo", proposedStartsAt: null, proposedEndsAt: null,
      appointment: base("a1"), patient: { id: "p1", firstName: "Ana", lastName: "G" },
    }],
  ]);
  brs = new Map([
    ["b1", {
      id: "b1", clinicId: "c1", status: "PENDIENTE", patientName: "Ana García", patientWhatsapp: "+529991112222",
      patientDob: null, requestedAt: new Date(Date.now() + 5 * 864e5), serviceName: "Limpieza",
      serviceDurationMin: 30, doctorId: null, notes: null,
    }],
  ]);
});

function req(body: unknown): any {
  return {
    json: async () => body, text: async () => JSON.stringify(body),
    headers: new Headers(), url: "http://localhost/x", nextUrl: new URL("http://localhost/x"),
  };
}
const dos = <T>(f: () => Promise<T>) => Promise.all([f(), f()]);

// ═══════════════════════════════════════════════════════════════════════════
// batch-validate
// ═══════════════════════════════════════════════════════════════════════════
async function batch(body: unknown) {
  const { POST } = await import("@/app/api/appointments/batch-validate/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

test("batch-validate: un id repetido en el lote avisa UNA vez, no dos", async () => {
  const r = await batch({ action: "confirm", appointmentIds: ["a1", "a1", "a1"], notifyPatients: true });
  assert.equal(r.status, 200);
  assert.equal(avisos.length, 1, "el mismo id tres veces mandó varios WhatsApp");
  assert.equal(r.body.processed, 1);
});

test("batch-validate: dos peticiones simultáneas (doble clic) confirman y avisan UNA sola vez", async () => {
  const rs = await dos(() => batch({ action: "confirm", appointmentIds: ["a1", "a2"], notifyPatients: true }));
  assert.equal(avisos.length, 2, "dos citas = dos avisos en total, no cuatro");
  assert.equal(rs[0].body.processed + rs[1].body.processed, 2, "cada cita se procesa una sola vez entre las dos peticiones");
  assert.equal(appts.get("a1")!.status, "CONFIRMED");
});

test("batch-validate: rechazar dos veces a la vez avisa la cancelación UNA vez", async () => {
  const rs = await dos(() => batch({ action: "reject", appointmentIds: ["a1"], notifyPatients: true }));
  assert.equal(avisos.length, 1);
  assert.equal(rs[0].body.processed + rs[1].body.processed, 1);
  assert.equal(appts.get("a1")!.status, "CANCELLED");
});

test("batch-validate: tenant — el cambio de estado va condicionado a la clínica de la sesión", async () => {
  appts.get("a1")!.clinicId = "c2";
  const r = await batch({ action: "confirm", appointmentIds: ["a1"], notifyPatients: true });
  assert.equal(r.body.processed, 0);
  assert.equal(avisos.length, 0);
  assert.equal(appts.get("a1")!.status, "SCHEDULED");
});

// ═══════════════════════════════════════════════════════════════════════════
// appointment-change-requests/[id]/resolve
// ═══════════════════════════════════════════════════════════════════════════
async function resolver(action: "APPROVE" | "REJECT") {
  const { POST } = await import("@/app/api/appointment-change-requests/[id]/resolve/route");
  const res = await POST(req({ action }), { params: { id: "r1" } });
  return { status: res.status, body: await res.json() };
}

test("resolve: aprobar la cancelación dos veces a la vez notifica al paciente UNA vez y la segunda es 409", async () => {
  const rs = await dos(() => resolver("APPROVE"));
  assert.equal(notificadas.length, 1, "el paciente recibió dos avisos de «tu cita fue cancelada»");
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(appts.get("a1")!.status, "CANCELLED");
});

test("resolve: rechazar dos veces a la vez notifica UNA vez y la segunda es 409", async () => {
  const rs = await dos(() => resolver("REJECT"));
  assert.equal(notificadas.length, 1);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});

test("resolve: aprobar y rechazar a la vez — gana uno solo y nadie recibe dos avisos contradictorios", async () => {
  const rs = await Promise.all([resolver("APPROVE"), resolver("REJECT")]);
  assert.equal(notificadas.length, 1);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});

test("resolve: reagendar aprobado dos veces a la vez mueve y notifica UNA vez", async () => {
  const cr = crs.get("r1")!;
  cr.type = "RESCHEDULE";
  cr.proposedStartsAt = new Date(Date.now() + 6 * 864e5);
  cr.proposedEndsAt = new Date(Date.now() + 6 * 864e5 + 18e5);
  const rs = await dos(() => resolver("APPROVE"));
  assert.equal(notificadas.length, 1);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /appointments/[id]/status y DELETE /appointments/[id] (cancelar)
// ═══════════════════════════════════════════════════════════════════════════
test("PATCH /status: cancelar dos veces a la vez avisa la cancelación UNA vez y la segunda es 409", async () => {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const go = async () => {
    const res = await PATCH(req({ status: "CANCELLED" }), { params: { id: "a1" } });
    return { status: res.status, body: await res.json() };
  };
  const rs = await dos(go);
  assert.equal(avisos.length, 1, "doble clic en «Cancelar»: dos WhatsApp al paciente");
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});

test("DELETE: cancelar dos veces a la vez avisa UNA vez (la segunda ya es «ok» sin avisar)", async () => {
  const { DELETE } = await import("@/app/api/appointments/[id]/route");
  const go = async () => {
    const res = await DELETE(req({}), { params: { id: "a1" } });
    return { status: res.status, body: await res.json() };
  };
  const rs = await dos(go);
  assert.equal(avisos.length, 1);
  assert.ok(rs.every((r) => r.status === 200 || r.status === 409), JSON.stringify(rs));
});

// ═══════════════════════════════════════════════════════════════════════════
// booking-requests/[id] — aceptar / rechazar
// ═══════════════════════════════════════════════════════════════════════════
async function solicitud(body: unknown) {
  const { PATCH } = await import("@/app/api/booking-requests/[id]/route");
  const res = await PATCH(req(body), { params: { id: "b1" } });
  return { status: res.status, body: await res.json() };
}

test("booking-requests: aceptar dos veces a la vez crea UNA cita y UN paciente; la otra es 409", async () => {
  const antes = appts.size;
  const rs = await dos(() => solicitud({ action: "accept" }));
  assert.equal(appts.size - antes, 1, "dos clics en «Aceptar» crearon dos citas");
  assert.equal(pacientes.size, 1, "y dos expedientes");
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], JSON.stringify(rs));
  assert.equal(brs.get("b1")!.status, "ACEPTADA");
});

test("booking-requests: rechazar dos veces a la vez responde una vez ok y una 409", async () => {
  const rs = await dos(() => solicitud({ action: "reject", reason: "no" }));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(brs.get("b1")!.status, "RECHAZADA");
});

test("booking-requests: aceptar y rechazar a la vez — gana uno, y no queda cita si ganó el rechazo", async () => {
  const antes = appts.size;
  const rs = await Promise.all([solicitud({ action: "accept" }), solicitud({ action: "reject" })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], JSON.stringify(rs));
  const estado = brs.get("b1")!.status;
  assert.equal(appts.size - antes, estado === "ACEPTADA" ? 1 : 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// portal del paciente — cancelar / reagendar con auto-aprobación
// ═══════════════════════════════════════════════════════════════════════════
async function portal(body: unknown) {
  const { POST } = await import("@/app/api/paciente/appointments/[id]/change-request/route");
  const res = await POST(req(body), { params: { id: "a1" } });
  return { status: res.status, body: await res.json() };
}
function citaDelPortal() {
  crs.clear(); // sin solicitudes pendientes previas
  const a = appts.get("a1")!;
  Object.assign(a, {
    status: "CONFIRMED",
    clinic: {
      timezone: "America/Mexico_City", patientChangesMinHours: 24, patientChangesAutoApprove: true,
      schedules: [],
    },
  });
}

test("portal: cancelar dos veces a la vez (doble toque) notifica al paciente UNA vez", async () => {
  citaDelPortal();
  const rs = await dos(() => portal({ type: "CANCEL" }));
  assert.equal(notificadas.length, 1, "el paciente recibió dos avisos de cancelación");
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 422], JSON.stringify(rs));
  assert.equal(crs.size, 1, "solo una solicitud aprobada nueva");
});
