/**
 * Cita «Sin doctor» en el ALTA y en «Editar cita» (ws1-t11 · fase 2 · P1).
 *
 * Run: npm run test:cita-sin-doctor
 *
 * HANDLERS REALES de `POST /api/appointments` y `PATCH /api/appointments/:id`
 * (el arnés de sobreagendar.test.ts), con un Prisma de mentira que se porta
 * como Postgres + Prisma en lo que aquí importa — y que el doble viejo
 * escondía:
 *  · `{ doctorId: null }` es `IS NULL`: empata con TODAS las «Sin doctor»;
 *  · `{ in: [..., null] }` y `findFirst({ where: { id: null } })` revientan
 *    (error de validación de Prisma);
 *  · `OR: []` no devuelve ninguna fila.
 * Ids con forma de cuid y de siembra (no uuid), como en la base.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DRA = "clx9doc0a000108l4aaaa0001"; // cuid
const DR2 = "seed-doctor-2"; // id de siembra
const SILLON = "res_sillon_1";

function martes(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 10, h! + 6, m!)).toISOString();
}

let bandera: boolean;
let sinDoctorListo: boolean;
let ocupadas: any[];
let existingRow: any;
let created: any[];
let updated: any[];
let visibilidad: any[];
let auditorias: any[];
let reagendados: any[];

const CLAVE_COLUMNAS = Symbol.for("dalecontrol.horarioDoctor.columnasComida");
const CLAVE_FLEX = Symbol.for("dalecontrol.agenda.flexible");

const session = {
  user: { id: "u-recep", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] as string[] },
  clinic: {
    id: "c1", name: "Centro Dental QA", category: "DENTAL", timezone: TZ, defaultSlotMinutes: 30,
    agendaDayStart: 0, agendaDayEnd: 24, waConnected: false, trialEndsAt: null, subscriptionStatus: "active", schedules: [],
  },
  timeConfig: { timezone: TZ, slotMinutes: 30, dayStart: 0, dayEnd: 24 },
};

beforeEach(() => {
  bandera = false;
  sinDoctorListo = true;
  ocupadas = [];
  existingRow = null;
  created = [];
  updated = [];
  visibilidad = [];
  auditorias = [];
  reagendados = [];
  session.user.id = "u-recep";
  session.user.role = "RECEPTIONIST";
  session.clinic.category = "DENTAL";
  (globalThis as any)[CLAVE_FLEX] = undefined;
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: true, at: Date.now() };
});

/** Lo que Prisma rechaza antes de llegar a Postgres. */
function validarComoPrisma(where: any): void {
  const visitar = (w: any) => {
    if (!w || typeof w !== "object") return;
    if (Array.isArray(w)) return w.forEach(visitar);
    for (const [k, v] of Object.entries(w)) {
      if (k === "in" && Array.isArray(v) && v.some((x) => x === null || x === undefined)) {
        throw Object.assign(new Error("PrismaClientValidationError: Argument `in`: null is not a String"), { name: "PrismaClientValidationError" });
      }
      visitar(v);
    }
  };
  visitar(where);
}

/** Una rama de `OR` evaluada como en Postgres. */
function cumpleRama(a: any, o: any): boolean {
  return Object.entries(o).every(([k, v]) => (v === null ? a[k] === null : a[k] === v));
}

const prismaStub: any = {
  patient: { findFirst: async () => ({ id: "p1", status: "ACTIVE" }) },
  user: {
    findFirst: async ({ where }: any) => {
      if (where.id === null || where.id === undefined) throw Object.assign(new Error("PrismaClientValidationError: id null"), { name: "PrismaClientValidationError" });
      return where.id === DRA || where.id === DR2 ? { id: where.id } : null;
    },
  },
  resource: { findFirst: async ({ where }: any) => ({ id: where.id }) },
  appointment: {
    findFirst: async ({ include }: any = {}) =>
      existingRow && { ...existingRow, ...(include?.patient?.select?.status ? { patient: { status: "ACTIVE" } } : {}) },
    findUnique: async () => null,
    findMany: async ({ where }: any) => {
      validarComoPrisma(where);
      return ocupadas
        .filter(
          (a) =>
            a.clinicId === where.clinicId &&
            (!where.id?.not || a.id !== where.id.not) &&
            (!where.overrideReason?.startsWith || String(a.overrideReason ?? "").startsWith(where.overrideReason.startsWith)) &&
            new Date(a.startsAt) < where.startsAt.lt &&
            new Date(a.endsAt) > where.endsAt.gt &&
            // `OR: []` no da filas, igual que Prisma.
            (!where.OR || where.OR.some((o: any) => cumpleRama(a, o))),
        )
        .map((a) => ({ ...a, startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) }));
    },
  },
  agendaBlock: {
    findMany: async ({ where }: any) => {
      validarComoPrisma(where);
      return [];
    },
  },
  agendaBlockPolicy: { findUnique: async () => null },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) => (bandera && where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : []),
  },
  doctorSchedule: { findMany: async () => [] },
  $queryRaw: async (strings: TemplateStringsArray) => {
    const sql = strings.join("");
    if (sql.includes("to_regclass")) return [{ existe: true }];
    if (sql.includes('"lunchStart", "lunchEnd" FROM "doctor_schedules"')) return [];
    return [{ n: 2 }];
  },
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        create: async ({ data }: any) => {
          created.push(data);
          return { ...apptRow(data), id: "nueva" };
        },
        update: async ({ data }: any) => {
          updated.push(data);
          const doctorId =
            data.doctor?.disconnect ? null : data.doctor?.connect?.id ?? existingRow.doctorId;
          return apptRow({ ...existingRow, doctorId, ...(data.startsAt ? { startsAt: data.startsAt } : {}), ...(data.endsAt ? { endsAt: data.endsAt } : {}) });
        },
      },
    }),
};

function apptRow(data: any) {
  return {
    id: "a1", clinicId: "c1", patientId: "p1", doctorId: null, resourceId: null, type: "Limpieza", notes: null,
    status: "SCHEDULED", overrideReason: null, mode: "IN_PERSON",
    patient: { id: "p1", firstName: "Ana", lastName: "García", visibleUserIds: [] },
    doctor: null,
    ...data,
  };
}

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/agenda/server", {
  namedExports: {
    appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, startsAt: a.startsAt, doctorId: a.doctorId }),
    fetchActiveDoctors: async () => [],
    fetchAppointmentsForDay: async () => [],
    fetchPendingValidation: async () => [],
    fetchResources: async () => [],
    fetchWaitlistCount: async () => 0,
  },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    ensureUserCanSeePatient: async (...args: unknown[]) => {
      visibilidad.push(args);
    },
    assertPatientVisible: async () => null,
    canSeePatient: () => true,
  },
});
(mock as any).module("@/lib/agenda/resource-schedule.server", { namedExports: { loadResourceSchedule: async () => null } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (args: any) => { auditorias.push(args); } } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: {
    applyReminderReschedule: async (_tx: unknown, args: unknown) => { reagendados.push(args); },
    cancelPendingRemindersForAppointment: async () => undefined,
  },
});
(mock as any).module("@/lib/agenda/sin-doctor.server", {
  namedExports: {
    sinDoctorDisponible: async () => sinDoctorListo,
    sinDoctorDisponibleAlGuardar: async () => sinDoctorListo,
  },
});

function req(body: unknown): any {
  return {
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    nextUrl: new URL("http://localhost/api/appointments"),
    url: "http://localhost/api/appointments",
  };
}
async function post(body: unknown) {
  const { POST } = await import("@/app/api/appointments/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}
async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/appointments/[id]/route");
  const res = await PATCH(req(body), { params: Promise.resolve({ id: "a1" }) });
  return { status: res.status, body: await res.json() };
}
function alta(hhmm: string, extra: Record<string, unknown> = {}) {
  const startsAt = martes(hhmm);
  return {
    patientId: "p1", doctorId: null, resourceId: null, startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 30 * MIN).toISOString(), reason: "Limpieza", ...extra,
  };
}
function otraSinDoctor(extra: Record<string, unknown> = {}) {
  return {
    id: "cmh0otra00001", clinicId: "c1", doctorId: null, resourceId: null, status: "SCHEDULED", overrideReason: null,
    startsAt: martes("10:00"), endsAt: martes("10:30"), patient: { firstName: "Mario", lastName: "López", visibleUserIds: [] }, ...extra,
  };
}

// ═══════════════════════════ ALTA ═══════════════════════════

test("alta · `doctorId: null` crea la cita «Sin doctor» (sin buscar doctor, sin `in: [null]`, sin tocar la visibilidad)", async () => {
  const r = await post(alta("10:00"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created.length, 1);
  assert.equal(created[0].doctorId, null);
  assert.equal(visibilidad.length, 0, "no hay doctor a quien darle visibilidad");
  assert.equal(auditorias[0].after.doctorId, null);
});

test("alta · sin el campo `doctorId` (o vacío) sigue siendo el 400 de siempre: ausente NO es «Sin doctor»", async () => {
  const { doctorId: _fuera, ...sinCampo } = alta("10:00");
  for (const cuerpo of [sinCampo, alta("10:00", { doctorId: "" })]) {
    const r = await post(cuerpo);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "missing_doctorId");
  }
  assert.equal(created.length, 0);
});

test("alta · con doctor, todo como siempre (y su visibilidad)", async () => {
  const r = await post(alta("10:00", { doctorId: DRA }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created[0].doctorId, DRA);
  assert.equal(visibilidad.length, 1);
});

test("alta · sin el SQL pegado, «Sin doctor» da 409 con lo que falta y no escribe nada", async () => {
  sinDoctorListo = false;
  const r = await post(alta("10:00"));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "sin_doctor_unavailable");
  assert.match(r.body.reason, /sql\/cita-sin-doctor\.sql/);
  assert.equal(created.length, 0);
});

test("alta · una teleconsulta no puede ser «Sin doctor»", async () => {
  session.clinic.category = "MEDICAL";
  const r = await post(alta("10:00", { isTeleconsult: true }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "teleconsult_requires_doctor");
  assert.equal(created.length, 0);
});

test("bandera · dos «Sin doctor» a la misma hora sin sillón NO chocan (ni quedan marcadas como sobreagendadas)", async () => {
  bandera = true;
  ocupadas = [otraSinDoctor()];
  const r = await post(alta("10:00"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created[0].overrideReason, null, "la marca la sacaría de la constraint del sillón");
  assert.equal(r.body.sobreagendada, undefined);
});

test("bandera · «Sin doctor» en el MISMO sillón que otra sí choca (por el sillón)", async () => {
  bandera = true;
  ocupadas = [otraSinDoctor({ resourceId: SILLON })];
  const r = await post(alta("10:00", { resourceId: SILLON }));
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "cmh0otra00001");
  assert.equal(created.length, 0);
});

test("bandera · una cita CON doctor no choca con una «Sin doctor» a la misma hora", async () => {
  bandera = true;
  ocupadas = [otraSinDoctor()];
  const r = await post(alta("10:00", { doctorId: DRA }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created[0].overrideReason, null);
});

// ═══════════════════════════ EDITAR ═══════════════════════════

function existente(extra: Record<string, unknown> = {}) {
  existingRow = apptRow({ id: "a1", startsAt: new Date(martes("10:00")), endsAt: new Date(martes("10:30")), ...extra });
}

test("editar · corregir las notas de una «Sin doctor» guarda (antes: `in: [null]` en los bloqueos → 500)", async () => {
  existente();
  const r = await patch({ notes: "Trae radiografía" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].notes, "Trae radiografía");
  assert.equal(updated[0].doctor, undefined, "no se toca el doctor");
  assert.equal(reagendados.length, 0, "ni los recordatorios");
});

test("editar · asignarle doctor a una «Sin doctor» YA atendida no cuenta como moverla", async () => {
  existente({ status: "COMPLETED", startsAt: new Date(Date.now() - 3 * 86_400_000), endsAt: new Date(Date.now() - 3 * 86_400_000 + 30 * MIN) });
  const r = await patch({ doctorId: DRA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(updated[0].doctor, { connect: { id: DRA } });
  assert.equal(visibilidad.length, 1, "el doctor asignado entra a la visibilidad del paciente");
});

test("editar · `doctorId: null` le quita el doctor (vuelve a «Sin doctor»); cambiar SOLO el doctor no re-encola avisos", async () => {
  existente({ doctorId: DRA });
  const r = await patch({ doctorId: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(updated[0].doctor, { disconnect: true });
  // Re-encolar cancelaría un aviso ya vencido sin mandar (revisión): poner al día el texto es de P3.
  assert.equal(reagendados.length, 0);
});

test("editar · una cita EN CONSULTA no se queda sin doctor (409); cambiársela por otro sí", async () => {
  existente({ doctorId: DRA, status: "IN_PROGRESS" });
  let r = await patch({ doctorId: null });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "doctor_required_to_start");
  assert.equal(updated.length, 0);
  r = await patch({ doctorId: DR2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(updated[0].doctor, { connect: { id: DR2 } });
});

test("editar · reenviar el MISMO doctor (el formulario manda todo) no cambia nada, pero le vuelve a dar visibilidad como siempre", async () => {
  existente({ doctorId: DRA });
  const r = await patch({ doctorId: DRA, notes: "x" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].doctor, undefined);
  assert.equal(reagendados.length, 0);
  assert.equal(visibilidad.length, 1, "si el paciente se restringió, su doctor vuelve a entrar (lo de antes)");
});

test("editar · mover de hora una «Sin doctor» re-encola sus recordatorios (dentro de la transacción)", async () => {
  existente({ startsAt: new Date(martes("09:00")), endsAt: new Date(martes("09:30")) });
  const r = await patch({ startsAt: martes("11:00"), endsAt: martes("11:30") });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reagendados.length, 1);
});

test("editar · quitarle el doctor sin el SQL pegado → 409, nada escrito", async () => {
  existente({ doctorId: DRA });
  sinDoctorListo = false;
  const r = await patch({ doctorId: null });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "sin_doctor_unavailable");
  assert.equal(updated.length, 0);
});

test("editar · una teleconsulta no se queda sin doctor", async () => {
  existente({ doctorId: DRA, mode: "TELECONSULTATION" });
  const r = await patch({ doctorId: null });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "teleconsult_requires_doctor");
  assert.equal(updated.length, 0);
});

test("editar · un DOCTOR toma una «Sin doctor» asignándosela a sí mismo; sin tomarla, o dándosela a otro, 403", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  existente();
  let r = await patch({ notes: "solo notas" });
  assert.equal(r.status, 403);
  r = await patch({ doctorId: DR2 });
  assert.equal(r.status, 403);
  assert.equal(updated.length, 0);
  r = await patch({ doctorId: DRA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(updated[0].doctor, { connect: { id: DRA } });
});

test("editar · un DOCTOR sigue sin tocar la cita de OTRO doctor", async () => {
  session.user.role = "DOCTOR";
  session.user.id = DRA;
  existente({ doctorId: DR2 });
  const r = await patch({ doctorId: DRA });
  assert.equal(r.status, 403);
  assert.equal(updated.length, 0);
});

test("bandera · mover una «Sin doctor» encima de otra «Sin doctor» sin sillón no pregunta ni la marca", async () => {
  bandera = true;
  existente({ startsAt: new Date(martes("09:00")), endsAt: new Date(martes("09:30")) });
  ocupadas = [otraSinDoctor()];
  const r = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30") });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, undefined);
});
