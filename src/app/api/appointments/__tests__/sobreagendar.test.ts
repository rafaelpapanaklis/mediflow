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
/** La lectura de la bandera revienta (timeout del pooler, etc.). */
let banderaFalla: boolean;

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
  banderaFalla = false;
  horarioSillon = null;
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

/**
 * La constraint de verdad: `WHERE "overrideReason" IS NULL`. Un "" NO es NULL
 * (revisión t8, A12: el doble viejo lo trataba como NULL y la prueba no
 * demostraba nada).
 */
function choca(data: any): boolean {
  return constraintChoca && data.overrideReason == null;
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
          // `soloMarcadas`: solo las que llevan la marca (el filtro de verdad).
          (!where.overrideReason?.startsWith || String(a.overrideReason ?? "").startsWith(where.overrideReason.startsWith)) &&
          new Date(a.startsAt) < where.startsAt.lt &&
          new Date(a.endsAt) > where.endsAt.gt &&
          (!where.OR || where.OR.some((o: any) => (o.doctorId && o.doctorId === a.doctorId) || (o.resourceId && o.resourceId === a.resourceId))),
      ).map((a) => ({ ...a, startsAt: new Date(a.startsAt), endsAt: new Date(a.endsAt) })),
  },
  agendaBlock: { findMany: async () => [] },
  agendaBlockPolicy: { findUnique: async () => null },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) => {
      if (banderaFalla) throw Object.assign(new Error("timeout"), { code: "P1008" });
      return bandera && where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : [];
    },
  },
  doctorSchedule: {
    findMany: async () =>
      conComida ? [{ doctorId: "d1", dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00" }] : [],
  },
  // to_regclass / information_schema / la comida por SQL crudo (revisión t8, A13).
  $queryRaw: async (strings: TemplateStringsArray) => {
    const sql = strings.join("");
    if (sql.includes("to_regclass")) return [{ existe: true }];
    if (sql.includes('"lunchStart", "lunchEnd" FROM "doctor_schedules"')) {
      return conComida ? [{ doctorId: "d1", dayOfWeek: 1, lunchStart: "14:00", lunchEnd: "15:00" }] : [];
    }
    return [{ n: 2 }];
  },
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
/** Horario del sillón (null = siempre abierto). */
let horarioSillon: any = null;
(mock as any).module("@/lib/agenda/resource-schedule.server", { namedExports: { loadResourceSchedule: async () => horarioSillon } });
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

// ═══════════════════════════════════════════════════════════════════════
// REVISIÓN t8
// ═══════════════════════════════════════════════════════════════════════

test("t8 · A1 · cambiar SOLO el sillón de una sobreagendada a uno libre: 200 y la marca se queda", async () => {
  bandera = true;
  hayCitaDeMario();
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    resourceId: "s1",
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30"), resourceId: "s2", notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, undefined, "la marca no se toca: sigue encima de Mario");
});

test("t8 · A1 · lo mismo con la bandera ya apagada", async () => {
  hayCitaDeMario();
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    resourceId: "s1",
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ resourceId: "s2", notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, undefined);
});

test("t8 · A2 · una cita que cruza la comida y además se sale del horario pide el «¿Seguro?»", async () => {
  bandera = true;
  conComida = true;
  const startsAt = martes("13:00");
  const body = { ...alta("13:00"), endsAt: martes("18:30") };
  const r = await post(body);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "lunch_overlap");
  assert.deepEqual(r.body.comida, { lunchStart: "14:00", lunchEnd: "15:00" });
  const ok = await post({ ...body, sobreagendar: true, sobreagendarCita: null });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(auditorias[0].after.sobreagendada.enComida, { lunchStart: "14:00", lunchEnd: "15:00" });
  assert.match(ok.body.scheduleWarning?.message ?? "", /termina después de que salga el doctor/, "el aviso de fuera de horario se sigue dando");
  void startsAt;
});

test("t8 · A4 · la marca de sobreagendada NO salta el horario del sillón", async () => {
  bandera = true;
  horarioSillon = { days: { 0: [], 1: [{ startTime: "09:00", endTime: "18:00" }], 2: [], 3: [], 4: [], 5: [], 6: [] } };
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    resourceId: "s1",
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ startsAt: martes("19:00"), endsAt: martes("19:30"), notifyPatient: false });
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.error, "resource_unavailable");
});

test("t8 · A7 · si entró otra cita más mientras se decidía, se vuelve a preguntar", async () => {
  bandera = true;
  hayCitaDeMario();
  ocupadas.push({ ...ocupadas[0], id: "a-zeta", startsAt: martes("10:00"), endsAt: martes("10:30") });
  const r = await post(alta("10:00", { sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 0 }));
  assert.equal(r.status, 409);
  assert.equal(r.body.conflictingAppointment.otras, 1);
  const ok = await post(alta("10:00", { sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 1 }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test("t8 · A12 · `overrideReason` vacío o de espacios es «sin motivo» (POST y PATCH)", async () => {
  hayCitaDeMario();
  // ADMIN: con RECEPTIONIST el "   " ya lo paraba el 403 de rol y la prueba
  // no demostraba el arreglo (segunda vuelta t8).
  session.user.role = "ADMIN";
  for (const vacio of ["   ", ""]) {
    const r = await post(alta("10:00", { overrideReason: vacio }));
    assert.equal(r.status, 409, `«${vacio}»: la constraint lo para como a cualquier otro choque`);
  }
  assert.equal(created.length, 0);
  existingRow = apptRow({ startsAt: new Date(martes("12:00")), endsAt: new Date(martes("12:30")) });
  const p = await patch({ startsAt: martes("10:00"), endsAt: martes("10:30"), overrideReason: "", notifyPatient: false });
  assert.equal(p.status, 409);
  assert.equal(updated.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// SEGUNDA VUELTA t8
// ═══════════════════════════════════════════════════════════════════════

test("t8-2 · N-A2 · bandera APAGADA: cambiar SOLO el sillón de una sobreagendada a uno ocupado por una cita NORMAL → 409, no se guarda encima", async () => {
  constraintChoca = true;
  ocupadas = [
    {
      id: "a-otro",
      clinicId: "c1",
      doctorId: "d2",
      resourceId: "s2",
      status: "CONFIRMED",
      overrideReason: null,
      startsAt: martes("10:00"),
      endsAt: martes("10:30"),
      patient: { firstName: "Raúl", lastName: "Soto", visibleUserIds: [] },
    },
  ];
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    resourceId: "s1",
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ resourceId: "s2", notifyPatient: false });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "appointment_overlap");
  assert.equal(r.body.conflictingAppointment.id, "a-otro");
  assert.equal(r.body.sobreagendable, undefined, "sin bandera no se pregunta");
  assert.equal(updated.length, 0);
});

test("t8-2 · N-A2 · control: al sillón LIBRE sí se cambia (y la marca se queda)", async () => {
  constraintChoca = true;
  existingRow = apptRow({
    startsAt: new Date(martes("10:00")),
    endsAt: new Date(martes("10:30")),
    resourceId: "s1",
    overrideReason: "Sobreagendada por el equipo",
  });
  const r = await patch({ resourceId: "s3", notifyPatient: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated[0].overrideReason, undefined);
});

test("t8-2 · A2 · PATCH: mover una cita a cruzar la comida (saliéndose además del horario) pide el «¿Seguro?»", async () => {
  bandera = true;
  conComida = true;
  existingRow = apptRow({ startsAt: new Date(martes("11:00")), endsAt: new Date(martes("11:30")) });
  const r = await patch({ startsAt: martes("13:00"), endsAt: martes("18:30"), notifyPatient: false });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "lunch_overlap");
  assert.deepEqual(r.body.comida, { lunchStart: "14:00", lunchEnd: "15:00" });
  assert.equal(updated.length, 0);
  const ok = await patch({ startsAt: martes("13:00"), endsAt: martes("18:30"), notifyPatient: false, sobreagendar: true, sobreagendarCita: null });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(updated[0].overrideReason, undefined, "solo la comida: sin marca");
  assert.deepEqual(auditorias[0].after.sobreagendada.enComida, { lunchStart: "14:00", lunchEnd: "15:00" });
});

test("t8-2 · A9 · dos fallos seguidos de la bandera en una instancia nueva NO dejan el «apagada» 60 s", async () => {
  const { leerAgendaFlexible } = await import("@/lib/agenda/agenda-flexible.server");
  let ahora = 1_000_000;
  const reloj = mock.method(Date, "now", () => ahora);
  try {
    banderaFalla = true;
    assert.equal((await leerAgendaFlexible("c1")).encendida, false, "1.er fallo: apagada");
    ahora += 6_000;
    assert.equal((await leerAgendaFlexible("c1")).encendida, false, "2.º fallo: apagada");
    // La base vuelve; la bandera está encendida.
    banderaFalla = false;
    bandera = true;
    ahora += 6_000;
    assert.equal((await leerAgendaFlexible("c1")).encendida, true, "a los pocos segundos se vuelve a preguntar");
    // Con una lectura buena, un fallo después conserva lo último que se leyó.
    banderaFalla = true;
    ahora += 61_000;
    assert.equal((await leerAgendaFlexible("c1")).encendida, true);
  } finally {
    reloj.mock.restore();
  }
});

test("t8-2 · A5 · la pantalla vieja «Citas» traduce los 409 REALES (comida y choque) y dice dónde sobreagendar", async () => {
  const { apiErrorMessage } = await import("@/app/dashboard/appointments/mensaje-error-citas");
  bandera = true;
  conComida = true;
  const comida = await post(alta("14:00"));
  assert.equal(
    apiErrorMessage(comida.status, comida.body, "x"),
    "Esa hora es la comida del doctor (de 14:00 a 15:00). Elige otra hora. Si necesitas sobreagendar, hazlo desde la Agenda.",
  );
  hayCitaDeMario();
  const choque = await post(alta("10:00"));
  assert.match(apiErrorMessage(choque.status, choque.body, "x"), /^Ese horario ya está ocupado: Mario López de .+\. Elige otra hora\. Si necesitas sobreagendar, hazlo desde la Agenda\.$/);
  bandera = false;
  (globalThis as any)[Symbol.for("dalecontrol.agenda.flexible")] = undefined;
  const sinBandera = await post(alta("10:00"));
  assert.doesNotMatch(apiErrorMessage(sinBandera.status, sinBandera.body, "x"), /sobreagendar/, "sin la bandera no se ofrece");
});
