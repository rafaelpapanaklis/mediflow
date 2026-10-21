/**
 * «AGENDAR LO PENDIENTE» EN EL SERVIDOR — ws1-t1 (plan de tratamiento, fase 2 · P8).
 *
 * Run: npm run test:plan-citas
 *
 * Llama a los HANDLERS REALES de `POST /api/appointments` y `GET /api/appointments/plan-pendiente`
 * con `mock.module` sobre prisma, la sesión y los efectos secundarios (el arnés de
 * sobreagendar.test.ts). La capa de base de las citas del plan es un doble EN MEMORIA que respeta la
 * clínica como la de verdad (`citas-del-plan-db.ts`, probada aparte contra PGlite). Fija:
 *  · sin `planItemIds` la cita es exactamente la de siempre (ni una consulta del plan);
 *  · filas de OTRA clínica u otro paciente → 404 y NO queda cita;
 *  · fila ya agendada en una cita viva → 409 y no queda cita; si esa cita se canceló, se puede;
 *  · hecha → 409; plan de otro doctor → 403; sin `treatments.edit` → 403; sin el SQL → 409;
 *  · si alguien se lleva la fila entre la lectura y la liga, la transacción se deshace;
 *  · la liga y la bitácora del plan quedan con la cita creada.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const MIN = 60_000;

/** Martes 10-nov-2026 a las HH:MM en Ciudad de México (UTC−6), ISO. */
function martes(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 10, h! + 6, m!)).toISOString();
}

// ── El doble de la capa de base de las citas del plan ──────────────────────
interface FilaDoble {
  clinicId: string;
  planId: string;
  estado: string;
  planDoctorId: string;
  planPatientId: string;
  cita: { id: string; startsAt: Date; endsAt: Date; status: string } | null;
  citaAgendadaId: string | null;
  planStatus?: string;
}
let filasDb: Map<string, FilaDoble>;
let disponible: boolean;
let lecturasDelPlan: number;
/** Simula a otra persona que se lleva una fila entre la lectura y la liga. */
let robarAlLigar: string | null;
let permisosNegados: string[];
let created: any[];
let auditorias: any[];

beforeEach(() => {
  disponible = true;
  lecturasDelPlan = 0;
  robarAlLigar = null;
  permisosNegados = [];
  created = [];
  auditorias = [];
  session.user.role = "RECEPTIONIST";
  session.user.id = "u-recep";
  filasDb = new Map([
    ["f1", { clinicId: "c1", planId: "plan1", estado: "pendiente", planDoctorId: "d1", planPatientId: "p1", cita: null, citaAgendadaId: null }],
    ["f2", { clinicId: "c1", planId: "plan1", estado: "en_curso", planDoctorId: "d1", planPatientId: "p1", cita: null, citaAgendadaId: null }],
    ["hecha", { clinicId: "c1", planId: "plan1", estado: "hecho", planDoctorId: "d1", planPatientId: "p1", cita: null, citaAgendadaId: null }],
    ["de-otro-paciente", { clinicId: "c1", planId: "plan9", estado: "pendiente", planDoctorId: "d1", planPatientId: "p9", cita: null, citaAgendadaId: null }],
    ["ajena", { clinicId: "c2", planId: "plan-c2", estado: "pendiente", planDoctorId: "d-c2", planPatientId: "p1", cita: null, citaAgendadaId: null }],
  ]);
});

const citasDb = {
  citasDelPlanDisponible: async () => disponible,
  leerFilasParaLigar: async (_tx: unknown, clinicId: string, ids: string[]) => {
    lecturasDelPlan++;
    return ids
      .filter((id) => filasDb.get(id)?.clinicId === clinicId)
      .map((id) => {
        const f = filasDb.get(id)!;
        return { id, planId: f.planId, estado: f.estado, planDoctorId: f.planDoctorId, planPatientId: f.planPatientId, planStatus: f.planStatus ?? "ACTIVE", cita: f.cita };
      });
  },
  ligarFilasACita: async (_tx: unknown, a: { clinicId: string; appointmentId: string; ids: string[] }) => {
    if (robarAlLigar) filasDb.get(robarAlLigar)!.estado = "hecho";
    let n = 0;
    for (const id of a.ids) {
      const f = filasDb.get(id);
      if (f && f.clinicId === a.clinicId && (f.estado === "pendiente" || f.estado === "en_curso")) {
        f.citaAgendadaId = a.appointmentId;
        n++;
      }
    }
    return n;
  },
  filasAgendadasEnCita: async (clinicId: string, appointmentId: string) =>
    Array.from(filasDb.entries())
      .filter(([, f]) => f.clinicId === clinicId && f.citaAgendadaId === appointmentId && f.estado !== "cancelado")
      .map(([id, f]) => ({ id, planId: f.planId, nombre: `Proc ${id}`, dientes: [16], estado: f.estado, cantidad: 1, minutos: 45, invoiceId: null })),
  filasDelPlanParaAgendar: async (clinicId: string, planId: string) => {
    lecturasDelPlan++;
    return Array.from(filasDb.entries())
      .filter(([, f]) => f.clinicId === clinicId && f.planId === planId)
      .map(([id, f], i) => ({ id, nombre: `Proc ${id}`, dientes: [16], caras: [], estado: f.estado, cantidad: 1, minutos: 45, cita: f.cita, orden: i }));
  },
};

function apptRow(data: any) {
  return {
    id: "nueva",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    type: "Resina",
    notes: null,
    status: "SCHEDULED",
    overrideReason: null,
    patient: { id: "p1", firstName: "Ana", lastName: "García", visibleUserIds: [] },
    doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
    ...data,
  };
}

const prismaStub: any = {
  patient: { findFirst: async ({ where }: any) => (where.id === "p1" && where.clinicId === "c1" ? { id: "p1", status: "ACTIVE" } : null) },
  user: { findFirst: async ({ where }: any) => (where.id === "d1" ? { id: "d1" } : null) },
  resource: { findFirst: async ({ where }: any) => ({ id: where.id }) },
  appointment: {
    // Reagendar: «a-cancelada» y «a-viva» son de c1.
    findFirst: async ({ where }: any) =>
      where.clinicId === "c1" && (where.id === "a-cancelada" || where.id === "a-viva")
        ? { id: where.id, patientId: "p1", status: where.id === "a-cancelada" ? "CANCELLED" : "SCHEDULED" }
        : null,
    findUnique: async () => null,
    findMany: async () => [],
  },
  agendaBlock: { findMany: async () => [] },
  agendaBlockPolicy: { findUnique: async () => null },
  clinicFeatureFlag: { findMany: async () => [] },
  doctorSchedule: { findMany: async () => [] },
  treatmentPlan: {
    findMany: async ({ where }: any) =>
      where.clinicId === "c1"
        ? where.id.in.map((id: string) => ({ id, status: id === "plan-pausado" ? "PAUSED" : "ACTIVE", doctorId: "d1", patientId: id === "plan9" ? "p9" : "p1" }))
        : [],
    findFirst: async ({ where }: any) =>
      where.id === "plan1" && where.clinicId === "c1"
        ? { id: "plan1", name: "Plan 20 oct", status: "ACTIVE", patientId: "p1", doctorId: "d1", patient: { firstName: "Ana", lastName: "García" } }
        : null,
  },
  $queryRaw: async (strings: TemplateStringsArray) => {
    const sql = strings.join("");
    if (sql.includes("to_regclass")) return [{ existe: true }];
    return [];
  },
  // La transacción de verdad: lo creado solo «se guarda» si la función termina sin lanzar.
  $transaction: async (fn: any) => {
    const buffer: any[] = [];
    const r = await fn({
      appointment: {
        create: async ({ data }: any) => {
          buffer.push(data);
          return apptRow({ ...data, id: "nueva" });
        },
      },
    });
    created.push(...buffer);
    return r;
  },
};

const session = {
  user: { id: "u-recep", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] as string[] },
  clinic: {
    id: "c1",
    name: "Centro Dental QA",
    category: "DENTAL",
    timezone: TZ,
    defaultSlotMinutes: 30,
    agendaDayStart: 0,
    agendaDayEnd: 24,
    waConnected: false,
    trialEndsAt: null,
    subscriptionStatus: "active",
    schedules: [],
  },
  timeConfig: { timezone: TZ, slotMinutes: 30, dayStart: 0, dayEnd: 24 },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/treatments/citas-del-plan-db", { namedExports: citasDb });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", {
  namedExports: {
    denyIfMissingPermission: (_u: unknown, key: string) =>
      permisosNegados.includes(key) ? new Response(JSON.stringify({ error: "forbidden", permiso: key }), { status: 403 }) : null,
  },
});
(mock as any).module("@/lib/agenda/server", {
  namedExports: {
    appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, startsAt: a.startsAt, reason: a.type }),
    fetchActiveDoctors: async () => [],
    fetchAppointmentsForDay: async () => [],
    fetchPendingValidation: async () => [],
    fetchResources: async () => [],
    fetchWaitlistCount: async () => 0,
  },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    ensureUserCanSeePatient: async () => undefined,
    assertPatientVisible: async () => null,
    canSeePatient: () => true,
  },
});
(mock as any).module("@/lib/agenda/resource-schedule.server", { namedExports: { loadResourceSchedule: async () => null } });
(mock as any).module("@/lib/audit", {
  namedExports: {
    logMutation: async (args: any) => {
      auditorias.push(args);
    },
  },
});
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });

function req(body: unknown, url = "http://localhost/api/appointments"): any {
  return {
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    nextUrl: new URL(url),
    url,
  };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/appointments/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

async function getPendiente(planId: string) {
  const { GET } = await import("@/app/api/appointments/plan-pendiente/route");
  const res = await GET(req(null, `http://localhost/api/appointments/plan-pendiente?planId=${planId}`));
  return { status: res.status, body: await res.json() };
}

function alta(extra: Record<string, unknown> = {}) {
  const startsAt = martes("11:00");
  return {
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 60 * MIN).toISOString(),
    reason: "Resina 16 · Limpieza",
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════════════

test("sin planItemIds: la cita de siempre, sin una sola consulta del plan", async () => {
  const r = await post(alta());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created.length, 1);
  assert.equal(lecturasDelPlan, 0);
  assert.equal(r.body.planItemIds, undefined);
  assert.equal(auditorias.length, 1, "solo la de la cita");
  assert.equal(auditorias[0].after.delPlan, undefined);
});

test("con planItemIds: cita normal + filas ligadas + bitácora de la cita y del plan", async () => {
  const r = await post(alta({ planItemIds: ["f1", "f2", "f1"] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "SCHEDULED", "una cita normal");
  assert.deepEqual(r.body.planItemIds, ["f1", "f2"]);
  assert.equal(filasDb.get("f1")!.citaAgendadaId, "nueva");
  assert.equal(filasDb.get("f2")!.citaAgendadaId, "nueva");
  const deLaCita = auditorias.find((a) => a.entityType === "appointment");
  assert.deepEqual(deLaCita.after.delPlan, [{ id: "f1", planId: "plan1" }, { id: "f2", planId: "plan1" }]);
  const delPlan = auditorias.find((a) => a.entityType === "treatment");
  assert.equal(delPlan.entityId, "plan1");
  assert.equal(delPlan.texto, "Agendó 2 procedimientos del plan de tratamiento");
  assert.deepEqual(delPlan.after.filasAgendadas, ["f1", "f2"]);
  assert.doesNotMatch(delPlan.texto, /Proc/, "Movimientos no lleva nombres de procedimientos");
});

test("una fila de OTRA clínica → 404 y no queda cita ni liga", async () => {
  const r = await post(alta({ planItemIds: ["f1", "ajena"] }));
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "plan_fila_ajena");
  assert.equal(created.length, 0);
  assert.equal(filasDb.get("f1")!.citaAgendadaId, null);
  assert.equal(filasDb.get("ajena")!.citaAgendadaId, null);
});

test("una fila de OTRO paciente de la misma clínica → 404 (misma respuesta) y no queda cita", async () => {
  const r = await post(alta({ planItemIds: ["de-otro-paciente"] }));
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "plan_fila_ajena");
  assert.equal(created.length, 0);
});

test("fila ya agendada en una cita viva → 409 y no queda cita; si esa cita se canceló, se puede", async () => {
  const f1 = filasDb.get("f1")!;
  f1.cita = { id: "a-vieja", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: "CONFIRMED" };
  f1.citaAgendadaId = "a-vieja";
  let r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "plan_fila_ya_agendada");
  assert.equal(created.length, 0);
  assert.equal(f1.citaAgendadaId, "a-vieja");

  // La cita vieja se cancela (por cualquier puerta): la fila queda libre sin que nadie la suelte.
  f1.cita = { ...f1.cita, status: "CANCELLED" };
  r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(f1.citaAgendadaId, "nueva");
});

test("plan pausado o abandonado → 409 y no queda cita (el servidor no se fía del botón)", async () => {
  filasDb.get("f1")!.planStatus = "ABANDONED";
  const r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "plan_no_activo");
  assert.equal(created.length, 0);
});

test("fila hecha → 409 y no queda cita", async () => {
  const r = await post(alta({ planItemIds: ["f1", "hecha"] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "plan_fila_no_pendiente");
  assert.equal(created.length, 0);
  assert.equal(filasDb.get("f1")!.citaAgendadaId, null);
});

test("si otra persona se lleva la fila entre la lectura y la liga, la cita se deshace", async () => {
  robarAlLigar = "f2";
  const r = await post(alta({ planItemIds: ["f1", "f2"] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "plan_fila_no_pendiente");
  assert.equal(created.length, 0, "la transacción no guardó la cita");
});

test("el doctor solo agenda filas de SUS planes", async () => {
  session.user.role = "DOCTOR";
  session.user.id = "d-otro";
  const r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "plan_de_otro_doctor");
  assert.equal(created.length, 0);
  session.user.id = "d1";
  assert.equal((await post(alta({ planItemIds: ["f1"] }))).status, 201);
});

test("sin treatments.edit no se ligan filas (403) y no queda cita; sin ellas, agenda como siempre", async () => {
  permisosNegados = ["treatments.edit"];
  const r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 403);
  assert.equal(created.length, 0);
  assert.equal((await post(alta())).status, 201);
});

test("sin el SQL pegado: 409 «no disponible» y no se crea la cita a medias", async () => {
  disponible = false;
  const r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "plan_citas_no_disponible");
  assert.equal(created.length, 0);
});

test("planItemIds que no es lista de ids → 400 y nada se guarda", async () => {
  for (const malo of ["f1", [1, 2], [{ id: "f1" }]]) {
    const r = await post(alta({ planItemIds: malo }));
    assert.equal(r.status, 400, JSON.stringify(malo));
    assert.equal(r.body.error, "plan_filas_invalidas");
  }
  assert.equal(created.length, 0);
});

test("GET plan-pendiente: por agendar / agendada / no aplica, minutos y permiso de agendar", async () => {
  const f1 = filasDb.get("f1")!;
  f1.cita = { id: "a1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: "SCHEDULED" };
  const r = await getPendiente("plan1");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.disponible, true);
  assert.equal(r.body.plan.paciente.id, "p1");
  assert.equal(r.body.plan.doctorId, "d1");
  const porId = Object.fromEntries(r.body.filas.map((f: any) => [f.id, f.agenda]));
  assert.deepEqual(porId, { f1: "agendada", f2: "por_agendar", hecha: "no_aplica" });
  assert.equal(r.body.minutosSugeridos, 60, "solo f2 (45 min) redondeado a huecos de 30");
  assert.equal(typeof r.body.puedeAgendar, "boolean");
});

test("GET plan-pendiente: plan de otra clínica → 404; sin SQL → disponible:false; doctor ajeno → 403", async () => {
  assert.equal((await getPendiente("plan-c2")).status, 404);
  disponible = false;
  const sin = await getPendiente("plan1");
  assert.equal(sin.status, 200);
  assert.deepEqual(sin.body, { disponible: false });
  disponible = true;
  session.user.role = "DOCTOR";
  session.user.id = "d-otro";
  assert.equal((await getPendiente("plan1")).status, 403);
});

async function getReagendar(appointmentId: string) {
  const { GET } = await import("@/app/api/appointments/plan-pendiente/route");
  const res = await GET(req(null, `http://localhost/api/appointments/plan-pendiente?appointmentId=${appointmentId}`));
  return { status: res.status, body: await res.json() };
}

test("Reagendar: de una cita CANCELADA vuelve lo pendiente que tenía (no lo hecho, ni de otro plan del doctor ajeno)", async () => {
  filasDb.get("f1")!.citaAgendadaId = "a-cancelada";
  filasDb.get("f2")!.citaAgendadaId = "a-cancelada";
  filasDb.get("hecha")!.citaAgendadaId = "a-cancelada";
  const r = await getReagendar("a-cancelada");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.filas.map((f: any) => f.id), ["f1", "f2"]);
  assert.equal(r.body.planId, "plan1");
  assert.equal(r.body.minutosSugeridos, 90);
  // Un doctor que no es el del plan no se las lleva (el POST se lo negaría).
  session.user.role = "DOCTOR";
  session.user.id = "d-otro";
  assert.deepEqual((await getReagendar("a-cancelada")).body.filas, []);
});

test("Reagendar: de una cita VIVA no hay nada que llevarse; de otra clínica → 404", async () => {
  filasDb.get("f1")!.citaAgendadaId = "a-viva";
  assert.deepEqual((await getReagendar("a-viva")).body.filas, []);
  assert.equal((await getReagendar("a-de-c2")).status, 404);
});

test("Reagendar → POST con esas filas: la cita nueva se las lleva", async () => {
  filasDb.get("f1")!.citaAgendadaId = "a-cancelada";
  filasDb.get("f1")!.cita = { id: "a-cancelada", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: "CANCELLED" };
  const r = await post(alta({ planItemIds: ["f1"] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(filasDb.get("f1")!.citaAgendadaId, "nueva");
});
