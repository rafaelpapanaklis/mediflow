/**
 * ws1-t12 (auditoría BEVADENT) — la cita GENÉRICA del bot (duración 0: «Consulta o
 * valoración», «Limpieza», «Urgencia o dolor» sin procedimiento equivalente, u «Otro»)
 * debe durar lo mismo que los huecos que se ofrecieron. `getAvailableSlots` usa el
 * paso de la agenda de la clínica (`defaultSlotMinutes`); `createBotAppointment`
 * ponía 30 min fijos: con paso 15 la cita de 30 pisaba el hueco siguiente («se acaba
 * de ocupar» en bucle) y con paso 60 quedaba corta.
 *
 * Mismo doble de Prisma que bot-booking-sillones.test.ts. Run: npm run test:wa-agendado-e2e
 */
import Module from "node:module";
import path from "node:path";
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tzLocalToUtc } from "../time-utils";

const RAIZ = path.resolve(__dirname, "../../../..");
const TZ = "America/Mexico_City";
const DIA = "2031-03-10"; // lunes, siempre en el futuro
type Fila = Record<string, any>;

const db = { appointments: [] as Fila[], paso: 30 };

function solapa(f: Fila, where: Fila): boolean {
  if (where.startsAt?.lt && !(f.startsAt < where.startsAt.lt)) return false;
  if (where.endsAt?.gt && !(f.endsAt > where.endsAt.gt)) return false;
  return true;
}
function citasQueCasan(where: Fila): Fila[] {
  return db.appointments.filter((f) => {
    if (where.clinicId && f.clinicId !== where.clinicId) return false;
    if (where.doctorId && f.doctorId !== where.doctorId) return false;
    if (where.status?.notIn && where.status.notIn.includes(f.status)) return false;
    return solapa(f, where);
  });
}

const prismaDoble: Fila = {
  clinic: {
    findUnique: async () => ({ timezone: TZ, agendaDayStart: 9, agendaDayEnd: 11, defaultSlotMinutes: db.paso, schedules: [], name: "Demo" }),
  },
  user: { findFirst: async () => ({ id: "doc1" }), findMany: async () => [{ id: "doc1" }] },
  patient: { findFirst: async () => ({ id: "pat1" }) },
  resource: { findMany: async () => [] },
  appointment: {
    findMany: async ({ where }: { where: Fila }) => citasQueCasan(where),
    findFirst: async ({ where }: { where: Fila }) => citasQueCasan(where)[0] ?? null,
    create: async ({ data }: { data: Fila }) => {
      const fila = { id: `appt${db.appointments.length + 1}`, ...data };
      db.appointments.push(fila);
      return { id: fila.id, deposits: [] };
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
before(async () => { svc = await import("../bot-booking-service"); });
beforeEach(() => { db.appointments = []; });

function minutos(f: Fila): number {
  return Math.round((f.endsAt.getTime() - f.startsAt.getTime()) / 60_000);
}

describe("cita genérica del bot (durationMin 0): dura lo mismo que el hueco ofrecido", () => {
  it("paso de 15: se ofrecen huecos de 15 y la cita dura 15 (antes 30: pisaba el siguiente hueco)", async () => {
    db.paso = 15;
    const huecos = await svc.getAvailableSlots({ clinicId: "c1", doctorId: "doc1", dateISO: DIA, durationMin: 0 });
    assert.ok(huecos.slots.includes("09:15") && huecos.slots.includes("09:30"), huecos.slots.join(","));
    // El paciente elige 09:15 estando 09:30 ocupado (hueco libre de exactamente 15 min).
    const s = tzLocalToUtc(DIA, 9, 30, TZ);
    db.appointments.push({ id: "x", clinicId: "c1", doctorId: "doc1", status: "SCHEDULED", startsAt: s, endsAt: new Date(s.getTime() + 15 * 60_000) });
    const r = await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "doc1", dateISO: DIA, time: "09:15", durationMin: 0 });
    assert.equal(r.ok, true, `error: ${r.error}`);
    assert.equal(minutos(db.appointments[1]), 15);
  });

  it("paso de 60: la cita dura 60, como el hueco", async () => {
    db.paso = 60;
    const r = await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "doc1", dateISO: DIA, time: "09:00", durationMin: 0 });
    assert.equal(r.ok, true);
    assert.equal(minutos(db.appointments[0]), 60);
  });

  it("con duración del catálogo, manda la del catálogo; sin paso configurado (0), 30", async () => {
    db.paso = 60;
    await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "doc1", dateISO: DIA, time: "09:00", durationMin: 45 });
    assert.equal(minutos(db.appointments[0]), 45);
    db.paso = 0;
    await svc.createBotAppointment({ clinicId: "c1", patientId: "pat1", doctorId: "doc1", dateISO: DIA, time: "10:00", durationMin: 0 });
    assert.equal(minutos(db.appointments[1]), 30);
  });
});
