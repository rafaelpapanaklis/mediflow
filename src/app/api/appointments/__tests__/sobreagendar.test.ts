/**
 * SOBREAGENDAR EN EL SERVIDOR — WS1-T5 (grupo Salamanca).
 *
 * Run: npm run test:salamanca-agenda
 *
 * Llama a los HANDLERS REALES de `POST /api/appointments` y `PATCH
 * /api/appointments/:id` con `mock.module` sobre prisma, la sesión y los
 * efectos secundarios (el mismo arnés que reglas-servidor.test.ts). Fija:
 *  · SIN la bandera `agenda-flexible`, nada cambia: `sobreagendar: true` en el
 *    cuerpo no salta el no-solape (409 de siempre, sin `sobreagendable`);
 *  · CON la bandera, un choque sin confirmar da 409 `sobreagendable` y no
 *    escribe nada; confirmado, se guarda con la marca y queda en la bitácora;
 *  · la hora de comida se trata igual (409 `lunch_overlap` → confirmar);
 *  · mover una sobreagendada a un hueco libre le quita la marca, y corregir
 *    sus notas sin moverla no vuelve a preguntar.
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

// ── Estado del doble ────────────────────────────────────────────────────────
let bandera: boolean;
/** Citas vivas en la base (para el pre-chequeo de choques). */
let ocupadas: any[];
/** ¿La constraint de la base rechaza un INSERT/UPDATE sin overrideReason? */
let constraintChoca: boolean;
let conComida: boolean;
let existingRow: any;
let created: any[];
let updated: any[];
let auditorias: any[];

const CLAVE_COLUMNAS = Symbol.for("dalecontrol.horarioDoctor.columnasComida");
const CLAVE_FLEX = Symbol.for("dalecontrol.agenda.flexible");

beforeEach(() => {
  bandera = false;
  ocupadas = [];
  constraintChoca = false;
  conComida = false;
  existingRow = null;
  created = [];
  updated = [];
  auditorias = [];
  session.user.role = "RECEPTIONIST";
  // El lector de la bandera y la sonda de columnas recuerdan en `globalThis`.
  (globalThis as any)[CLAVE_FLEX] = undefined;
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: true, at: Date.now() };
});

function apptRow(data: any) {
  return {
    id: "a1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    type: "Limpieza",
    notes: null,
    status: "SCHEDULED",
    overrideReason: null,
    patient: { id: "p1", firstName: "Ana", lastName: "García", visibleUserIds: [] },
    doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
    ...data,
  };
}

function choca(data: any): boolean {
  return constraintChoca && !data.overrideReason;
}

const prismaStub: any = {
  patient: { findFirst: async () => ({ id: "p1", status: "ACTIVE" }) },
  user: { findFirst: async ({ where }: any) => (where.id === "d1" ? { id: "d1" } : null) },
  resource: { findFirst: async ({ where }: any) => ({ id: where.id }) },
  appointment: {
    findFirst: async ({ include }: any = {}) =>
      existingRow && { ...existingRow, ...(include?.patient?.select?.status ? { patient: { status: "ACTIVE" } } : {}) },
    findUnique: async () => null,
    // El pre-chequeo de sobreagendar: devuelve las vivas que pisan el rango,
    // también las forzadas (eso es justo lo que la constraint no ve).
    findMany: async ({ where }: any) =>
      ocupadas.filter(
        (a) =>
          a.clinicId === where.clinicId &&
          (!where.id?.not || a.id !== where.id.not) &&
          new Date(a.startsAt) < where.startsAt.lt &&
          new Date(a.endsAt) > where.endsAt.gt &&
          (!where.OR || where.OR.some((o: any) => (o.doctorId && o.doctorId === a.doctorId) || (o.resourceId && o.resourceId === a.resourceId))),
      ).map((a) => ({ ...a, startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) })),
  },
  agendaBlock: { findMany: async () => [] },
  agendaBlockPolicy: { findUnique: async () => null },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) =>
      bandera && where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : [],
  },
  doctorSchedule: {
    findMany: async ({ select }: any) =>
      conComida
        ? [
            {
              doctorId: "d1",
              dayOfWeek: 1,
              enabled: true,
              openTime: "09:00",
              closeTime: "18:00",
              ...(select?.lunchStart ? { lunchStart: "14:00", lunchEnd: "15:00" } : {}),
            },
          ]
        : [],
  },
  $queryRaw: async (strings: TemplateStringsArray) =>
    strings.join("").includes("to_regclass") ? [{ existe: true }] : [{ n: 2 }],
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        create: async ({ data }: any) => {
          if (choca(data)) throw Object.assign(new Error("exclusion constraint"), { code: "23P01" });
          created.push(data);
          return apptRow({ ...data, id: "nueva" });
        },
        update: async ({ data }: any) => {
          if (choca({ overrideReason: data.overrideReason === undefined ? existingRow.overrideReason : data.overrideReason })) {
            throw Object.assign(new Error("exclusion constraint"), { code: "23P01" });
          }
          updated.push(data);
          return apptRow({ ...existingRow, ...(data.startsAt ? { startsAt: data.startsAt } : {}), ...(data.endsAt ? { endsAt: data.endsAt } : {}) });
        },
      },
    }),
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
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
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
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { applyReminderReschedule: async () => undefined, cancelPendingRemindersForAppointment: async () => undefined },
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
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 30 * MIN).toISOString(),
    reason: "Limpieza",
    ...extra,
  };
}

/** La cita de Mario a las 10:00 del mismo doctor: lo que hay en la base y lo que hace chocar a la constraint. */
function hayCitaDeMario() {
  constraintChoca = true;
  ocupadas = [
    {
      id: "a-mario",
      clinicId: "c1",
      doctorId: "d1",
      resourceId: null,
      status: "CONFIRMED",
      overrideReason: null,
      startsAt: martes("10:00"),
      endsAt: martes("10:30"),
      patient: { firstName: "Mario", lastName: "López", visibleUserIds: [] },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════
// SIN LA BANDERA — todo como siempre
// ═══════════════════════════════════════════════════════════════════════

test("sin bandera · el choque da el 409 de siempre, SIN `sobreagendable`", async () => {
  hayCitaDeMario();
  const r = await post(alta("10:00"));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "appointment_overlap");
  assert.equal(r.body.sobreagendable, undefined);
  assert.equal(created.length, 0);
});

test("sin bandera · `sobreagendar: true` en el cuerpo NO salta el no-solape (ni escribe la marca)", async () => {
  hayCitaDeMario();
  const r = await post(alta("10:00", { sobreagendar: true }));
  assert.equal(r.status, 409);
  assert.equal(created.length, 0);
});

test("sin bandera · un hueco libre se crea igual que siempre, sin marca", async () => {
  const r = await post(alta("11:00"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created[0].overrideReason, null);
  assert.equal(auditorias[0].after.sobreagendada, undefined);
});

// ═══════════════════════════════════════════════════════════════════════
// CON LA BANDERA
// ═══════════════════════════════════════════════════════════════════════

test("bandera · choque sin confirmar → 409 `sobreagendable` con la otra cita, y no se escribe nada", async () => {
  bandera = true;
  hayCitaDeMario();
  const r = await post(alta("10:00"));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "appointment_overlap");
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.patientName, "Mario López");
  assert.equal(created.length, 0);
});

test("bandera · confirmado → 201 con la MARCA del servidor y el rastro en la bitácora", async () => {
  bandera = true;
  hayCitaDeMario();
  const r = await post(alta("10:00", { sobreagendar: true, sobreagendarCita: "a-mario" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.sobreagendada, true);
  assert.equal(created[0].overrideReason, "Sobreagendada por el equipo");
  assert.equal(created[0].overriddenBy, "u-recep");
  assert.deepEqual(auditorias[0].after.sobreagendada, { conCita: "a-mario", enComida: null });
});

test("bandera · la confirmación vale para la cita que se ENSEÑÓ: con otra (o sin decir cuál) se vuelve a preguntar", async () => {
  bandera = true;
  hayCitaDeMario();
  for (const cuerpo of [{ sobreagendar: true }, { sobreagendar: true, sobreagendarCita: "otra" }, { sobreagendar: true, sobreagendarCita: null }]) {
    const r = await post(alta("10:00", cuerpo));
    assert.equal(r.status, 409, JSON.stringify(cuerpo));
    assert.equal(r.body.sobreagendable, true);
    assert.equal(r.body.conflictingAppointment.id, "a-mario");
  }
  assert.equal(created.length, 0);
});

test("bandera · una sobreagendada sola en el hueco (la original se canceló) también choca", async () => {
  bandera = true;
  ocupadas = [
    {
      id: "a-sobre",
      clinicId: "c1",
      doctorId: "d1",
      resourceId: null,
      status: "SCHEDULED",
      overrideReason: "Sobreagendada por el equipo",
      startsAt: martes("10:00"),
      endsAt: martes("10:30"),
      patient: { firstName: "Eva", lastName: "Paz", visibleUserIds: [] },
    },
  ];
  // La constraint NO la ve (lleva overrideReason): el aviso sale del pre-chequeo.
  const r = await post(alta("10:00"));
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "a-sobre");
  assert.equal(created.length, 0);
});

test("bandera · el `overrideReason` de administración sigue su camino (sin pregunta)", async () => {
  bandera = true;
  hayCitaDeMario();
  session.user.role = "ADMIN";
  const r = await post(alta("10:00", { overrideReason: "Urgencia autorizada" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created[0].overrideReason, "Urgencia autorizada");
});

test("comida · en la hora de comida → 409 `lunch_overlap` con el tramo; confirmado → se guarda SIN marca (no hay otra cita)", async () => {
  bandera = true;
  conComida = true;
  const r = await post(alta("14:00"));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "lunch_overlap");
  assert.equal(r.body.sobreagendable, true);
  assert.deepEqual(r.body.comida, { lunchStart: "14:00", lunchEnd: "15:00" });
  assert.equal(created.length, 0);

  const ok = await post(alta("14:00", { sobreagendar: true, sobreagendarCita: null }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(created[0].overrideReason, null);
  assert.equal(ok.body.sobreagendada, undefined, "solo la comida: no son «dos citas a la misma hora»");
  assert.deepEqual(auditorias[0].after.sobreagendada, { conCita: null, enComida: { lunchStart: "14:00", lunchEnd: "15:00" } });
  assert.equal(ok.body.scheduleWarning, null, "ya se confirmó: sin el «Ojo, cae en la comida»");
});

test("comida · SIN bandera la comida no existe (el lector ni la pide): se crea a las 14:00", async () => {
  conComida = true;
  const r = await post(alta("14:00"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

// ═══════════════════════════════════════════════════════════════════════
// PATCH — mover y cambiar la duración
// ═══════════════════════════════════════════════════════════════════════

test("mover · encima de otra sin confirmar → 409 `sobreagendable`; confirmado → con la marca", async () => {
  bandera = true;
  hayCitaDeMario();
  existingRow = apptRow({ startsAt: new Date(martes("12:00")), endsAt: new Date(martes("12:30")) });
  const r = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30"), notifyPatient: false });
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, true);
  assert.equal(updated.length, 0);

  const ok = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30"), notifyPatient: false, sobreagendar: true, sobreagendarCita: "a-mario" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(updated[0].overrideReason, "Sobreagendada por el equipo");
  assert.equal(auditorias[0].after.sobreagendada.conCita, "a-mario");
});

test("duración · alargarla hasta pisar la siguiente también pregunta", async () => {
  bandera = true;
  hayCitaDeMario();
  existingRow = apptRow({ startsAt: new Date(martes("09:30")), endsAt: new Date(martes("10:00")) });
  const r = await patch({ startsAt: martes("09:30"), endsAt: martes("10:15"), notifyPatient: false });
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, true);
});

test("mover · una sobreagendada a un hueco LIBRE pierde la marca (vuelve a ser normal)", async () => {
  bandera = true;
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ startsAt: martes("16:00"), endsAt: martes("16:30"), notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, null);
});

test("editar notas · una sobreagendada que NO se mueve guarda sin volver a preguntar", async () => {
  bandera = true;
  hayCitaDeMario();
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30"), notes: "Trae radiografía", notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, undefined, "la marca no se toca");
});

test("sin bandera · mover encima da el 409 de siempre aunque el cuerpo diga `sobreagendar`", async () => {
  hayCitaDeMario();
  existingRow = apptRow({ startsAt: new Date(martes("12:00")), endsAt: new Date(martes("12:30")) });
  const r = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30"), notifyPatient: false, sobreagendar: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, undefined);
  assert.equal(updated.length, 0);
});

function sobreagendadaSola() {
  ocupadas = [
    {
      id: "a-sobre",
      clinicId: "c1",
      doctorId: "d1",
      resourceId: "s1",
      status: "SCHEDULED",
      overrideReason: "Sobreagendada por el equipo",
      startsAt: martes("10:00"),
      endsAt: martes("10:30"),
      patient: { firstName: "Eva", lastName: "Paz", visibleUserIds: [] },
    },
  ];
}

test("bandera APAGADA después · una sobreagendada sola sigue parando la cita nueva (409 de siempre, sin pregunta)", async () => {
  sobreagendadaSola();
  const r = await post(alta("10:00"));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.sobreagendable, undefined);
  assert.equal(r.body.conflictingAppointment.id, "a-sobre");
  assert.equal(created.length, 0);
});

test("bandera APAGADA después · mover una sobreagendada a un hueco libre le quita la marca", async () => {
  existingRow = apptRow({ startsAt: new Date(martes("10:00")), endsAt: new Date(martes("10:30")), overrideReason: "Sobreagendada por el equipo" });
  const r = await patch({ startsAt: martes("16:00"), endsAt: martes("16:30"), notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, null);
});

test("sillón · cambiar SOLO el sillón a uno ocupado por una sobreagendada también pregunta (con bandera)", async () => {
  bandera = true;
  sobreagendadaSola();
  existingRow = apptRow({ doctorId: "d2", startsAt: new Date(martes("10:00")), endsAt: new Date(martes("10:30")), resourceId: "s2" });
  const r = await patch({ resourceId: "s1", notifyPatient: false });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "a-sobre");
});

test("varias encima · el 409 nombra la primera y cuenta las demás (el aviso lo dice)", async () => {
  bandera = true;
  hayCitaDeMario();
  ocupadas.push({ ...ocupadas[0], id: "a-luis", startsAt: martes("10:15"), endsAt: martes("10:45") });
  const r = await post(alta("10:00"));
  assert.equal(r.status, 409);
  assert.equal(r.body.conflictingAppointment.id, "a-mario");
  assert.equal(r.body.conflictingAppointment.otras, 1);
});

test("sillón · cambiar SOLO el sillón de una cita que ya estaba en la comida no vuelve a preguntar", async () => {
  bandera = true;
  conComida = true;
  existingRow = apptRow({ startsAt: new Date(martes("14:00")), endsAt: new Date(martes("14:30")), resourceId: "s2" });
  const r = await patch({ resourceId: "s1", notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("quitar la marca · solo toca una cita SOBREAGENDADA de ESA clínica", async () => {
  const { quitarMarcaDeSobreagenda } = await import("@/lib/agenda/sobreagendar.server");
  const llamadas: any[] = [];
  const tx = { appointment: { updateMany: async (args: any) => { llamadas.push(args); return { count: 1 }; } } };
  await quitarMarcaDeSobreagenda(tx, "a1", "c1");
  assert.deepEqual(llamadas[0].where, { id: "a1", clinicId: "c1", overrideReason: { startsWith: "Sobreagendada por el equipo" } });
  assert.deepEqual(llamadas[0].data, { overrideReason: null, overriddenBy: null, overriddenAt: null });
  await quitarMarcaDeSobreagenda(tx, "a1", "");
  assert.equal(llamadas.length, 1, "sin clínica no escribe nada");
});
