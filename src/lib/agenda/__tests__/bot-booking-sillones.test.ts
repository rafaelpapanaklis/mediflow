/**
 * ws1-t1 — el servicio de agenda del bot de WhatsApp (bot-booking-service.ts)
 * corriendo DE VERDAD sobre una base falsa en memoria:
 *  - #6: `listBookableDoctors` usa ROLES_QUE_ATIENDEN (el dueño que atiende sale).
 *  - #13: con sillones, `getAvailableSlots` no ofrece una hora sin sillón libre,
 *    y crear/reagendar sienta la cita en un sillón libre. Sin sillones, igual
 *    que antes (resourceId null).
 *
 * Se sustituyen Prisma, Google Calendar y la reprogramación de recordatorios.
 * `server-only` se neutraliza (no existe fuera del bundle de Next).
 *
 * Run: npm run test:wa-agenda-auditoria
 */
import Module from "node:module";
import path from "node:path";
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recursoLibre } from "../bot-recurso-libre";
import { tzLocalToUtc } from "../time-utils";

const RAIZ = path.resolve(__dirname, "../../../..");
const TZ = "America/Mexico_City";
const DIA = "2031-03-10"; // lunes, siempre en el futuro
type Fila = Record<string, any>;

const db = {
  users: [] as Fila[],
  resources: [] as Fila[],
  appointments: [] as Fila[],
  updates: [] as Fila[],
  /** Algo que pasa justo antes del update del reagendado (otra pantalla que cancela a la vez). */
  antesDeMover: null as (() => void) | null,
};

function a(hhmm: string, min = 30): { startsAt: Date; endsAt: Date } {
  const [h, m] = hhmm.split(":").map(Number);
  const startsAt = tzLocalToUtc(DIA, h, m, TZ);
  return { startsAt, endsAt: new Date(startsAt.getTime() + min * 60_000) };
}

function casaRol(rol: string, filtro: unknown): boolean {
  if (typeof filtro === "string") return rol === filtro;
  if (filtro && typeof filtro === "object" && Array.isArray((filtro as Fila).in)) return (filtro as Fila).in.includes(rol);
  return true;
}

function solapa(f: Fila, where: Fila): boolean {
  if (where.startsAt?.lt && !(f.startsAt < where.startsAt.lt)) return false;
  if (where.endsAt?.gt && !(f.endsAt > where.endsAt.gt)) return false;
  return true;
}

function citasQueCasan(where: Fila): Fila[] {
  return db.appointments.filter((f) => {
    if (where.clinicId && f.clinicId !== where.clinicId) return false;
    if (where.doctorId && f.doctorId !== where.doctorId) return false;
    if (where.resourceId?.in && !where.resourceId.in.includes(f.resourceId)) return false;
    if (where.id?.not && f.id === where.id.not) return false;
    if (where.id && typeof where.id === "string" && f.id !== where.id) return false;
    if (where.status?.notIn && where.status.notIn.includes(f.status)) return false;
    return solapa(f, where);
  });
}

const prismaDoble: Fila = {
  clinic: {
    findUnique: async () => ({
      timezone: TZ,
      agendaDayStart: 9,
      agendaDayEnd: 13,
      defaultSlotMinutes: 30,
      schedules: [],
      name: "Clínica Demo",
    }),
  },
  user: {
    findMany: async ({ where }: { where: Fila }) =>
      db.users.filter((u) => u.clinicId === where.clinicId && u.isActive && casaRol(u.role, where.role)),
    findFirst: async ({ where }: { where: Fila }) =>
      db.users.find((u) => u.id === where.id && u.clinicId === where.clinicId && u.isActive && casaRol(u.role, where.role)) ?? null,
  },
  patient: { findFirst: async () => ({ id: "pat1" }) },
  resource: {
    findMany: async ({ where }: { where: Fila }) =>
      db.resources.filter(
        (r) => r.clinicId === where.clinicId && r.isActive && (!where.kind?.in || where.kind.in.includes(r.kind)),
      ),
  },
  appointment: {
    findMany: async ({ where }: { where: Fila }) => citasQueCasan(where),
    findFirst: async ({ where }: { where: Fila }) => citasQueCasan(where)[0] ?? null,
    create: async ({ data }: { data: Fila }) => {
      const fila = { id: `appt${db.appointments.length + 1}`, ...data };
      db.appointments.push(fila);
      return { id: fila.id, deposits: [] };
    },
    update: async ({ where, data }: { where: Fila; data: Fila }) => {
      db.updates.push({ id: where.id, ...data });
      const fila = db.appointments.find((f) => f.id === where.id);
      if (fila) Object.assign(fila, data);
      return fila;
    },
    // Como la base: solo las filas que casan con el where (clinicId, id y estado).
    updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
      db.antesDeMover?.();
      const filas = citasQueCasan(where);
      for (const fila of filas) {
        db.updates.push({ id: fila.id, ...data });
        Object.assign(fila, data);
      }
      return { count: filas.length };
    },
  },
  $transaction: async (fn: (tx: Fila) => Promise<unknown>) => fn(prismaDoble),
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [path.join(RAIZ, "src/lib/agenda/google-sync.ts"), { sincronizarCitaEnSegundoPlano: async () => undefined }],
  [path.join(RAIZ, "src/lib/reminders/reschedule.server.ts"), { applyReminderReschedule: async () => undefined }],
]);

const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let svc: typeof import("../bot-booking-service");
before(async () => {
  svc = await import("../bot-booking-service");
});

beforeEach(() => {
  db.users = [
    { id: "docA", clinicId: "c1", role: "DOCTOR", isActive: true, firstName: "Ana", lastName: "A" },
    { id: "docB", clinicId: "c1", role: "DOCTOR", isActive: true, firstName: "Beto", lastName: "B" },
  ];
  db.resources = [];
  db.appointments = [];
  db.updates = [];
  db.antesDeMover = null;
});

function cita(id: string, doctorId: string, hhmm: string, resourceId: string | null): Fila {
  return { id, clinicId: "c1", doctorId, resourceId, status: "SCHEDULED", overrideReason: null, holdExpiresAt: null, ...a(hhmm) };
}

describe("#6 — listBookableDoctors con los mismos roles que el alta", () => {
  it("consultorio cuyo único profesional es el dueño (ADMIN): aparece (antes: «no hay profesionales»)", async () => {
    db.users = [{ id: "dueno", clinicId: "c1", role: "ADMIN", isActive: true, firstName: "Rafa", lastName: "R" }];
    const lista = await svc.listBookableDoctors("c1");
    assert.deepEqual(lista.map((d) => d.id), ["dueno"]);
  });

  it("recepción y asistentes siguen fuera", async () => {
    db.users.push({ id: "recep", clinicId: "c1", role: "RECEPTIONIST", isActive: true, firstName: "R", lastName: "R" });
    const lista = await svc.listBookableDoctors("c1");
    assert.deepEqual(lista.map((d) => d.id).sort(), ["docA", "docB"]);
  });
});

describe("#13 — sillones: no se ofrece una hora sin sillón libre y la cita se sienta en uno", () => {
  it("la reproducción de la auditoría: dos doctores y UN sillón — si docA tiene las 10:00, a docB no se le ofrecen", async () => {
    db.resources = [{ id: "s1", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] }];
    db.appointments = [cita("x1", "docA", "10:00", "s1")];
    const r = await svc.getAvailableSlots({ clinicId: "c1", doctorId: "docB", dateISO: DIA, durationMin: 30 });
    assert.equal(r.closed, false);
    assert.ok(!r.slots.includes("10:00"), `se ofreció 10:00 sin sillón libre: ${r.slots.join(", ")}`);
    assert.ok(r.slots.includes("09:30") && r.slots.includes("10:30"));
  });

  it("con dos sillones, la misma hora sí se ofrece (queda el otro)", async () => {
    db.resources = [
      { id: "s1", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] },
      { id: "s2", clinicId: "c1", kind: "CONSULTORIO_DENTAL", isActive: true, schedules: [] },
    ];
    db.appointments = [cita("x1", "docA", "10:00", "s1")];
    const r = await svc.getAvailableSlots({ clinicId: "c1", doctorId: "docB", dateISO: DIA, durationMin: 30 });
    assert.ok(r.slots.includes("10:00"));
  });

  it("un sillón con horario propio cerrado a esa hora no cuenta", async () => {
    db.resources = [
      {
        id: "s1", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true,
        // Lunes (0) solo de 11:00 a 13:00.
        schedules: [{ dayOfWeek: 0, startTime: "11:00", endTime: "13:00" }],
      },
    ];
    const r = await svc.getAvailableSlots({ clinicId: "c1", doctorId: "docB", dateISO: DIA, durationMin: 30 });
    assert.deepEqual(r.slots, ["11:00", "11:30", "12:00", "12:30"]);
  });

  it("sala de espera / radiografía no son sillones: la clínica que solo tiene eso sigue como antes", async () => {
    db.resources = [{ id: "sala", clinicId: "c1", kind: "SALA_DE_ESPERA", isActive: true, schedules: [] }];
    db.appointments = [cita("x1", "docA", "10:00", null)];
    const r = await svc.getAvailableSlots({ clinicId: "c1", doctorId: "docB", dateISO: DIA, durationMin: 30 });
    assert.ok(r.slots.includes("10:00"));
    const c = await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "docB", dateISO: DIA, time: "10:00", durationMin: 30 });
    assert.equal(c.ok, true);
    assert.equal(db.appointments.at(-1)?.resourceId, null);
  });

  it("crear: la cita queda en el sillón libre (antes resourceId null)", async () => {
    db.resources = [
      { id: "s1", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] },
      { id: "s2", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] },
    ];
    db.appointments = [cita("x1", "docA", "10:00", "s1")];
    const c = await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "docB", dateISO: DIA, time: "10:00", durationMin: 30 });
    assert.equal(c.ok, true);
    assert.equal(db.appointments.find((f) => f.id === c.appointmentId)?.resourceId, "s2");
  });

  it("crear: si se ocuparon todos los sillones entre la oferta y el «sí» → overlap (el bot vuelve a la lista)", async () => {
    db.resources = [{ id: "s1", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] }];
    db.appointments = [cita("x1", "docA", "10:00", "s1")];
    const c = await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "docB", dateISO: DIA, time: "10:00", durationMin: 30 });
    assert.deepEqual(c, { ok: false, error: "overlap" });
  });

  it("reagendar: conserva su sillón si sigue libre; si no, pasa a otro libre", async () => {
    db.resources = [
      { id: "s1", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] },
      { id: "s2", clinicId: "c1", kind: "SILLA_DENTAL", isActive: true, schedules: [] },
    ];
    db.appointments = [cita("mia", "docB", "09:00", "s2"), cita("otra", "docA", "11:00", "s2")];
    const r1 = await svc.rescheduleBotAppointment({ clinicId: "c1", appointmentId: "mia", dateISO: DIA, time: "10:00" });
    assert.equal(r1.ok, true);
    assert.equal(db.updates.at(-1)?.resourceId, undefined, "cambió de sillón sin necesidad");
    const r2 = await svc.rescheduleBotAppointment({ clinicId: "c1", appointmentId: "mia", dateISO: DIA, time: "11:00" });
    assert.equal(r2.ok, true);
    assert.equal(db.updates.at(-1)?.resourceId, "s1");
  });

  it("sin sillones, todo exactamente como antes", async () => {
    db.appointments = [cita("x1", "docA", "10:00", null)];
    const r = await svc.getAvailableSlots({ clinicId: "c1", doctorId: "docB", dateISO: DIA, durationMin: 30 });
    assert.ok(r.slots.includes("10:00"));
    const c = await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "docB", dateISO: DIA, time: "10:00", durationMin: 30 });
    assert.equal(c.ok, true);
    assert.equal(db.appointments.at(-1)?.resourceId, null);
  });

  it("recursoLibre puro: el preferido gana si está libre", () => {
    const recursos = [{ id: "s1", schedule: null }, { id: "s2", schedule: null }];
    const { startsAt, endsAt } = a("10:00");
    assert.equal(recursoLibre(recursos, [], startsAt, endsAt, TZ), "s1");
    assert.equal(recursoLibre(recursos, [], startsAt, endsAt, TZ, "s2"), "s2");
    assert.equal(recursoLibre(recursos, [{ resourceId: "s1", ...a("10:15") }, { resourceId: "s2", ...a("09:45") }], startsAt, endsAt, TZ), null);
  });
});

describe("WS1-T3 v6 (revisión t8 de la v5, N2) — reagendar por el bot NO revive una cita cancelada o no asistida", () => {
  it("la conversación de reagendar seguía abierta y la cita se canceló (o quedó «no asistió») → not_active, sin tocarla", async () => {
    for (const status of ["CANCELLED", "NO_SHOW"]) {
      db.appointments = [{ ...cita("mia", "docB", "09:00", null), status }];
      db.updates = [];
      const r = await svc.rescheduleBotAppointment({ clinicId: "c1", appointmentId: "mia", dateISO: DIA, time: "10:00" });
      assert.deepEqual(r, { ok: false, error: "not_active" }, status);
      assert.equal(db.updates.length, 0);
      assert.equal(db.appointments[0].status, status, "sigue como estaba");
    }
  });

  it("a la vez: la cita se cancela entre la lectura y el update → el update no casa (status notIn) y es not_active", async () => {
    db.appointments = [cita("mia", "docB", "09:00", null)];
    db.antesDeMover = () => {
      db.appointments[0].status = "CANCELLED";
    };
    const r = await svc.rescheduleBotAppointment({ clinicId: "c1", appointmentId: "mia", dateISO: DIA, time: "10:00" });
    assert.deepEqual(r, { ok: false, error: "not_active" });
    assert.equal(db.appointments[0].status, "CANCELLED", "no revivió");
    assert.equal(db.updates.length, 0);
  });

  it("una cita activa se reagenda como siempre (y el update lleva el clinicId: la de otra clínica no se toca)", async () => {
    db.appointments = [cita("mia", "docB", "09:00", null), { ...cita("mia", "docB", "09:00", null), clinicId: "c2" }];
    const r = await svc.rescheduleBotAppointment({ clinicId: "c1", appointmentId: "mia", dateISO: DIA, time: "10:00" });
    assert.equal(r.ok, true);
    assert.equal(db.appointments[0].status, "SCHEDULED");
    assert.equal(db.appointments[0].startsAt.getTime(), a("10:00").startsAt.getTime());
    assert.equal(db.appointments[1].startsAt.getTime(), a("09:00").startsAt.getTime(), "otra clínica, intacta");
  });
});
