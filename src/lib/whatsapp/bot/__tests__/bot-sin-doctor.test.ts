/**
 * El bot de WhatsApp ante una cita «Sin doctor» (ws1-t10 · fase 2 · P3, D6).
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 *  · Reagendar una «Sin doctor» (por texto o con el botón 🔁 del recordatorio)
 *    pasa a una persona en vez del callejón «Algo salió mal…»; sin permiso de
 *    pasar a una persona, le dice al paciente a quién acudir. Nunca la mueve.
 *  · Con doctor, el reagendado sigue como siempre.
 *  · El servicio nunca escribe una cita sin doctor por el bot: `createBotAppointment`
 *    sin `doctorId` corta ANTES de consultar (m4 de la revisión de P1: con
 *    `id: undefined` Prisma descarta el filtro y encontraría a cualquier doctor),
 *    y `rescheduleBotAppointment` no mueve una «Sin doctor».
 *
 * Sin base (un espía detrás de `globalThis.prisma`), sin Meta, sin red.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  return cargaOriginal.call(this, req, parent, isMain);
};

/** Cada operación que alguien le pida a la base. */
const consultas: string[] = [];
let cita: any = null;
(globalThis as any).prisma = new Proxy(
  {},
  {
    get: (_t, modelo: string) =>
      new Proxy({}, {
        get: (_u, op: string) => async () => {
          consultas.push(`${modelo}.${op}`);
          if (modelo === "appointment" && op === "findFirst") return cita;
          if (modelo === "clinic") return { timezone: "America/Mexico_City", agendaDayStart: 0, agendaDayEnd: 24, defaultSlotMinutes: 30 };
          throw new Error(`consulta inesperada: ${modelo}.${op}`);
        },
      }),
  },
);

import {
  runBookingTurn,
  TEXTO_REAGENDAR_SIN_DOCTOR,
  TEXTO_REAGENDAR_SIN_DOCTOR_SIN_PERSONA,
  type BookingDeps,
} from "../booking-core";
import { BotIntent, type BotConfigDTO, type BotTurnInput } from "../types";
import { REC_BOTON } from "../../interactivo";

const TZ = "America/Mexico_City";
const config: BotConfigDTO = {
  id: "cfg1", clinicId: "seed-clinica-salamanca", enabled: true, botName: "Asistente", persona: null, greeting: null,
  businessHours: null, afterHoursMsg: null, canAnswerFaq: true, canBookAppointments: true, fallbackToHuman: true,
};
const MANANA = new Date(Date.now() + 24 * 3600_000);
const sinDoctor = (id: string) => ({ id, doctorId: null, doctor: null, startsAt: MANANA, endsAt: new Date(MANANA.getTime() + 30 * 60_000), type: "Limpieza" });
const conDoctor = (id: string) => ({ ...sinDoctor(id), doctorId: "clx9doc0a000108l4aaaa0001", doctor: { firstName: "Luis", lastName: "Ruiz" } });

function deps(citas: any[], movidas: any[]): BookingDeps {
  return {
    getClinicTimezone: async () => TZ,
    getClinicName: async () => "Centro Dental Salamanca QA",
    listBookableServices: async () => [],
    listBookableDoctors: async () => [],
    getAvailableSlots: async () => ({ closed: false, slots: ["10:00", "10:30"] }),
    createBotAppointment: async () => { throw new Error("no se crea nada"); },
    rescheduleBotAppointment: async (p) => { movidas.push(p); return { ok: true, appointmentId: p.appointmentId }; },
    getUpcomingAppointmentsForPatient: async () => citas,
    findOrCreateWhatsAppPatient: async () => ({ id: "pat1" }),
    findServiceById: async () => null,
    findThreadExternalId: async () => "5219991112222",
    findAppointmentById: async (id) => citas.find((c) => c.id === id) ?? null,
  } as BookingDeps;
}

async function turno(d: BookingDeps, texto: string, cfg = config, botState: any = null, eleccion?: { id: string; titulo: string }) {
  const r = await runBookingTurn(
    { clinicId: cfg.clinicId, threadId: "t1", incomingText: texto, history: [], patient: { id: "pat1", phone: "5219991112222" }, botState, eleccion } as BotTurnInput,
    cfg,
    d,
  );
  assert.ok(r);
  return r;
}

beforeEach(() => {
  consultas.length = 0;
  cita = null;
});

describe("bot · reagendar una cita «Sin doctor» (D6)", () => {
  it("🔴 con una sola cita, y «Sin doctor»: pasa a una persona y no mueve nada", async () => {
    const movidas: any[] = [];
    const r = await turno(deps([sinDoctor("dentalink-cita-48213")], movidas), "quiero reagendar mi cita");
    assert.equal(r.handoff, true);
    assert.equal(r.intent, BotIntent.HANDOFF);
    assert.equal(r.reply, TEXTO_REAGENDAR_SIN_DOCTOR);
    assert.equal(r.newBotState, null);
    assert.doesNotMatch(r.reply ?? "", /Algo salió mal/);
    assert.equal(movidas.length, 0);
  });

  it("con el botón 🔁 Reagendar del recordatorio, lo mismo", async () => {
    const movidas: any[] = [];
    const r = await turno(deps([sinDoctor("seed-cita-7")], movidas), "Reagendar", config, null, { id: REC_BOTON.REAGENDAR, titulo: "Reagendar" });
    assert.equal(r.handoff, true, JSON.stringify(r));
    assert.equal(movidas.length, 0);
  });

  it("con varias citas, al elegir la «Sin doctor» pasa a una persona; al elegir la de doctor, sigue como siempre", async () => {
    const citas = [conDoctor("clx9cita0a000108l4aaaa0001"), sinDoctor("dentalink-cita-48213")];
    const r1 = await turno(deps(citas, []), "quiero reagendar");
    assert.match(r1.reply ?? "", /¿Cuál cita deseas reagendar\?/);
    const r2 = await turno(deps(citas, []), "2", config, r1.newBotState);
    assert.equal(r2.handoff, true);
    assert.equal(r2.reply, TEXTO_REAGENDAR_SIN_DOCTOR);

    const r3 = await turno(deps(citas, []), "1", config, r1.newBotState);
    assert.notEqual(r3.handoff, true);
    assert.match(r3.reply ?? "", /fecha/i, "con doctor pregunta la fecha, como siempre");
  });

  it("si la clínica no deja pasar a una persona, el paciente sabe a quién acudir (sin derivar)", async () => {
    const r = await turno(deps([sinDoctor("seed-cita-7")], []), "quiero reagendar", { ...config, fallbackToHuman: false });
    assert.notEqual(r.handoff, true);
    assert.equal(r.reply, TEXTO_REAGENDAR_SIN_DOCTOR_SIN_PERSONA);
    assert.equal(r.newBotState, null);
  });

  it("con doctor, el reagendado de una sola cita sigue igual", async () => {
    const r = await turno(deps([conDoctor("clx9cita0a000108l4aaaa0001")], []), "quiero reagendar mi cita");
    assert.notEqual(r.handoff, true);
    assert.match(r.reply ?? "", /Tu cita actual es el/);
  });
});

describe("servicio del bot · nunca una cita sin doctor", () => {
  it("🔴 createBotAppointment sin doctorId corta ANTES de tocar la base (m4)", async () => {
    const { createBotAppointment } = await import("@/lib/agenda/bot-booking-service");
    for (const doctorId of [undefined, "", null]) {
      const r = await createBotAppointment({
        clinicId: "seed-clinica-salamanca", patientId: "pat1", doctorId: doctorId as any,
        dateISO: "2031-03-10", time: "10:00", durationMin: 30,
      });
      assert.deepEqual(r, { ok: false, error: "doctor_not_found" });
    }
    assert.deepEqual(consultas, [], "ni una consulta: con `id: undefined` Prisma encontraría a cualquier doctor");
  });

  it("rescheduleBotAppointment no mueve una «Sin doctor» (si alguien llegara a pedírselo)", async () => {
    cita = { id: "dentalink-cita-48213", doctorId: null, resourceId: null, overrideReason: null, startsAt: MANANA, endsAt: new Date(MANANA.getTime() + 30 * 60_000), status: "SCHEDULED", holdExpiresAt: null };
    const { rescheduleBotAppointment } = await import("@/lib/agenda/bot-booking-service");
    const r = await rescheduleBotAppointment({ clinicId: "seed-clinica-salamanca", appointmentId: cita.id, dateISO: "2031-03-10", time: "11:00" } as any);
    assert.equal(r.ok, false);
    assert.equal(r.error, "failed");
    assert.deepEqual(consultas, ["appointment.findFirst"], "lee la cita y se detiene: no busca huecos ni escribe");
  });
});
