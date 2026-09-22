// WS1-T5 — el bot con anticipo: lo anuncia ANTES del «¿confirmas?», manda el
// link al «sí» y, si el link no sale, lo dice y pasa a una persona. Máquina de
// estados pura (booking-core) con dependencias inyectadas.
// Correr: npm run test:anticipos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBookingTurn, type BookingDeps } from "../booking-core";
import { BotIntent } from "../types";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";

const TZ = "America/Mexico_City";

const config: BotConfigDTO = {
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
};

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

async function hastaConfirmar(deps: BookingDeps) {
  let state: BotTurnResult["newBotState"] = null;
  const say = async (text: string) => {
    const res = await runBookingTurn(
      {
        clinicId: "clinic1",
        threadId: "thread1",
        incomingText: text,
        history: [],
        patient: { id: "pat1", phone: "5215512345678" },
        botState: state ?? null,
      } as BotTurnInput,
      config,
      deps,
    );
    assert.ok(res);
    if (res.newBotState !== undefined) state = res.newBotState;
    return res;
  };
  await say("quiero agendar");
  await say("1"); // Limpieza
  await say("2099-06-12");
  const confirmar = await say("1"); // 09:00
  return { confirmar, say, get state() { return state as any; } };
}

describe("bot con anticipo (WS1-T5)", () => {
  it("anuncia el anticipo antes del «¿confirmas?», con el monto y el plazo", async () => {
    const { confirmar } = await hastaConfirmar(
      makeDeps({ anticipoParaAnunciar: async () => ({ monto: 300, minutos: 30 }) }),
    );
    assert.match(confirmar.reply ?? "", /anticipo de \*\$300\.00\*/);
    assert.match(confirmar.reply ?? "", /\*30 min\*/);
    assert.match(confirmar.reply ?? "", /¿Confirmas\?/);
  });

  it("al «sí» manda el link, dice hasta qué hora y cierra el flujo", async () => {
    let recibido: any = null;
    const deps = makeDeps({
      anticipoParaAnunciar: async () => ({ monto: 300, minutos: 30 }),
      createBotAppointment: async (p) => {
        recibido = p;
        return {
          ok: true,
          appointmentId: "appt1",
          depositId: "dep1",
          anticipo: {
            url: "https://mpago.la/abc",
            monto: 300,
            venceA: "2099-06-11T16:30:00.000Z",
            minutos: 30,
          },
        };
      },
    });
    const { say } = await hastaConfirmar(deps);
    const fin = await say("sí");
    assert.equal(fin.newBotState, null);
    assert.match(fin.reply ?? "", /Te aparté el/);
    assert.match(fin.reply ?? "", /https:\/\/mpago\.la\/abc/);
    assert.match(fin.reply ?? "", /hasta las \*10:30\*/, "la hora en la zona de la clínica");
    assert.match(fin.reply ?? "", /se libera solo/);
    assert.match(fin.reply ?? "", /saldo a favor/);

    // Lo que viaja al servidor: el servicio y el hilo, NUNCA un monto.
    assert.equal(recibido.serviceId, "svc1");
    assert.equal(recibido.threadId, "thread1");
    assert.equal("monto" in recibido, false);
    assert.equal("amount" in recibido, false);
  });

  it("el monto que se cobra es el del servidor, aunque el estado del bot diga otro", async () => {
    const deps = makeDeps({
      anticipoParaAnunciar: async () => ({ monto: 1, minutos: 30 }), // anuncio viejo / manipulado
      createBotAppointment: async () => ({
        ok: true,
        appointmentId: "appt1",
        anticipo: { url: "https://mpago.la/x", monto: 300, venceA: "2099-06-11T16:30:00.000Z", minutos: 30 },
      }),
    });
    const { say } = await hastaConfirmar(deps);
    const fin = await say("sí");
    assert.match(fin.reply ?? "", /\*\$300\.00\*/);
    assert.doesNotMatch(fin.reply ?? "", /\$1\.00/);
  });

  it("si el link no sale: lo dice, el horario NO quedó apartado, y pasa a una persona", async () => {
    const deps = makeDeps({
      anticipoParaAnunciar: async () => ({ monto: 300, minutos: 30 }),
      createBotAppointment: async () => ({ ok: false, error: "pago_no_disponible" }),
    });
    const { say } = await hastaConfirmar(deps);
    const fin = await say("sí");
    assert.equal(fin.handoff, true);
    assert.equal(fin.intent, BotIntent.HANDOFF);
    assert.match(fin.reply ?? "", /NO quedó apartado/);
  });

  it("clínica sin anticipo: el «¿confirmas?» y el «¡Listo!» son los de siempre", async () => {
    const { confirmar, say } = await hastaConfirmar(makeDeps({ anticipoParaAnunciar: async () => null }));
    assert.doesNotMatch(confirmar.reply ?? "", /anticipo/);
    const fin = await say("sí");
    assert.match(fin.reply ?? "", /Registré tu cita/);
  });

  it("sin la dependencia (tests viejos, otros cableados) nada cambia", async () => {
    const { confirmar } = await hastaConfirmar(makeDeps());
    assert.doesNotMatch(confirmar.reply ?? "", /anticipo/);
  });

  it("si preguntar por el anticipo falla, se sigue sin anunciarlo (el servidor decide al crear)", async () => {
    const { confirmar } = await hastaConfirmar(
      makeDeps({
        anticipoParaAnunciar: async () => {
          throw new Error("base caída");
        },
      }),
    );
    assert.match(confirmar.reply ?? "", /¿Confirmas\?/);
    assert.doesNotMatch(confirmar.reply ?? "", /anticipo/);
  });
});
