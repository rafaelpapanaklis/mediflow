// T4 — flujo de agendar del bot de WhatsApp. Tests de la máquina de estados PURA
// (booking-core) con dependencias inyectadas: nada pega a la BD ni a Meta.
// Cubre: flujo feliz (paciente existente y nuevo), fecha ambigua, slot robado
// entre oferta y confirmación, cancelar, "menu", expiración de sesión, y
// 2 respuestas sin entender → humano. Correr: npm run test:wa-booking

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runBookingTurn,
  isBookingInProgress,
  type BookingDeps,
} from "../booking-core";
import { parseDateInput, isMenuWord, isCancelWord } from "../booking-parse";
import { BotIntent } from "../types";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";

const TZ = "America/Mexico_City";

function makeConfig(over: Partial<BotConfigDTO> = {}): BotConfigDTO {
  return {
    id: "cfg1",
    clinicId: "clinic1",
    enabled: true,
    botName: "Asistente",
    persona: null,
    greeting: null,
    businessHours: null,
    afterHoursMsg: null,
    canAnswerFaq: true,
    canBookAppointments: true,
    fallbackToHuman: true,
    ...over,
  };
}

function makeDeps(over: Partial<BookingDeps> = {}): BookingDeps {
  return {
    getClinicTimezone: async () => TZ,
    getClinicName: async () => "Clínica Demo",
    listBookableServices: async () => [{ id: "svc1", name: "Limpieza", duration: 30 }],
    listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }],
    getAvailableSlots: async () => ({ closed: false, slots: ["09:00", "09:30", "10:00"] }),
    createBotAppointment: async () => ({ ok: true, appointmentId: "appt1" }),
    rescheduleBotAppointment: async () => ({ ok: true, appointmentId: "appt1" }),
    getUpcomingAppointmentsForPatient: async () => [],
    findOrCreateWhatsAppPatient: async () => ({ id: "patNew" }),
    findServiceById: async () => ({ name: "Limpieza", duration: 30 }),
    findThreadExternalId: async () => "5215512345678",
    findAppointmentById: async () => null,
    ...over,
  };
}

// Mini-conversación que arrastra el botState de un turno al siguiente.
function makeConvo(config: BotConfigDTO, deps: BookingDeps, patient?: { id: string; phone?: string }) {
  let state: BotTurnResult["newBotState"] = null;
  return {
    async say(text: string): Promise<BotTurnResult> {
      const res = await runBookingTurn(
        {
          clinicId: "clinic1",
          threadId: "thread1",
          incomingText: text,
          history: [],
          patient,
          botState: state ?? null,
        } as BotTurnInput,
        config,
        deps,
      );
      assert.ok(res, "runBookingTurn devolvió null (paso inesperado)");
      if (res.newBotState !== undefined) state = res.newBotState;
      return res;
    },
    get state(): any {
      return state;
    },
  };
}

describe("bot booking — flujo feliz", () => {
  it("paciente existente: agenda de punta a punta y crea la cita", async () => {
    const created: any[] = [];
    const deps = makeDeps({
      createBotAppointment: async (p) => {
        created.push(p);
        return { ok: true, appointmentId: "appt1" };
      },
    });
    const c = makeConvo(makeConfig(), deps, { id: "patP", phone: "5215512345678" });

    const r1 = await c.say("quiero una cita");
    assert.match(r1.reply ?? "", /servicio/i);

    const r2 = await c.say("1"); // servicio → doctor único → pide fecha
    assert.match(r2.reply ?? "", /fecha/i);

    const r3 = await c.say("mañana"); // fecha → muestra horarios
    assert.match(r3.reply ?? "", /Horarios disponibles/);

    const r4 = await c.say("1"); // elige 09:00 → paciente ya existe → confirma
    assert.match(r4.reply ?? "", /Confirmo tu cita/);
    assert.match(r4.reply ?? "", /09:00/);

    const r5 = await c.say("sí"); // confirma → crea
    assert.equal(created.length, 1);
    assert.equal(created[0].patientId, "patP");
    assert.equal(created[0].time, "09:00");
    assert.match(r5.reply ?? "", /Registr/); // "Registré tu cita…"
    assert.match(r5.reply ?? "", /Demo/); // nombre de la clínica en el mensaje final
    assert.equal(r5.newBotState, null); // sesión cerrada
  });

  it("paciente nuevo: pide nombre, lo crea como prospecto y agenda", async () => {
    const created: any[] = [];
    const namedPatients: string[] = [];
    const deps = makeDeps({
      findOrCreateWhatsAppPatient: async (_clinic, _phone, fullName) => {
        namedPatients.push(fullName);
        return { id: "patNew" };
      },
      createBotAppointment: async (p) => {
        created.push(p);
        return { ok: true, appointmentId: "appt1" };
      },
    });
    const c = makeConvo(makeConfig(), deps); // sin patient

    await c.say("agendar");
    await c.say("1"); // servicio
    await c.say("mañana"); // fecha
    const r4 = await c.say("1"); // slot → pide nombre (no hay paciente)
    assert.match(r4.reply ?? "", /nombre/i);

    const r5 = await c.say("Juan Pérez"); // nombre → confirma
    assert.match(r5.reply ?? "", /Confirmo tu cita/);
    assert.deepEqual(namedPatients, ["Juan Pérez"]);

    const r6 = await c.say("sí");
    assert.equal(created.length, 1);
    assert.equal(created[0].patientId, "patNew");
    assert.match(r6.reply ?? "", /Registr/);
  });
});

describe("bot booking — reagendar", () => {
  it("mueve una cita próxima existente", async () => {
    const moved: any[] = [];
    const deps = makeDeps({
      getUpcomingAppointmentsForPatient: async () => [
        {
          id: "apptOld",
          doctorId: "doc1",
          startsAt: new Date("2026-06-20T15:00:00Z"),
          endsAt: new Date("2026-06-20T15:30:00Z"),
          type: "Limpieza",
          doctor: { firstName: "Ana", lastName: "García" },
        },
      ],
      rescheduleBotAppointment: async (p) => {
        moved.push(p);
        return { ok: true, appointmentId: "apptOld" };
      },
    });
    const c = makeConvo(makeConfig(), deps, { id: "patP", phone: "5215512345678" });

    const r1 = await c.say("reagendar mi cita");
    assert.match(r1.reply ?? "", /fecha/i);
    await c.say("mañana");
    const r3 = await c.say("1");
    assert.match(r3.reply ?? "", /Confirmo el cambio/);
    const r4 = await c.say("sí");
    assert.equal(moved.length, 1);
    assert.equal(moved[0].appointmentId, "apptOld");
    assert.match(r4.reply ?? "", /reagendada/);
  });
});

describe("bot booking — entradas no entendidas", () => {
  it("fecha ambigua: re-pregunta sin avanzar", async () => {
    const c = makeConvo(makeConfig(), makeDeps(), { id: "patP", phone: "5215512345678" });
    await c.say("quiero una cita");
    await c.say("1"); // → fecha
    const r = await c.say("ehh no sé bien"); // no es fecha reconocible
    assert.match(r.reply ?? "", /No reconocí la fecha/);
    assert.equal(c.state.step, "date");
    assert.equal(c.state.misses, 1);
    assert.notEqual(r.handoff, true);
  });

  it("2 respuestas sin entender seguidas → deriva a humano", async () => {
    const c = makeConvo(makeConfig({ fallbackToHuman: true }), makeDeps());
    await c.say("agendar"); // → lista de servicios (step=service)
    const m1 = await c.say("qwerty"); // miss #1
    assert.match(m1.reply ?? "", /No te entend/);
    assert.equal(m1.handoff, undefined);
    assert.equal(c.state.misses, 1);

    const m2 = await c.say("zzzzz"); // miss #2 → handoff
    assert.equal(m2.handoff, true);
    assert.equal(m2.intent, BotIntent.HANDOFF);
    assert.match(m2.reply ?? "", /persona del equipo/);
    assert.equal(m2.newBotState, null); // sesión liberada para el staff
  });

  it("con fallbackToHuman=false NO deriva: sigue re-preguntando", async () => {
    const c = makeConvo(makeConfig({ fallbackToHuman: false }), makeDeps());
    await c.say("agendar");
    await c.say("qwerty"); // miss #1
    const m2 = await c.say("zzzzz"); // miss #2 — sin handoff
    assert.notEqual(m2.handoff, true);
    assert.match(m2.reply ?? "", /No te entend/);
  });

  it("una respuesta entendida reinicia el contador de fallos", async () => {
    const c = makeConvo(makeConfig(), makeDeps(), { id: "patP", phone: "5215512345678" });
    await c.say("agendar");
    await c.say("qwerty"); // miss #1 en step=service
    assert.equal(c.state.misses, 1);
    const ok = await c.say("1"); // entendido → avanza a fecha, misses=0
    assert.equal(c.state.misses, 0);
    assert.equal(c.state.step, "date");
    assert.match(ok.reply ?? "", /fecha/i);
  });
});

describe("bot booking — slot robado entre oferta y confirmación", () => {
  it("si el horario se ocupó al confirmar, re-ofrece horarios", async () => {
    const deps = makeDeps({
      createBotAppointment: async () => ({ ok: false, error: "overlap" }),
    });
    const c = makeConvo(makeConfig(), deps, { id: "patP", phone: "5215512345678" });
    await c.say("quiero una cita");
    await c.say("1");
    await c.say("mañana");
    await c.say("1"); // confirma paso
    const r = await c.say("sí"); // crear → overlap → re-ofrece
    assert.match(r.reply ?? "", /se acaba de ocupar/);
    assert.equal(c.state.step, "slot");
  });
});

describe("bot booking — comandos globales", () => {
  it("cancelar: termina y limpia la sesión", async () => {
    const c = makeConvo(makeConfig(), makeDeps(), { id: "patP", phone: "5215512345678" });
    await c.say("agendar");
    const r = await c.say("cancelar");
    assert.match(r.reply ?? "", /Listo, cancel/);
    assert.equal(r.newBotState, null);
  });

  it("menu: reinicia el flujo desde el inicio", async () => {
    const c = makeConvo(makeConfig(), makeDeps(), { id: "patP", phone: "5215512345678" });
    await c.say("agendar");
    await c.say("1"); // step=date
    const r = await c.say("menu"); // reinicia
    assert.match(r.reply ?? "", /servicio/i);
    assert.equal(c.state.step, "service");
  });
});

describe("bot booking — expiración de sesión (30 min)", () => {
  it("isBookingInProgress: fresca sí, expirada no, legacy y no-booking", () => {
    const fresh = { flow: "booking", mode: "create", step: "date", updatedAt: Date.now() - 1000 };
    const expired = { flow: "booking", mode: "create", step: "date", updatedAt: Date.now() - 31 * 60 * 1000 };
    const legacy = { flow: "booking", mode: "create", step: "date" }; // sin updatedAt
    assert.equal(isBookingInProgress(fresh as any), true);
    assert.equal(isBookingInProgress(expired as any), false);
    assert.equal(isBookingInProgress(legacy as any), true); // se tolera
    assert.equal(isBookingInProgress(null), false);
    assert.equal(isBookingInProgress({ foo: 1 } as any), false);
  });

  it("una sesión expirada no se confirma: no crea la cita", async () => {
    const created: any[] = [];
    const deps = makeDeps({
      createBotAppointment: async (p) => {
        created.push(p);
        return { ok: true, appointmentId: "x" };
      },
    });
    const expired = {
      flow: "booking",
      mode: "create",
      step: "confirm",
      dateISO: "2099-01-01",
      time: "09:00",
      patientId: "patP",
      doctorId: "doc1",
      durationMin: 30,
      updatedAt: Date.now() - 31 * 60 * 1000,
    };
    const res = await runBookingTurn(
      {
        clinicId: "clinic1",
        threadId: "thread1",
        incomingText: "sí",
        history: [],
        patient: { id: "patP", phone: "5215512345678" },
        botState: expired,
      } as BotTurnInput,
      makeConfig(),
      deps,
    );
    assert.ok(res);
    assert.equal(created.length, 0); // la cita expirada NO se confirmó
  });
});

describe("bot booking — parsers puros", () => {
  it('parseDateInput entiende "mañana", día de la semana y DD/MM, y rechaza basura', () => {
    assert.ok(parseDateInput("mañana", TZ));
    assert.match(parseDateInput("el lunes", TZ) ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(parseDateInput("15/06/2026", TZ), "2026-06-15");
    assert.equal(parseDateInput("ehh no sé bien", TZ), null);
  });

  it("isMenuWord / isCancelWord", () => {
    assert.equal(isMenuWord("menu"), true);
    assert.equal(isMenuWord("reiniciar"), true);
    assert.equal(isMenuWord("hola"), false);
    assert.equal(isCancelWord("salir"), true);
    assert.equal(isCancelWord("cancelar"), true);
    assert.equal(isCancelWord("sí"), false);
  });
});
