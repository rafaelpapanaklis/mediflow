/**
 * Fechas relativas y disponibilidad en cualquier fecha (ws1-t5).
 *
 * Run: npm run test:wa-bot-fecha
 *
 * 1. El parser con «hoy» inyectado y en la zona de la clínica: «en 3
 *    semanas», «dentro de diez días», «en 2 meses», «la otra semana», «el
 *    próximo mes» (sin día → se pregunta), números en letra, fin de mes,
 *    cambio de año y medianoche en CDMX frente a UTC.
 * 2. La máquina de estados del agendado con dobles (sin BD ni WhatsApp): la
 *    pregunta «¿hay disponibilidad el 20 de mayo?» llega a los horarios de ESE
 *    día; si ese día no hay, se ofrece el siguiente con lugar (tope de 7
 *    días); «el próximo mes» pregunta el día y «el 10» es de ese mes; ante la
 *    lista de horarios se puede pedir otro día.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO,
  detectaIntencionDeAgenda,
  fechaDentroDelMesPedido,
  mesPedidoSinDia,
  nombreDeMes,
  parseDateInput,
  pideCitaConFecha,
} from "../booking-parse";
import { fechaISOEnZona as todayISOForTests } from "../fecha-contexto";
import { runBookingTurn, type BookingDeps } from "../booking-core";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";
import type { SlotResult } from "@/lib/agenda/bot-booking-service";

const CDMX = "America/Mexico_City";
const CANCUN = "America/Cancun";

/** Instante UTC que en CDMX (UTC-6, sin horario de verano desde 2022) es `fechaHora` local. */
function cdmx(fechaHora: string): Date {
  return new Date(`${fechaHora}-06:00`);
}

describe("fechas relativas — viernes 2 de octubre de 2026 en CDMX", () => {
  const VIE = cdmx("2026-10-02T12:00:00");
  const casos: Array<[string, string | null]> = [
    ["en 3 semanas", "2026-10-23"],
    ["dentro de 3 semanas", "2026-10-23"],
    ["dentro de tres semanas", "2026-10-23"],
    ["en tres semanas", "2026-10-23"],
    ["en una semana", "2026-10-09"],
    ["en un par de semanas", "2026-10-16"],
    ["en unas dos o tres semanas", "2026-10-16"], // manda el más cercano
    ["dentro de 10 días", "2026-10-12"],
    ["dentro de diez dias", "2026-10-12"],
    ["en 10 dias", "2026-10-12"],
    ["en ocho días", "2026-10-10"], // al pie de la letra (ver OCHO_Y_QUINCE_DIAS_COMO_SEMANAS)
    ["en quince días", "2026-10-17"],
    ["para dentro de veintiún días", "2026-10-23"],
    ["de aquí a un mes", "2026-11-02"],
    ["en 2 meses", "2026-12-02"],
    ["en dos meses", "2026-12-02"],
    ["en un mes", "2026-11-02"],
    ["dentro de 8 meses", "2027-06-02"],
    ["el martes en tres semanas", "2026-10-20"], // martes de la semana del 23
    ["en 3 semanas por la tarde", "2026-10-23"],
    ["la otra semana", "2026-10-05"], // lunes de la semana que viene
    ["la próxima semana", "2026-10-05"],
    ["la semana que viene", "2026-10-05"],
    ["el jueves de la otra semana", "2026-10-08"], // con día: ese día (como antes)
    ["el 15 del próximo mes", "2026-11-15"],
    ["el 15 del mes que entra", "2026-11-15"],
    ["el lunes del mes que entra", "2026-11-02"], // el primer lunes de noviembre
    ["el próximo mes", null], // sin día: el flujo pregunta
    ["el mes que entra", null],
    ["el mes que viene", null],
    ["en 3 semanas o el 20 de mayo", "2027-05-20"], // una fecha explícita manda
    ["hace 3 semanas me dolía", null], // pasado: no es una cita
    ["en la mañana", null],
    ["a las 10 de la mañana", null],
  ];
  for (const [texto, esperado] of casos) {
    it(`«${texto}» → ${esperado}`, () => assert.equal(parseDateInput(texto, CDMX, VIE), esperado));
  }

  it("«el próximo mes» sin día da el mes para preguntar qué día", () => {
    assert.equal(mesPedidoSinDia("el próximo mes", CDMX, VIE), "2026-11");
    assert.equal(mesPedidoSinDia("¿tienen lugar el mes que entra?", CDMX, VIE), "2026-11");
    assert.equal(mesPedidoSinDia("el 15 del próximo mes", CDMX, VIE), null); // ya trae día
    assert.equal(mesPedidoSinDia("en 3 semanas", CDMX, VIE), null);
    assert.equal(nombreDeMes("2026-11", CDMX, VIE), "noviembre");
    assert.equal(nombreDeMes("2027-01", CDMX, VIE), "enero de 2027");
  });

  it("la respuesta a «¿qué día de noviembre?» se lee dentro de noviembre", () => {
    assert.equal(fechaDentroDelMesPedido("el 10", "2026-11", CDMX, VIE), "2026-11-10");
    assert.equal(fechaDentroDelMesPedido("10", "2026-11", CDMX, VIE), "2026-11-10");
    assert.equal(fechaDentroDelMesPedido("el 1", "2026-11", CDMX, VIE), "2026-11-01"); // no el 1 de octubre
    assert.equal(fechaDentroDelMesPedido("el lunes", "2026-11", CDMX, VIE), "2026-11-02");
    assert.equal(fechaDentroDelMesPedido("el 31", "2026-11", CDMX, VIE), null); // noviembre no tiene 31
    assert.equal(fechaDentroDelMesPedido("15 de diciembre", "2026-11", CDMX, VIE), "2026-12-15");
    assert.equal(fechaDentroDelMesPedido("en 3 semanas", "2026-11", CDMX, VIE), "2026-10-23");
    assert.equal(fechaDentroDelMesPedido("mañana", "2026-11", CDMX, VIE), "2026-10-03");
  });
});

describe("fechas relativas — bordes", () => {
  it("fin de mes: «en un mes» desde el 31 de octubre es el 30 de noviembre", () => {
    const now = cdmx("2026-10-31T12:00:00");
    assert.equal(parseDateInput("en un mes", CDMX, now), "2026-11-30");
    assert.equal(parseDateInput("en 3 semanas", CDMX, now), "2026-11-21");
    assert.equal(parseDateInput("el próximo mes", CDMX, now), null);
    assert.equal(mesPedidoSinDia("el próximo mes", CDMX, now), "2026-11");
    assert.equal(parseDateInput("el 30 del mes que entra", CDMX, now), "2026-11-30");
  });

  it("fin de mes: 31 de enero + 1 mes = 28 de febrero (2027 no es bisiesto)", () => {
    assert.equal(parseDateInput("en un mes", CDMX, cdmx("2027-01-31T12:00:00")), "2027-02-28");
    assert.equal(parseDateInput("en un mes", CDMX, cdmx("2028-01-31T12:00:00")), "2028-02-29");
  });

  it("cambio de año: lunes 28 de diciembre de 2026", () => {
    const now = cdmx("2026-12-28T12:00:00");
    assert.equal(parseDateInput("en 3 semanas", CDMX, now), "2027-01-18");
    assert.equal(parseDateInput("dentro de diez días", CDMX, now), "2027-01-07");
    assert.equal(parseDateInput("en 2 meses", CDMX, now), "2027-02-28");
    assert.equal(parseDateInput("la otra semana", CDMX, now), "2027-01-04");
    assert.equal(parseDateInput("el 15 del próximo mes", CDMX, now), "2027-01-15");
    assert.equal(mesPedidoSinDia("el mes que entra", CDMX, now), "2027-01");
    assert.equal(nombreDeMes("2027-01", CDMX, now), "enero de 2027");
  });

  it("domingo: «la otra semana» es el lunes de mañana (semanas de lunes a domingo)", () => {
    assert.equal(parseDateInput("la otra semana", CDMX, cdmx("2026-10-04T12:00:00")), "2026-10-05");
  });

  it("a las 23:30 del 31 de octubre en CDMX (ya 1 de noviembre en UTC) cuenta el día de CDMX", () => {
    const now = new Date("2026-11-01T05:30:00Z");
    assert.equal(todayISOForTests(now, CDMX), "2026-10-31");
    assert.equal(parseDateInput("en 3 semanas", CDMX, now), "2026-11-21");
    assert.equal(parseDateInput("en un mes", CDMX, now), "2026-11-30");
    assert.equal(mesPedidoSinDia("el próximo mes", CDMX, now), "2026-11");
  });

  it("cada clínica con su zona: a la misma hora UTC Cancún ya está en el día siguiente", () => {
    const now = new Date("2026-11-01T05:30:00Z"); // 23:30 en CDMX, 00:30 en Cancún
    assert.equal(parseDateInput("dentro de 10 días", CDMX, now), "2026-11-10");
    assert.equal(parseDateInput("dentro de 10 días", CANCUN, now), "2026-11-11");
    assert.equal(mesPedidoSinDia("el próximo mes", CANCUN, now), "2026-12");
  });
});

describe("¿la pregunta de disponibilidad entra al agendado?", () => {
  const VIE = cdmx("2026-10-02T12:00:00");
  const intencion: Array<[string, "book" | null]> = [
    ["¿hay disponibilidad el 20 de mayo?", "book"],
    ["¿tienen lugar el 15 de junio?", "book"],
    ["¿hay algún espacio la otra semana?", "book"],
    ["¿tienen cupo en 3 semanas?", "book"],
    ["¿qué horarios disponibles hay el jueves?", "book"],
    ["¿me pueden atender el 20 de mayo?", "book"],
    ["¿Qué horario tienen?", null], // FAQ del horario de atención
    ["¿abren los sábados?", null],
  ];
  for (const [texto, esperado] of intencion) {
    it(`«${texto}» → ${esperado}`, () => assert.equal(detectaIntencionDeAgenda(texto), esperado));
  }

  it("pideCitaConFecha: intención de cita + un día o mes concreto", () => {
    assert.equal(pideCitaConFecha("¿hay disponibilidad el 20 de mayo?", CDMX, VIE), true);
    assert.equal(pideCitaConFecha("¿tienen lugar en 3 semanas?", CDMX, VIE), true);
    assert.equal(pideCitaConFecha("¿tienen disponibilidad el próximo mes?", CDMX, VIE), true);
    assert.equal(pideCitaConFecha("¿hay disponibilidad?", CDMX, VIE), false); // sin fecha: como antes
    assert.equal(pideCitaConFecha("¿Qué horario tienen el sábado?", CDMX, VIE), false);
  });
});

// ── Flujo de agendado con dobles ─────────────────────────────────────────────

function makeConfig(): BotConfigDTO {
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
  };
}

/** Agenda falsa: por fecha, lo que devuelve getAvailableSlots; el resto, cerrado. */
function makeDeps(agenda: Record<string, SlotResult>, consultas: string[]): BookingDeps {
  return {
    getClinicTimezone: async () => CDMX,
    getClinicName: async () => "Clínica Demo",
    listBookableServices: async () => [{ id: "svc1", name: "Limpieza", duration: 30 }],
    listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }],
    getAvailableSlots: async ({ dateISO }) => {
      consultas.push(dateISO);
      return agenda[dateISO] ?? { closed: true, reason: "closed_day", slots: [] };
    },
    createBotAppointment: async () => ({ ok: true, appointmentId: "appt1" }),
    rescheduleBotAppointment: async () => ({ ok: true, appointmentId: "appt1" }),
    getUpcomingAppointmentsForPatient: async () => [],
    findOrCreateWhatsAppPatient: async () => ({ id: "patNew" }),
    findServiceById: async () => ({ name: "Limpieza", duration: 30 }),
    findThreadExternalId: async () => "5215512345678",
    findAppointmentById: async () => null,
  };
}

function makeConvo(deps: BookingDeps) {
  let state: BotTurnResult["newBotState"] = null;
  return {
    async say(text: string): Promise<BotTurnResult> {
      const res = await runBookingTurn(
        {
          clinicId: "clinic1",
          threadId: "thread1",
          incomingText: text,
          history: [],
          patient: { id: "patP", phone: "5215512345678" },
          botState: state ?? null,
        } as BotTurnInput,
        makeConfig(),
        deps,
      );
      assert.ok(res, "runBookingTurn devolvió null");
      if (res.newBotState !== undefined) state = res.newBotState;
      return res;
    },
    get state(): any {
      return state;
    },
  };
}

// El flujo usa el reloj real: se usan fechas con año lejano, o se calculan
// con el mismo parser y el mismo «hoy».
const MAYO_2030 = "2030-05-20";

describe("agendado: disponibilidad en cualquier fecha", () => {
  it("«¿hay disponibilidad el 20 de mayo de 2030?» consulta SOLO ese día y ofrece sus horarios", async () => {
    const consultas: string[] = [];
    const c = makeConvo(makeDeps({ [MAYO_2030]: { closed: false, slots: ["10:00", "11:00"] } }, consultas));
    const r1 = await c.say("¿hay disponibilidad el 20 de mayo de 2030?");
    assert.match(r1.reply ?? "", /Con gusto reviso el lunes, 20 de mayo de 2030/);
    assert.match(r1.reply ?? "", /servicio/);
    const r2 = await c.say("1"); // servicio → doctor único → horarios del día pedido
    assert.deepEqual(consultas, [MAYO_2030]);
    assert.match(r2.reply ?? "", /Horarios disponibles el lunes, 20 de mayo de 2030/);
    assert.match(r2.reply ?? "", /1\. 10:00\n2\. 11:00/);
  });

  it("si ese día no hay lugar, ofrece el siguiente día con lugar (y lo dice)", async () => {
    const consultas: string[] = [];
    const c = makeConvo(
      makeDeps(
        {
          [MAYO_2030]: { closed: false, slots: [] }, // lleno
          "2030-05-23": { closed: false, slots: ["09:00"] },
        },
        consultas,
      ),
    );
    await c.say("¿tienen lugar el 20 de mayo de 2030?");
    const r = await c.say("1");
    assert.deepEqual(consultas, ["2030-05-20", "2030-05-21", "2030-05-22", "2030-05-23"]);
    assert.match(r.reply ?? "", /No quedan horarios disponibles el lunes, 20 de mayo de 2030\./);
    assert.match(r.reply ?? "", /El día más cercano con lugar es el jueves, 23 de mayo de 2030\./);
    assert.match(r.reply ?? "", /Horarios disponibles el jueves, 23 de mayo de 2030/);
    assert.equal(c.state.step, "slot");
    assert.equal(c.state.dateISO, "2030-05-23");
    // Y la cita se crea en el día ofrecido, no en el pedido.
    const r3 = await c.say("1");
    assert.match(r3.reply ?? "", /23 de mayo de 2030/);
  });

  it("el motivo del cierre se conserva (bloqueo con mensaje, doctor que no atiende)", async () => {
    const consultas: string[] = [];
    const c = makeConvo(
      makeDeps(
        {
          [MAYO_2030]: { closed: true, reason: "blocked", slots: [], mensajeBloqueo: "vacaciones" },
          "2030-05-21": { closed: true, reason: "doctor_off", slots: [] },
          "2030-05-22": { closed: false, slots: ["12:00"] },
        },
        consultas,
      ),
    );
    await c.say("¿hay espacio el 20 de mayo de 2030?");
    const r = await c.say("1");
    assert.match(r.reply ?? "", /la agenda está cerrada: vacaciones\./);
    assert.match(r.reply ?? "", /El día más cercano con lugar es el miércoles, 22 de mayo de 2030/);
  });

  it("busca como máximo 7 días hacia adelante; si no hay, pide otra fecha", async () => {
    const consultas: string[] = [];
    const c = makeConvo(makeDeps({ "2030-05-28": { closed: false, slots: ["09:00"] } }, consultas));
    await c.say("¿hay disponibilidad el 20 de mayo de 2030?");
    const r = await c.say("1");
    assert.equal(consultas.length, 8); // el día pedido + 7 (el 28 ya no se consulta)
    assert.equal(consultas.at(-1), "2030-05-27");
    assert.match(r.reply ?? "", /no hay atención\. Tampoco encontré lugar en los 7 días siguientes\. ¿Qué otra fecha te acomoda\?/);
    assert.equal(c.state.step, "date");
  });

  it("«en 3 semanas» como respuesta a la fecha", async () => {
    const consultas: string[] = [];
    const destino = parseDateInput("en 3 semanas", CDMX)!;
    const c = makeConvo(makeDeps({ [destino]: { closed: false, slots: ["09:00"] } }, consultas));
    await c.say("quiero una cita");
    await c.say("1");
    const r = await c.say("dentro de tres semanas");
    assert.deepEqual(consultas, [destino]);
    assert.match(r.reply ?? "", /Horarios disponibles/);
    assert.equal(addDaysISO(todayISOForTests(new Date(), CDMX), 21), destino);
  });

  it("«el próximo mes» sin día pregunta qué día, y «el 10» es de ese mes", async () => {
    const consultas: string[] = [];
    const mes = mesPedidoSinDia("el próximo mes", CDMX)!;
    const dia10 = `${mes}-10`;
    const c = makeConvo(makeDeps({ [dia10]: { closed: false, slots: ["09:00"] } }, consultas));
    await c.say("quiero una cita");
    await c.say("1");
    const r1 = await c.say("el mes que entra");
    assert.match(r1.reply ?? "", new RegExp(`¿Qué día de ${nombreDeMes(mes, CDMX)} te acomoda\\?`));
    assert.equal(consultas.length, 0);
    const r2 = await c.say("el 10");
    assert.deepEqual(consultas, [dia10]);
    assert.match(r2.reply ?? "", /Horarios disponibles/);
  });

  it("«¿tienen lugar el próximo mes?» como primer mensaje: tras el servicio pregunta el día", async () => {
    const consultas: string[] = [];
    const c = makeConvo(makeDeps({}, consultas));
    await c.say("¿tienen lugar el próximo mes?");
    const r = await c.say("1");
    assert.match(r.reply ?? "", /¿Qué día de .+ te acomoda\?/);
    assert.equal(consultas.length, 0);
  });

  it("ante la lista de horarios, «mejor el 15 de junio de 2030» cambia de día; «la 2» sigue eligiendo", async () => {
    const consultas: string[] = [];
    const c = makeConvo(
      makeDeps(
        {
          [MAYO_2030]: { closed: false, slots: ["10:00", "11:00"] },
          "2030-06-15": { closed: false, slots: ["16:00", "17:00"] },
        },
        consultas,
      ),
    );
    await c.say("¿hay disponibilidad el 20 de mayo de 2030?");
    await c.say("1");
    const r = await c.say("mejor el 15 de junio de 2030");
    assert.match(r.reply ?? "", /Horarios disponibles el sábado, 15 de junio de 2030/);
    assert.equal(c.state.step, "slot");
    const r2 = await c.say("la 2");
    assert.match(r2.reply ?? "", /17:00/);
    assert.equal(c.state.step, "confirm");
  });
});

// ── ws1-t5 (añadido): un mes sin día ─────────────────────────────────────────

describe("mes sin día («en enero», «¿hay lugar en febrero?»)", () => {
  const NOV20 = cdmx("2026-11-20T12:00:00");
  const DIC15 = cdmx("2026-12-15T12:00:00");

  const casos: Array<[Date, string, string]> = [
    [NOV20, "en enero", "2027-01"],
    [NOV20, "para enero", "2027-01"],
    [NOV20, "¿hay lugar en febrero?", "2027-02"],
    [NOV20, "a mediados de marzo", "2027-03"],
    [NOV20, "en noviembre", "2026-11"], // el mes en curso es este
    [NOV20, "en diciembre", "2026-12"],
    [NOV20, "en octubre", "2027-10"], // ya pasó: el del año que viene
    [NOV20, "enero de 2028", "2028-01"], // el año escrito manda
    [DIC15, "en enero", "2027-01"], // nunca el de hace 11 meses
    [DIC15, "para enero", "2027-01"],
    [DIC15, "¿hay lugar en febrero?", "2027-02"],
    [DIC15, "a mediados de marzo", "2027-03"],
    [DIC15, "en diciembre", "2026-12"],
    [DIC15, "en noviembre", "2027-11"],
  ];
  for (const [now, texto, mes] of casos) {
    const hoy = todayISOForTests(now, CDMX);
    it(`hoy ${hoy}: «${texto}» → pregunta qué día de ${mes}`, () => {
      assert.equal(parseDateInput(texto, CDMX, now), null);
      assert.equal(mesPedidoSinDia(texto, CDMX, now), mes);
    });
  }

  it("la pregunta nombra el mes, con año si no es el de la clínica", () => {
    assert.equal(nombreDeMes("2027-01", CDMX, DIC15), "enero de 2027");
    assert.equal(nombreDeMes("2026-12", CDMX, DIC15), "diciembre");
  });

  it("con día sigue siendo una fecha (no se pregunta)", () => {
    for (const now of [NOV20, DIC15]) {
      assert.equal(parseDateInput("el 10 de enero", CDMX, now), "2027-01-10");
      assert.equal(parseDateInput("10/01", CDMX, now), "2027-01-10");
      assert.equal(parseDateInput("enero 10", CDMX, now), "2027-01-10");
      assert.equal(parseDateInput("en enero, el 15", CDMX, now), "2027-01-15"); // no el próximo 15
      assert.equal(mesPedidoSinDia("el 10 de enero", CDMX, now), null);
    }
  });

  it("la respuesta «el 10» a «¿qué día de enero?» es el 10 de enero del año que entra", () => {
    assert.equal(fechaDentroDelMesPedido("el 10", "2027-01", CDMX, DIC15), "2027-01-10");
    assert.equal(fechaDentroDelMesPedido("el lunes", "2027-01", CDMX, DIC15), "2027-01-04");
  });

  it("«¿hay lugar en febrero?» entra al agendado (va antes que las FAQ)", () => {
    assert.equal(pideCitaConFecha("¿hay lugar en febrero?", CDMX, DIC15), true);
    assert.equal(pideCitaConFecha("¿tienen disponibilidad en enero?", CDMX, NOV20), true);
    assert.equal(pideCitaConFecha("¿Qué horario tienen en diciembre?", CDMX, NOV20), false);
  });

  it("flujo: «¿hay lugar en febrero de 2030?» → servicio → «¿Qué día de febrero de 2030…?» → «el 10»", async () => {
    const consultas: string[] = [];
    const c = makeConvo(makeDeps({ "2030-02-10": { closed: false, slots: ["09:00"] } }, consultas));
    await c.say("¿hay lugar en febrero de 2030?");
    const r1 = await c.say("1");
    assert.match(r1.reply ?? "", /¿Qué día de febrero de 2030 te acomoda\?/);
    assert.equal(consultas.length, 0);
    const r2 = await c.say("el 10");
    assert.deepEqual(consultas, ["2030-02-10"]);
    assert.match(r2.reply ?? "", /Horarios disponibles el domingo, 10 de febrero de 2030/);
  });
});
