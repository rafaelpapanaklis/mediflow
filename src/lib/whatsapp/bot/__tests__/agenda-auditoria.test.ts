// ws1-t1 — arreglos de la auditoría del bot (REPORTE-ws1-t3) en el flujo de
// agenda: #2 (hora vs. número de opción), #3 (la negación gana en el
// «¿confirmas?»), #12 (número compartido), #16 («ya no» dentro de una frase),
// #18 (hora de ejemplo real) y la fecha que el paciente ya dijo al pedir la
// cita. Máquina de estados PURA con dependencias falsas: sin base, sin Meta.
// Correr: npm run test:wa-agenda-auditoria

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBookingTurn, type BookingDeps } from "../booking-core";
import {
  esCancelacionClara,
  interpretarEleccionDeHorario,
  parseDateInput,
  respuestaSiNo,
  turnoPedido,
} from "../booking-parse";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";

const TZ = "America/Mexico_City";

/** 09:00, 09:30 … hasta (sin incluir) `hasta`. */
function huecos(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const [h0, m0] = desde.split(":").map(Number);
  const [h1, m1] = hasta.split(":").map(Number);
  for (let m = h0 * 60 + m0; m < h1 * 60 + m1; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

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

interface Registro {
  creadas: any[];
  movidas: any[];
  pedidosDeHuecos: any[];
  altas: Array<{ nombre: string; opciones?: { crearNuevo?: boolean } }>;
  proximasDe: string[];
}

function makeDeps(over: Partial<BookingDeps> = {}, slots = huecos("09:00", "18:00")) {
  const reg: Registro = { creadas: [], movidas: [], pedidosDeHuecos: [], altas: [], proximasDe: [] };
  const deps: BookingDeps = {
    getClinicTimezone: async () => TZ,
    getClinicName: async () => "Clínica Demo",
    listBookableServices: async () => [{ id: "svc1", name: "Limpieza", duration: 30 }],
    listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }],
    getAvailableSlots: async (p) => {
      reg.pedidosDeHuecos.push(p);
      return { closed: false, slots };
    },
    createBotAppointment: async (p) => {
      reg.creadas.push(p);
      return { ok: true, appointmentId: "appt1" };
    },
    rescheduleBotAppointment: async (p) => {
      reg.movidas.push(p);
      return { ok: true, appointmentId: p.appointmentId };
    },
    getUpcomingAppointmentsForPatient: async (_c, patientId) => {
      reg.proximasDe.push(patientId);
      return [];
    },
    findOrCreateWhatsAppPatient: async (_c, _p, nombre, opciones) => {
      reg.altas.push({ nombre, opciones });
      return { id: "patNuevo" };
    },
    findServiceById: async () => ({ name: "Limpieza", duration: 30 }),
    findThreadExternalId: async () => "5215512345678",
    findAppointmentById: async () => null,
    ...over,
  };
  return { deps, reg };
}

function makeConvo(deps: BookingDeps, patient?: { id: string; phone?: string }) {
  let state: BotTurnResult["newBotState"] = null;
  return {
    async say(text: string): Promise<BotTurnResult> {
      const res = await runBookingTurn(
        { clinicId: "clinic1", threadId: "thread1", incomingText: text, history: [], patient, botState: state ?? null } as BotTurnInput,
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

/** Llega hasta la lista de horarios de mañana (paciente ya identificado). */
async function hastaLosHorarios(deps: BookingDeps) {
  const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
  await c.say("quiero una cita");
  await c.say("1");
  const lista = await c.say("mañana");
  assert.match(lista.reply ?? "", /Horarios disponibles/);
  return c;
}

describe("#2 — en el paso de horario, una hora es una hora (no el número de opción)", () => {
  it("la reproducción de la auditoría: lista desde las 09:00, «a las 10» → 10:00 (antes proponía 13:30)", async () => {
    const { deps } = makeDeps();
    const c = await hastaLosHorarios(deps);
    const r = await c.say("a las 10");
    assert.match(r.reply ?? "", /Confirmo tu cita/);
    assert.match(r.reply ?? "", /10:00/);
    assert.doesNotMatch(r.reply ?? "", /13:30/);
  });

  for (const texto of ["10", "10 am", "las 10", "a las 10 de la mañana", "10 hrs", "10:00"]) {
    it(`«${texto}» → 10:00`, async () => {
      const { deps } = makeDeps();
      const c = await hastaLosHorarios(deps);
      const r = await c.say(texto);
      assert.match(r.reply ?? "", /📅 .* a las 10:00/);
    });
  }

  it("un número que NO es una hora libre sigue siendo la opción: «3» → 10:00 (tercera de la lista)", async () => {
    const { deps } = makeDeps();
    const c = await hastaLosHorarios(deps);
    const r = await c.say("3");
    assert.match(r.reply ?? "", /a las 10:00/);
  });

  it("«opción 10» es la opción 10 (13:30), no las 10:00", async () => {
    const { deps } = makeDeps();
    const c = await hastaLosHorarios(deps);
    const r = await c.say("opción 10");
    assert.match(r.reply ?? "", /a las 13:30/);
  });

  it("«a las 4» sin am/pm → 16:00 (las 04:00 no existen); «a las 4 de la tarde» igual", async () => {
    const { deps } = makeDeps();
    const c = await hastaLosHorarios(deps);
    assert.match((await c.say("a las 4")).reply ?? "", /a las 16:00/);
    const { deps: d2 } = makeDeps();
    const c2 = await hastaLosHorarios(d2);
    assert.match((await c2.say("a las 4 de la tarde")).reply ?? "", /a las 16:00/);
  });

  it("«a las 10 y media» → 10:30", async () => {
    const { deps } = makeDeps();
    const c = await hastaLosHorarios(deps);
    assert.match((await c.say("a las 10 y media")).reply ?? "", /a las 10:30/);
  });

  it("una hora que no está libre se dice, no se cambia por una opción: «a las 8» → no disponible", async () => {
    const { deps } = makeDeps();
    const c = await hastaLosHorarios(deps);
    const r = await c.say("a las 8");
    assert.match(r.reply ?? "", /no está disponible/);
    assert.equal(c.state.step, "slot");
  });

  it("parser puro: casos de borde", () => {
    const opciones = huecos("09:00", "15:00"); // 12 mostradas
    const todas = huecos("09:00", "18:00");
    assert.deepEqual(interpretarEleccionDeHorario("1", opciones, todas), { tipo: "indice", indice: 0 });
    assert.deepEqual(interpretarEleccionDeHorario("la 2 porfa", opciones, todas), { tipo: "indice", indice: 1 });
    assert.deepEqual(interpretarEleccionDeHorario("#12", opciones, todas), { tipo: "indice", indice: 11 });
    assert.deepEqual(interpretarEleccionDeHorario("4pm", opciones, todas), { tipo: "hora", hora: "16:00" });
    assert.deepEqual(interpretarEleccionDeHorario("17", opciones, todas), { tipo: "hora", hora: "17:00" });
    assert.deepEqual(interpretarEleccionDeHorario("20", opciones, todas), { tipo: "hora_no_disponible" });
    assert.equal(interpretarEleccionDeHorario("cuando sea", opciones, todas), null);
  });
});

describe("#3 — en el «¿confirmas?», la negación gana", () => {
  for (const texto of ["no me va", "no sé, ok", "ok no", "Mmm no, mejor otro", "va, pero no a esa hora"]) {
    it(`«${texto}» NO crea la cita y vuelve a los horarios`, async () => {
      const { deps, reg } = makeDeps();
      const c = await hastaLosHorarios(deps);
      await c.say("1");
      const r = await c.say(texto);
      assert.equal(reg.creadas.length, 0, "se creó la cita con una negación");
      assert.match(r.reply ?? "", /elijamos otro horario/);
      assert.equal(c.state.step, "slot");
    });
  }

  for (const texto of ["sí", "Si claro", "ok", "va", "dale", "sí, no hay problema", "confirmo"]) {
    it(`«${texto}» sí crea la cita`, async () => {
      const { deps, reg } = makeDeps();
      const c = await hastaLosHorarios(deps);
      await c.say("1");
      await c.say(texto);
      assert.equal(reg.creadas.length, 1);
    });
  }

  it("sin sí ni no, vuelve a preguntar sin crear", async () => {
    const { deps, reg } = makeDeps();
    const c = await hastaLosHorarios(deps);
    await c.say("1");
    const r = await c.say("¿cuánto cuesta?");
    assert.equal(reg.creadas.length, 0);
    assert.match(r.reply ?? "", /¿Confirmas la cita\?/);
  });

  it("respuestaSiNo puro", () => {
    assert.equal(respuestaSiNo("no me va"), "no");
    assert.equal(respuestaSiNo("nel"), "no");
    assert.equal(respuestaSiNo("cómo no"), "si");
    assert.equal(respuestaSiNo("¿por qué no?"), "si");
    assert.equal(respuestaSiNo("Sí"), "si");
    assert.equal(respuestaSiNo("hola"), null);
  });
});

describe("#16 — «ya no» dentro de una frase no cancela el agendado", () => {
  it("la reproducción de la auditoría: «ya no me duele, ¿qué día puedo ir?» sigue en el flujo", async () => {
    const { deps } = makeDeps();
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    await c.say("quiero una cita");
    await c.say("1"); // → pide fecha
    const r = await c.say("ya no me duele, ¿qué día puedo ir?");
    assert.doesNotMatch(r.reply ?? "", /cancelé la solicitud/);
    assert.ok(c.state, "la sesión de agenda se perdió");
    assert.equal(c.state.step, "date");
  });

  for (const texto of ["cancelar", "ya no", "Ya no, gracias", "olvídalo", "cancela la cita por favor", "mejor ya no", "salir"]) {
    it(`«${texto}» sí cancela`, async () => {
      const { deps } = makeDeps();
      const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
      await c.say("quiero una cita");
      const r = await c.say(texto);
      assert.match(r.reply ?? "", /cancelé la solicitud/);
      assert.equal(r.newBotState, null);
    });
  }

  it("esCancelacionClara puro", () => {
    assert.equal(esCancelacionClara("ya no quiero la cita"), true);
    assert.equal(esCancelacionClara("ya no me duele"), false);
    assert.equal(esCancelacionClara("déjalo así, a las 10 está bien"), false);
    assert.equal(esCancelacionClara("no"), false);
  });
});

describe("#18 — la hora de ejemplo es un hueco real que no se mostró", () => {
  // ws1-t3 (botones): se muestran 10 (el tope de filas de una lista de
  // WhatsApp), no 12; el primer hueco que no cupo es 14:00.
  it("clínica que cierra a las 16:00: el ejemplo es 14:00, no un «16:30» que no existe", async () => {
    const { deps } = makeDeps({}, huecos("09:00", "16:00")); // 14 huecos, se muestran 10
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    await c.say("quiero una cita");
    await c.say("1");
    const r = await c.say("mañana");
    assert.doesNotMatch(r.reply ?? "", /16:30/);
    assert.match(r.reply ?? "", /por ejemplo 14:00/);
    // Y escribir el ejemplo funciona.
    const r2 = await c.say("14:00");
    assert.match(r2.reply ?? "", /a las 14:00/);
  });

  it("si todos los huecos caben en la lista, no hay ejemplo", async () => {
    const { deps } = makeDeps({}, ["09:00", "09:30"]);
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    await c.say("quiero una cita");
    await c.say("1");
    const r = await c.say("mañana");
    assert.doesNotMatch(r.reply ?? "", /por ejemplo/);
  });
});

describe("#12 — número compartido: primero, para quién es la cita", () => {
  const duenos = [
    { id: "patMama", firstName: "Laura", lastName: "Gómez" },
    { id: "patHijo", firstName: "Luis", lastName: "Gómez" },
  ];

  it("la reproducción de la auditoría: el segundo del número pide cita → se le pregunta, y queda a SU nombre", async () => {
    const { deps, reg } = makeDeps({ listPhoneOwners: async () => duenos });
    // El webhook pasa al PRIMERO del número (phoneOwners[0]).
    const c = makeConvo(deps, { id: "patMama", phone: "5215512345678" });
    const r1 = await c.say("quiero agendar");
    assert.match(r1.reply ?? "", /¿Para quién es la cita\?/);
    assert.match(r1.reply ?? "", /1\. Laura G\./);
    assert.match(r1.reply ?? "", /2\. Luis G\./);
    assert.match(r1.reply ?? "", /3\. Otra persona/);
    await c.say("2");
    await c.say("1"); // servicio
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(reg.creadas.length, 1);
    assert.equal(reg.creadas[0].patientId, "patHijo");
  });

  it("también vale el nombre: «para Luis»", async () => {
    const { deps, reg } = makeDeps({ listPhoneOwners: async () => duenos });
    const c = makeConvo(deps, { id: "patMama", phone: "5215512345678" });
    await c.say("quiero agendar");
    await c.say("para Luis");
    await c.say("1");
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(reg.creadas[0].patientId, "patHijo");
  });

  it("«otra persona» → pide nombre y da de alta un paciente NUEVO (no reutiliza el del número)", async () => {
    const { deps, reg } = makeDeps({ listPhoneOwners: async () => duenos });
    const c = makeConvo(deps, { id: "patMama", phone: "5215512345678" });
    await c.say("quiero agendar");
    await c.say("3");
    await c.say("1");
    await c.say("mañana");
    const r = await c.say("1");
    assert.match(r.reply ?? "", /nombre/i);
    await c.say("Sofía Gómez");
    assert.deepEqual(reg.altas, [{ nombre: "Sofía Gómez", opciones: { crearNuevo: true } }]);
    await c.say("sí");
    assert.equal(reg.creadas[0].patientId, "patNuevo");
  });

  it("reagendar en un número compartido también pregunta de quién es la cita", async () => {
    const { deps, reg } = makeDeps({ listPhoneOwners: async () => duenos });
    const c = makeConvo(deps, { id: "patMama", phone: "5215512345678" });
    const r1 = await c.say("quiero reagendar mi cita");
    assert.match(r1.reply ?? "", /¿De quién es la cita/);
    assert.doesNotMatch(r1.reply ?? "", /Otra persona/);
    await c.say("2");
    assert.deepEqual(reg.proximasDe, ["patHijo"]);
  });

  it("con un solo dueño, nada cambia (no pregunta)", async () => {
    const { deps } = makeDeps({ listPhoneOwners: async () => [duenos[0]] });
    const c = makeConvo(deps, { id: "patMama", phone: "5215512345678" });
    const r1 = await c.say("quiero agendar");
    assert.match(r1.reply ?? "", /servicio/);
  });
});

describe("Fecha dicha al pedir la cita (t5): se precarga y no se vuelve a preguntar", () => {
  it("«quiero una cita el lunes en la tarde» → tras el servicio, horarios del lunes por la tarde", async () => {
    const { deps, reg } = makeDeps();
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    const texto = "quiero una cita el lunes en la tarde";
    await c.say(texto);
    const r = await c.say("1"); // servicio → doctor único → ya NO pregunta la fecha
    assert.doesNotMatch(r.reply ?? "", /¿Para qué fecha/);
    assert.match(r.reply ?? "", /Horarios disponibles el lunes/);
    assert.equal(reg.pedidosDeHuecos[0].dateISO, parseDateInput(texto, TZ));
    // Solo huecos de la tarde en la lista.
    assert.doesNotMatch(r.reply ?? "", /\d\. 09:00/);
    assert.match(r.reply ?? "", /1\. 12:00/);
  });

  it("si el turno pedido no tiene huecos, lo dice y enseña los que hay", async () => {
    const { deps } = makeDeps({}, ["09:00", "09:30"]);
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    await c.say("quiero cita mañana en la tarde");
    const r = await c.say("1");
    assert.match(r.reply ?? "", /no quedan horarios por la tarde/);
    assert.match(r.reply ?? "", /1\. 09:00/);
  });

  it("sin fecha en el mensaje, pregunta como siempre", async () => {
    const { deps } = makeDeps();
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    await c.say("quiero una cita");
    const r = await c.say("1");
    assert.match(r.reply ?? "", /¿Para qué fecha/);
  });

  it("con varios doctores, la fecha espera a que elija doctor", async () => {
    const { deps } = makeDeps({
      listBookableDoctors: async () => [
        { id: "doc1", firstName: "Ana", lastName: "García" },
        { id: "doc2", firstName: "Beto", lastName: "Ruiz" },
      ],
    });
    const c = makeConvo(deps, { id: "patP", phone: "5215512345678" });
    await c.say("necesito una cita para mañana");
    const r2 = await c.say("1");
    assert.match(r2.reply ?? "", /profesional/);
    const r3 = await c.say("2");
    assert.match(r3.reply ?? "", /Horarios disponibles el .* con Beto Ruiz/);
  });

  it("turnoPedido puro: «mañana» como día no es turno", () => {
    assert.equal(turnoPedido("el lunes en la tarde"), "tarde");
    assert.equal(turnoPedido("el martes por la mañana"), "manana");
    assert.equal(turnoPedido("mañana"), null);
  });
});
