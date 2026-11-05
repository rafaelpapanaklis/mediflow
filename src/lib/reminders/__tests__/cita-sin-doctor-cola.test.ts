/**
 * Cita «Sin doctor» y la COLA de WhatsApp (ws1-t10 · fase 2 · P3). Lo que
 * Rafael pidió revisar primero: «revisa que WhatsApp va a funcionar».
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 *  1. El ENCOLADOR (cron appointment-reminders) y el WORKER (cron de la cola)
 *     de verdad, de punta a punta, con DOS clínicas en el mismo lote: una con
 *     doctor y otra con citas «Sin doctor» (una de ellas importada de Dentalink,
 *     con id que no es uuid). Las dos salen; el {{5}} de la plantilla nunca va
 *     vacío y la plantilla pasa la MISMA decisión que el envío real
 *     (`decideSendMode`). Antes, un `appt.doctor.firstName` con null abortaba
 *     el lote de esa clínica.
 *  (El reagendado y el cambio de doctor: cita-sin-doctor-reagendado.test.ts.)
 *
 * La base es un doble en memoria detrás de `globalThis.prisma` (src/lib/prisma.ts
 * lo reutiliza). El envío a Meta y el correo están sustituidos; `fetch` lanza:
 * aquí no sale nada a la red.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";


globalThis.fetch = (async () => {
  throw new Error("RED PROHIBIDA en esta prueba");
}) as typeof fetch;

import { decideSendMode } from "@/lib/whatsapp/send-mode";

const AHORA = new Date();
const MIN = 60_000;
const TZ = "America/Mexico_City";
const CL_A = "clx9clin0a000108l4norte01"; // cuid
const CL_B = "seed-clinica-salamanca"; // id de siembra
const CITA_A = "clx9cita0a000108l4aaaa0001";
const CITA_B1 = "dentalink-cita-48213"; // importada de Dentalink: no es uuid ni cuid
const CITA_B2 = "seed-cita-sin-doctor-2";
const MANANA = new Date(AHORA.getTime() + 24 * 60 * MIN);

/* ── el envío a Meta, sustituido: registra y decide como el real ──────── */

const enviados: any[] = [];
const correos: any[] = [];
mock.module("@/lib/whatsapp/send-and-log", {
  namedExports: {
    sendWhatsAppLogged: async (args: any) => {
      // Ventana CERRADA (lo normal un día antes): la plantilla tiene que poder salir.
      const decision = decideSendMode({
        kind: args.kind,
        windowOpen: false,
        templates: { reminder: { name: "dc_recordatorio_cita", lang: "es_MX" } } as any,
        params: args.templateParams,
      });
      enviados.push({ ...args, decision });
      if (decision.mode === "blocked") throw new Error(decision.reason);
      return { messages: [{ id: `wamid.${enviados.length}` }] };
    },
  },
});
mock.module("@/lib/email", {
  namedExports: {
    sendEmail: async (a: any) => {
      correos.push(a);
      return { delivered: true };
    },
  },
});
mock.module("@/lib/whatsapp/connection", { namedExports: { markWhatsAppDisconnected: async () => undefined } });

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
  enviados.length = 0;
  correos.length = 0;
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

/* ═══════════════ 1 · encolar + mandar, dos clínicas en un lote ═══════════════ */

test("🔴 un lote con dos clínicas, una con citas «Sin doctor»: se encolan y se MANDAN las tres; {{5}} nunca vacío", async () => {
  const { sweepAppointmentReminders } = await import("../enqueue");
  const r = await sweepAppointmentReminders({ now: AHORA });
  assert.deepEqual(r.errors, [], "ninguna clínica abortó su lote");
  assert.equal(r.queuedWhatsapp, 3, JSON.stringify(r));

  const porCita = new Map(w.reminders.map((x) => [x.appointmentId, x]));
  assert.match(porCita.get(CITA_A)!.message, /Te atiende: Dr\/a\. Luis Ruiz/, "con doctor, como siempre");
  for (const id of [CITA_B1, CITA_B2]) {
    const m: string = porCita.get(id)!.message;
    assert.doesNotMatch(m, /Te atiende|undefined|null|Dr\/a\./, m);
    assert.match(m, /Centro Dental Salamanca QA/);
    assert.match(m, new RegExp(`/cita/ct-${id}/confirmar`));
  }

  const { processWhatsAppQueue } = await import("@/lib/whatsapp/queue-worker");
  const s = await processWhatsAppQueue({ batchSize: 10 });
  assert.equal(s.sent, 3, JSON.stringify(s));
  assert.equal(s.failed, 0, JSON.stringify(s.errors));
  assert.equal(enviados.length, 3);
  for (const e of enviados) {
    assert.equal(e.decision.mode, "template", `la plantilla de Meta sale: ${JSON.stringify(e.decision)}`);
    assert.equal(e.templateParams.length, 5);
    assert.ok(e.templateParams.every((p: string) => p.trim().length > 0), JSON.stringify(e.templateParams));
  }
  const deB = enviados.filter((e) => e.clinic.id === CL_B);
  assert.equal(deB.length, 2);
  for (const e of deB) assert.equal(e.templateParams[4], "nuestro equipo");
  assert.equal(enviados.find((e) => e.clinic.id === CL_A).templateParams[4], "Dr/a. Luis Ruiz");
  // El texto libre (ventana abierta) es el que se congeló al encolar.
  for (const e of deB) assert.doesNotMatch(e.body, /Te atiende/);
});

test("canal correo: la cita «Sin doctor» sale sin la fila del doctor (y sin «tu doctor/a»)", async () => {
  w.clinics[1].reminderSettings = { enabled: true, offsets: [1440], channel: "email", template: "Hola {paciente}, te atiende {doctor}. {link}" };
  const { sweepAppointmentReminders } = await import("../enqueue");
  await sweepAppointmentReminders({ now: AHORA });
  const { processWhatsAppQueue } = await import("@/lib/whatsapp/queue-worker");
  const s = await processWhatsAppQueue({ batchSize: 10 });
  assert.equal(s.failed, 0, JSON.stringify(s.errors));
  assert.equal(correos.length, 2);
  for (const c of correos) {
    assert.doesNotMatch(c.html, /👨‍⚕️|tu doctor|null|undefined/);
    assert.match(c.text, /te atiende nuestro equipo/, c.text);
  }
});
