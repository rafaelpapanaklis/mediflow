/**
 * LAS REGLAS DE LA AGENDA VIVEN EN EL SERVIDOR — WS1-T3 (hallazgos N13, N1, N6).
 *
 * Run: npm run test:agenda-reglas-servidor
 *
 * El fallo, en una línea: varias reglas de agendar vivían SOLO en el formulario
 * y el servidor aceptaba todo lo demás. Mientras el único que escribía era la
 * pantalla no se notaba; en cuanto escriba otro —Sabina, una integración, un
 * `curl`— agendaba en el pasado, a pacientes archivados y movía citas ya
 * completadas o canceladas (esto último, además, volvía a encolar recordatorios).
 *
 * Cómo prueba: llama a los HANDLERS REALES de `POST /api/appointments` y
 * `PATCH /api/appointments/:id` con `mock.module` sobre prisma, la sesión y los
 * efectos secundarios, y con cuerpos armados a mano — como lo haría alguien que
 * NO es el formulario. Cada regla tiene su caso en rojo (con el código de antes
 * respondía 201/200) y los caminos que HOY funcionan tienen su caso de control,
 * que tiene que seguir en verde: el modal Nueva cita, /dashboard/appointments,
 * el arrastre de la Agenda y el modal Editar.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Un instante redondo al minuto, relativo a ahora: los casos no dependen de la hora a la que se corran. */
function atMinute(offsetMs: number): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / MIN) * MIN);
}

// ── Estado del doble ────────────────────────────────────────────────────────
let patientRow: { id: string; status: string } | null;
let existingRow: any;
/** Estado del paciente de `existingRow`. Solo llega si el handler lo pide con `include`. */
let existingPatientStatus: string;
let created: any[];
let updated: any[];
let reschedules: any[];

beforeEach(() => {
  patientRow = { id: "p1", status: "ACTIVE" };
  existingRow = null;
  existingPatientStatus = "ACTIVE";
  created = [];
  updated = [];
  reschedules = [];
});

function apptRow(data: any) {
  return {
    id: "a1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    type: "Consulta general",
    notes: null,
    overrideReason: null,
    patient: { id: "p1", firstName: "Ana", lastName: "García", visibleUserIds: [] },
    doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
    ...data,
  };
}

const prismaStub: any = {
  patient: {
    findFirst: async () => patientRow,
  },
  user: {
    findFirst: async ({ where }: any) => (where.id === "d1" || where.id === "d2" ? { id: where.id } : null),
  },
  resource: {
    findFirst: async ({ where }: any) => ({ id: where.id }),
  },
  appointment: {
    // Honra el `include`: si el PATCH deja de pedir el estado del paciente, la
    // regla de archivado no puede verlo y su prueba se pone en rojo.
    findFirst: async ({ include }: any = {}) =>
      existingRow && {
        ...existingRow,
        ...(include?.patient?.select?.status ? { patient: { status: existingPatientStatus } } : {}),
      },
    findUnique: async () => null,
    findMany: async () => [],
  },
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        create: async ({ data }: any) => {
          created.push(data);
          return apptRow({ ...data, id: "nueva" });
        },
        update: async ({ data }: any) => {
          updated.push(data);
          return apptRow({
            ...existingRow,
            ...(data.startsAt ? { startsAt: data.startsAt } : {}),
            ...(data.endsAt ? { endsAt: data.endsAt } : {}),
            ...(data.type !== undefined ? { type: data.type } : {}),
          });
        },
      },
    }),
};

const session = {
  user: {
    id: "u-recep",
    role: "RECEPTIONIST",
    clinicId: "c1",
    displayName: "Recepción",
    permissionsOverride: [],
  },
  clinic: {
    id: "c1",
    name: "Clínica QA",
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
  namedExports: {
    loadClinicSession: async () => session,
    requireRole: () => null,
  },
});
(mock as any).module("@/lib/auth/require-permission", {
  namedExports: { denyIfMissingPermission: () => null },
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
(mock as any).module("@/lib/agenda/resource-schedule.server", {
  namedExports: { loadResourceSchedule: async () => [] },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
(mock as any).module("@/lib/agenda/google-sync", {
  namedExports: {
    syncCreateToGoogleCalendar: async () => undefined,
    syncUpdateToGoogleCalendar: async () => undefined,
    syncDeleteFromGoogleCalendar: async () => undefined,
  },
});
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: {
    applyReminderReschedule: async (_tx: any, args: any) => {
      reschedules.push(args);
    },
    cancelPendingRemindersForAppointment: async () => undefined,
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
  const res = await PATCH(req(body), { params: { id: "a1" } });
  return { status: res.status, body: await res.json() };
}

/** Un error de regla tiene que decir CUÁL regla, con un código estable y una frase legible. */
function assertRuleError(
  r: { status: number; body: any },
  status: number,
  code: string,
  etiqueta: string,
) {
  assert.equal(r.status, status, `${etiqueta}: HTTP ${status} (llegó ${r.status} ${JSON.stringify(r.body)})`);
  assert.equal(r.body.error, code, `${etiqueta}: error "${code}"`);
  assert.equal(typeof r.body.reason, "string", `${etiqueta}: trae una frase en "reason"`);
  assert.ok(r.body.reason.length > 10, `${etiqueta}: la frase no está vacía`);
  assert.notEqual(r.body.error, "forbidden", `${etiqueta}: no se confunde con falta de permiso`);
}

function futureBody(extra: Record<string, unknown> = {}) {
  const startsAt = atMinute(2 * DAY);
  return {
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    reason: "Limpieza",
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/appointments
// ═══════════════════════════════════════════════════════════════════════════

test("control · POST como el modal Nueva cita (futuro, con motivo) sigue creando", async () => {
  const r = await post({ ...futureBody(), isTeleconsult: false, notifyPatient: false });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "Limpieza");
});

test("control · POST como /dashboard/appointments (hora de pared, sin sillón) sigue creando", async () => {
  const d = atMinute(3 * DAY);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const r = await post({
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    date,
    startTime: "10:00",
    durationMins: 30,
    endTime: "10:30",
    reason: "Consulta general",
    notes: null,
    isTeleconsult: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(created.length, 1);
});

test("N13 · POST en el pasado → 422 appointment_in_past, y no se crea nada", async () => {
  const startsAt = atMinute(-1 * DAY);
  const r = await post(
    futureBody({
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    }),
  );
  assertRuleError(r, 422, "appointment_in_past", "pasado");
  assert.equal(created.length, 0, "no debe escribir la cita");
});

test("control · POST en el hueco que está corriendo (clic en las 10:00 a las 10:25, se guarda a las 10:40) sigue creando", async () => {
  // Huecos de 30 min → tolerancia 45 min: el hueco en curso más el rato de llenar el formulario.
  const startsAt = atMinute(-40 * MIN);
  const r = await post(
    futureBody({
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    }),
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test("N13 · POST en un hueco que ya quedó atrás (hace 1 h, huecos de 30) → 422 appointment_in_past", async () => {
  const startsAt = atMinute(-60 * MIN);
  const r = await post(
    futureBody({
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    }),
  );
  assertRuleError(r, 422, "appointment_in_past", "hueco anterior");
  assert.equal(created.length, 0);
});

test("N13 · POST a un paciente ARCHIVADO → 422 patient_archived, y no se crea nada", async () => {
  patientRow = { id: "p1", status: "ARCHIVED" };
  const r = await post(futureBody());
  assertRuleError(r, 422, "patient_archived", "archivado");
  assert.equal(created.length, 0, "no debe escribir la cita");
});

test("control · POST a un paciente INACTIVO sigue creando (solo se bloquea ARCHIVADO)", async () => {
  patientRow = { id: "p1", status: "INACTIVE" };
  const r = await post(futureBody());
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test("motivo · POST sin motivo → 400 missing_reason (antes guardaba «Consulta general» sin preguntar)", async () => {
  const sinMotivo: Record<string, unknown> = futureBody();
  delete sinMotivo.reason;
  const r = await post(sinMotivo);
  assertRuleError(r, 400, "missing_reason", "sin motivo");
  assert.equal(created.length, 0);
});

test("motivo · POST con motivo en blanco → 400 missing_reason (antes guardaba un motivo vacío)", async () => {
  const r = await post(futureBody({ reason: "   " }));
  assertRuleError(r, 400, "missing_reason", "motivo en blanco");
  assert.equal(created.length, 0);
});

test("sillón · POST sin sillón sigue creando (NO se sube al servidor: rompería /dashboard/appointments)", async () => {
  const r = await post(futureBody({ resourceId: null }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/appointments/:id
// ═══════════════════════════════════════════════════════════════════════════

function existing(status: string, startsAt: Date, extra: Record<string, unknown> = {}) {
  existingRow = apptRow({
    status,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * MIN),
    ...extra,
  });
  return existingRow;
}

for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW"]) {
  test(`N1 · PATCH que MUEVE una cita ${status} → 409 appointment_not_movable, sin tocar recordatorios`, async () => {
    existing(status, atMinute(-1 * DAY));
    const to = atMinute(2 * DAY);
    const r = await patch({
      startsAt: to.toISOString(),
      endsAt: new Date(to.getTime() + 30 * MIN).toISOString(),
    });
    assertRuleError(r, 409, "appointment_not_movable", status);
    assert.equal(r.body.status, status, "dice en qué estado está la cita");
    assert.equal(updated.length, 0, "no debe escribir");
    assert.equal(reschedules.length, 0, "no debe volver a encolar recordatorios");
  });
}

test("N1 · PATCH que cambia el DOCTOR de una cita COMPLETED → 409 appointment_not_movable", async () => {
  existing("COMPLETED", atMinute(-1 * DAY));
  const r = await patch({ doctorId: "d2" });
  assertRuleError(r, 409, "appointment_not_movable", "doctor de completada");
  assert.equal(updated.length, 0);
});

test("control · modal Editar sobre una COMPLETED: cambiar solo el motivo (reenvía hora y doctor iguales) sigue guardando", async () => {
  const e = existing("COMPLETED", atMinute(-1 * DAY));
  const r = await patch({
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    doctorId: "d1",
    resourceId: null,
    reason: "Limpieza profunda",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(updated.length, 1);
  assert.equal(reschedules.length, 0);
});

test("control · modal Editar sobre una COMPLETED de 10 min: redondea la duración a 15 y reenvía otro fin, y sigue guardando", async () => {
  const start = atMinute(-1 * DAY);
  existing("COMPLETED", start, { endsAt: new Date(start.getTime() + 10 * MIN) });
  const r = await patch({
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 15 * MIN).toISOString(),
    doctorId: "d1",
    resourceId: null,
    reason: "Revisión",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("control · /dashboard/appointments editando las notas de una COMPLETED (hora de pared igual) sigue guardando", async () => {
  // 10:00 de la clínica, hace dos días.
  const d = atMinute(-2 * DAY);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const startsAt = new Date(`${date}T16:00:00.000Z`); // CDMX = UTC−6 todo el año
  existing("COMPLETED", startsAt);
  const r = await patch({
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    date,
    startTime: "10:00",
    durationMins: 30,
    endTime: "10:30",
    reason: "Consulta general",
    notes: "llegó tarde",
    isTeleconsult: false,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("control · arrastre de la Agenda: mover una SCHEDULED a mañana sigue funcionando y reprograma recordatorios", async () => {
  existing("SCHEDULED", atMinute(1 * DAY));
  const to = atMinute(1 * DAY + 60 * MIN);
  const r = await patch({
    startsAt: to.toISOString(),
    endsAt: new Date(to.getTime() + 30 * MIN).toISOString(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reschedules.length, 1);
});

test("N13 · PATCH que mueve una SCHEDULED al pasado → 422 appointment_in_past", async () => {
  existing("SCHEDULED", atMinute(1 * DAY));
  const to = atMinute(-1 * DAY);
  const r = await patch({
    startsAt: to.toISOString(),
    endsAt: new Date(to.getTime() + 30 * MIN).toISOString(),
  });
  assertRuleError(r, 422, "appointment_in_past", "mover al pasado");
  assert.equal(updated.length, 0);
});

test("control · PATCH de una SCHEDULED que ya pasó (el paciente no llegó) a una hora futura sigue funcionando", async () => {
  existing("SCHEDULED", atMinute(-3 * 60 * MIN));
  const to = atMinute(2 * 60 * MIN);
  const r = await patch({
    startsAt: to.toISOString(),
    endsAt: new Date(to.getTime() + 30 * MIN).toISOString(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("control · PATCH que alarga una consulta EN CURSO (el inicio ya pasó y no cambia) sigue funcionando", async () => {
  const e = existing("IN_PROGRESS", atMinute(-20 * MIN));
  const r = await patch({
    startsAt: e.startsAt.toISOString(),
    endsAt: new Date(e.startsAt.getTime() + 60 * MIN).toISOString(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("N13 · PATCH que reagenda la cita de un paciente ARCHIVADO → 422 patient_archived", async () => {
  existing("SCHEDULED", atMinute(-1 * DAY));
  existingPatientStatus = "ARCHIVED";
  const to = atMinute(2 * DAY);
  const r = await patch({
    startsAt: to.toISOString(),
    endsAt: new Date(to.getTime() + 30 * MIN).toISOString(),
  });
  assertRuleError(r, 422, "patient_archived", "reagendar archivado");
  assert.equal(updated.length, 0);
});

test("motivo · PATCH que borra el motivo (\"\" o null) → 400 missing_reason", async () => {
  existing("SCHEDULED", atMinute(1 * DAY));
  for (const reason of ["", null, "  "]) {
    const r = await patch({ reason });
    assertRuleError(r, 400, "missing_reason", `motivo ${JSON.stringify(reason)}`);
  }
  assert.equal(updated.length, 0);
});

test("control · cita vieja que YA tenía el motivo vacío: /dashboard/appointments reenvía \"\" al corregir notas y sigue guardando", async () => {
  const e = existing("SCHEDULED", atMinute(1 * DAY), { type: "" });
  const r = await patch({
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    reason: "",
    notes: "trae radiografía",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

// ═══════════════════════════════════════════════════════════════════════════
// Pantallas: que el error nuevo se LEA, no «[object Object]» ni un código crudo
// ═══════════════════════════════════════════════════════════════════════════

const SRC = join(__dirname, "..", "..", "..", "..");
/** El archivo sin comentarios: la prosa que explica el arreglo no debe hacer fallar la prueba. */
function codigo(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

test("N6 · /dashboard/appointments pinta el TEXTO del aviso de horario, no «[object Object]»", () => {
  const src = codigo("app/dashboard/appointments/appointments-client.tsx");
  assert.ok(
    !/String\(\s*body\.scheduleWarning\s*\)/.test(src),
    "sigue convirtiendo el objeto scheduleWarning a string → «[object Object]»",
  );
  const usos = src.match(/body\.scheduleWarning\??\.message/g) ?? [];
  assert.ok(usos.length >= 2, "alta y edición tienen que mostrar scheduleWarning.message");
});

test("pantallas · el modal Nueva cita y el arrastre de la Agenda muestran la frase de la regla", () => {
  const dialog = codigo("components/dashboard/new-appointment/new-appointment-dialog.tsx");
  // El 422 (pasado, archivado) se atiende DENTRO de su bloque: ese bloque ya
  // consumió el cuerpo, y releerlo en el `!res.ok` de abajo daría {} y el genérico.
  const bloque422 = dialog.slice(dialog.indexOf("res.status === 422"), dialog.indexOf("if (!res.ok)"));
  assert.ok(bloque422.length > 0, "Nueva cita: no se encontró el bloque del 422");
  assert.ok(/bookingRuleMessage\(/.test(bloque422), "Nueva cita: el 422 debe mostrar la frase de la regla");
  const bloqueResto = dialog.slice(dialog.indexOf("if (!res.ok)"));
  assert.ok(/bookingRuleMessage\(/.test(bloqueResto), "Nueva cita: el 400 de motivo debe mostrar su frase");
  const agenda = codigo("app/dashboard/agenda/agenda-page-client.tsx");
  assert.ok(/bookingRuleMessage\(/.test(agenda), "arrastre: debe traducir el error de regla a su frase");
});
