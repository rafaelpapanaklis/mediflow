/**
 * Cita «Sin doctor»: el REAGENDADO y el cambio de doctor en los recordatorios
 * que aún no salen (ws1-t10 · fase 2 · P3).
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 *  · El reagendado de una «Sin doctor» (dentro de la transacción) no se revierte
 *    y no deja «Te atiende: ».
 *  · Cambiar SOLO el doctor pone al día el TEXTO de los pendientes sin cancelar
 *    nada: un aviso ya vencido que el worker aún no recogía sigue pendiente (lo
 *    vio la revisión de P1) y un SENT no se toca.
 *
 * Sin `--experimental-test-module-mocks` a propósito: así `server-only` se
 * puede doblar por `Module._load` (como reschedule-sin-doctor.test.ts). La base
 * es un doble en memoria que se le pasa a las funciones.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  return cargaOriginal.call(this, req, parent, isMain);
};

globalThis.fetch = (async () => {
  throw new Error("RED PROHIBIDA en esta prueba");
}) as typeof fetch;

const AHORA = new Date();
const MIN = 60_000;
const TZ = "America/Mexico_City";
const CL_A = "clx9clin0a000108l4norte01"; // cuid
const CL_B = "seed-clinica-salamanca"; // id de siembra
const CITA_A = "clx9cita0a000108l4aaaa0001";
const CITA_B1 = "dentalink-cita-48213"; // importada de Dentalink: no es uuid ni cuid
const CITA_B2 = "seed-cita-sin-doctor-2";
const MANANA = new Date(AHORA.getTime() + 24 * 60 * MIN);

/* ── la base en memoria ───────────────────────────────────────────────── */

interface Mundo {
  clinics: any[];
  appointments: any[];
  reminders: any[];
}
let w: Mundo;

function clinica(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, timezone: TZ, waConnected: true, waReminderActive: true, waReminder24h: true, waReminder1h: false,
    waReminderMsg: null, reminderSettings: null, logoUrl: null, waPhoneNumberId: `pn-${id}`, waAccessToken: `tok-${id}`,
    waTemplates: { reminder: { name: "dc_recordatorio_cita", lang: "es_MX" } }, ...extra,
  };
}
function cita(id: string, clinicId: string, doctor: { firstName: string; lastName: string } | null, extra: Record<string, unknown> = {}) {
  return {
    id, clinicId, patientId: `pac-${id}`, startsAt: MANANA, endsAt: new Date(MANANA.getTime() + 30 * MIN),
    status: "SCHEDULED", holdExpiresAt: null, type: "Limpieza", confirmToken: `ct-${id}`,
    doctorId: doctor ? `doc-${id}` : null, doctor,
    patient: { firstName: "Ana", lastName: "García", phone: "+5219991112222", email: "ana@correo.mx" },
    ...extra,
  };
}

const enRango = (d: Date, r: any) => (!r?.gte || d >= r.gte) && (!r?.lte || d <= r.lte) && (!r?.lt || d < r.lt);

function base() {
  return {
    clinic: {
      findMany: async () => w.clinics,
      findUnique: async ({ where }: any) => w.clinics.find((c) => c.id === where.id) ?? null,
    },
    appointment: {
      findMany: async ({ where }: any) =>
        w.appointments.filter((a) => a.clinicId === where.clinicId && enRango(a.startsAt, where.startsAt) && (!where.status?.in || where.status.in.includes(a.status))),
      findFirst: async ({ where }: any) => w.appointments.find((a) => a.id === where.id && a.clinicId === where.clinicId) ?? null,
      findUnique: async ({ where }: any) => w.appointments.find((a) => a.id === where.id) ?? null,
      updateMany: async () => ({ count: 1 }),
    },
    patientAccountLink: { findMany: async () => [], findFirst: async () => null },
    patientNotification: { createMany: async ({ data }: any) => ({ count: data.length }) },
    whatsAppReminder: {
      findMany: async ({ where }: any) => {
        // La cola del worker: lo pendiente, con su clínica y su cita (como `include`).
        if (where?.scheduledFor) {
          return w.reminders
            .filter((r) => ["PENDING", "ACTIVE"].includes(r.status))
            .map((r) => ({ ...r, clinic: w.clinics.find((c) => c.id === r.clinicId), appointment: w.appointments.find((a) => a.id === r.appointmentId) ?? null }));
        }
        return w.reminders.filter(
          (r) =>
            (!where.clinicId || r.clinicId === where.clinicId) &&
            (!where.appointmentId || (typeof where.appointmentId === "string" ? r.appointmentId === where.appointmentId : where.appointmentId.in.includes(r.appointmentId))) &&
            (!where.type || r.type === where.type) &&
            (!where.status?.in || where.status.in.includes(r.status)),
        );
      },
      createMany: async ({ data }: any) => {
        for (const d of data) w.reminders.push({ id: `wr-${w.reminders.length + 1}`, ...d });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: any) => {
        let n = 0;
        for (const r of w.reminders) {
          const ids = where.id?.in ?? (where.id ? [where.id] : null);
          if (ids && !ids.includes(r.id)) continue;
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          if (where.clinicId && r.clinicId !== where.clinicId) continue;
          if (where.scheduledFor?.lt) continue; // el barrido de «expirados»: nada tan viejo aquí
          Object.assign(r, data);
          n++;
        }
        return { count: n };
      },
      update: async ({ where, data }: any) => {
        const r = w.reminders.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
  };
}

let actual: any;
(globalThis as any).prisma = new Proxy(
  {},
  { get: (_t, modelo: string) => new Proxy({}, { get: (_u, op: string) => (...a: unknown[]) => actual[modelo][op](...a) }) },
);

beforeEach(() => {
  w = {
    clinics: [clinica(CL_A, "Clínica Norte"), clinica(CL_B, "Centro Dental Salamanca QA")],
    appointments: [
      cita(CITA_A, CL_A, { firstName: "Luis", lastName: "Ruiz" }),
      cita(CITA_B1, CL_B, null),
      cita(CITA_B2, CL_B, null),
    ],
    reminders: [],
  };
  actual = base();
});

/* ═══════════════ 2 · reagendar una «Sin doctor» ═══════════════ */

function txDe() {
  return actual as any;
}

test("reagendar una «Sin doctor» re-encola sin «Te atiende: » (y con doctor, con su nombre)", async () => {
  const { applyReminderReschedule } = await import("../reschedule.server");
  const nueva = new Date(AHORA.getTime() + 3 * 24 * 60 * MIN);
  const r = await applyReminderReschedule(txDe(), { appointmentId: CITA_B1, clinicId: CL_B, newStartsAt: nueva });
  assert.ok(r.created > 0, JSON.stringify(r));
  const filas = w.reminders.filter((x) => x.appointmentId === CITA_B1);
  for (const f of filas) assert.doesNotMatch(f.message, /Te atiende|undefined|null|Dr\/a\./, f.message);

  await applyReminderReschedule(txDe(), { appointmentId: CITA_A, clinicId: CL_A, newStartsAt: nueva });
  assert.match(w.reminders.find((x) => x.appointmentId === CITA_A)!.message, /Te atiende: Dr\/a\. Luis Ruiz/);
});

/* ═══════════════ 3 · cambia SOLO el doctor ═══════════════ */

function pendiente(id: string, appointmentId: string, clinicId: string, extra: Record<string, unknown> = {}) {
  return {
    id, clinicId, appointmentId, type: "APPT_AUTO", status: "PENDING",
    scheduledFor: new Date(AHORA.getTime() + 60 * MIN),
    message: "Hola Ana 👋, te recordamos tu cita…\n\nTe atiende: Dr/a. Luis Ruiz\n\nConfirma tu asistencia aquí: https://x/cita/ct-old/confirmar",
    payload: { kind: "APPT_AUTO", offsetMin: 1440, channel: "whatsapp", confirmUrl: "https://x/cita/ct-old/confirmar" },
    ...extra,
  };
}

test("🔴 quitarle el doctor pone al día el texto de los pendientes SIN cancelar ninguno (tampoco el ya vencido) y sin tocar el SENT", async () => {
  // La cita era de Luis y ahora es «Sin doctor».
  w.appointments[0].doctor = null;
  w.appointments[0].doctorId = null;
  w.reminders.push(
    pendiente("wr-futuro", CITA_A, CL_A),
    // Ya vencido: el worker no lo ha recogido. Re-encolar lo habría CANCELADO sin mandarlo.
    pendiente("wr-vencido", CITA_A, CL_A, { scheduledFor: new Date(AHORA.getTime() - 10 * MIN) }),
    pendiente("wr-legacy", CITA_A, CL_A, { status: "ACTIVE" }),
    pendiente("wr-salio", CITA_A, CL_A, { status: "SENT" }),
    // Otra clínica con el MISMO id de cita no se toca (aislamiento).
    pendiente("wr-otra-clinica", CITA_A, CL_B),
  );
  const { rerenderPendingReminderText } = await import("../reschedule.server");
  const n = await rerenderPendingReminderText(actual, { appointmentId: CITA_A, clinicId: CL_A, plantillaControl: async () => null });
  assert.equal(n, 3);

  const por = (id: string) => w.reminders.find((x) => x.id === id)!;
  for (const id of ["wr-futuro", "wr-vencido", "wr-legacy"]) {
    const f = por(id);
    assert.ok(["PENDING", "ACTIVE"].includes(f.status), `${id} sigue pendiente (${f.status})`);
    assert.doesNotMatch(f.message, /Te atiende|Luis/, f.message);
    assert.match(f.message, /https:\/\/x\/cita\/ct-old\/confirmar/, "el enlace de confirmar es el que ya llevaba la fila");
  }
  assert.equal(por("wr-vencido").scheduledFor.getTime(), AHORA.getTime() - 10 * MIN, "no se reprograma");
  assert.match(por("wr-salio").message, /Luis Ruiz/, "lo que ya salió es historial");
  assert.match(por("wr-otra-clinica").message, /Luis Ruiz/, "nunca otra clínica");
  assert.equal(w.reminders.length, 5, "no se crea ninguna fila");
});

test("asignarle doctor a una «Sin doctor»: el pendiente pasa a decir quién la atiende", async () => {
  w.appointments[1].doctor = { firstName: "Marta", lastName: "Solís" };
  w.appointments[1].doctorId = "seed-doctor-2";
  w.reminders.push(
    pendiente("wr-1", CITA_B1, CL_B, {
      message: "Hola Ana 👋, te recordamos tu cita…\n\nConfirma tu asistencia aquí: https://x/cita/ct-old/confirmar",
    }),
  );
  const { rerenderPendingReminderText } = await import("../reschedule.server");
  assert.equal(await rerenderPendingReminderText(actual, { appointmentId: CITA_B1, clinicId: CL_B, plantillaControl: async () => null }), 1);
  assert.match(w.reminders[0].message, /Te atiende: Dr\/a\. Marta Solís/);
  assert.equal(w.reminders[0].status, "PENDING");
});

test("si la base falla a media puesta al día, no lanza (el cambio de doctor ya quedó)", async () => {
  actual = { ...base(), appointment: { findFirst: async () => { throw new Error("pooler caído"); } } };
  const { rerenderPendingReminderText } = await import("../reschedule.server");
  assert.equal(await rerenderPendingReminderText(actual, { appointmentId: CITA_A, clinicId: CL_A }), 0);
});

test("sin clinicId no se consulta nada (la regla (c) de la casa)", async () => {
  let consultas = 0;
  actual = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { consultas++; return null; } }) });
  const { rerenderPendingReminderText } = await import("../reschedule.server");
  assert.equal(await rerenderPendingReminderText(actual, { appointmentId: CITA_A, clinicId: "" }), 0);
  assert.equal(consultas, 0);
});
