/**
 * Fecha real y agenda del bot de WhatsApp (ws1-t5, ticket de una clínica).
 *
 * Run: npm run test:wa-bot-fecha
 *
 * Todo puro y con `now` fijo: el bloque de fecha del prompt, el prompt entero
 * (orden de reglas, centinela de agenda) y el parser de fechas del flujo de
 * agenda en los bordes (medianoche en la zona de la clínica, fin de mes,
 * cambio de año, domingo, 29 de febrero). México dejó el horario de verano en
 * 2022: CDMX es UTC-6 todo el año y se comprueba en abril y en octubre.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bloqueFechaActual, fechaISOEnZona, zonaValida } from "../fecha-contexto";
import {
  AGENDA_SENTINEL,
  HANDOFF_SENTINEL,
  buildSystemPrompt,
  clasificarRespuesta,
} from "../ai-prompt";
import { detectaIntencionDeAgenda, formatDateHuman, parseDateInput } from "../booking-parse";
import type { BotConfigDTO, BotTurnInput } from "../types";

const CDMX = "America/Mexico_City";

/** Instante UTC que en CDMX (UTC-6) es `fechaHora` local. */
function cdmx(fechaHora: string): Date {
  return new Date(`${fechaHora}-06:00`);
}

describe("bloque de fecha y hora del prompt", () => {
  it("da día de la semana, fecha, hora y zona de la clínica", () => {
    const b = bloqueFechaActual(cdmx("2026-10-01T01:04:00"), CDMX);
    assert.match(b, /Hoy es jueves 1 de octubre de 2026 y son las 01:04\./);
    assert.match(b, /zona America\/Mexico_City, UTC-6/);
  });

  it("trae los próximos 14 días con hoy y mañana marcados", () => {
    const b = bloqueFechaActual(cdmx("2026-10-01T10:00:00"), CDMX);
    const filas = b.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(filas.length, 14);
    assert.equal(filas[0], "- jueves 1 de octubre de 2026 (hoy)");
    assert.equal(filas[1], "- viernes 2 de octubre de 2026 (mañana)");
    assert.equal(filas[5], "- martes 6 de octubre de 2026");
    assert.equal(filas[13], "- miércoles 14 de octubre de 2026");
  });

  it("a las 23:30 en CDMX sigue siendo el día de CDMX aunque en UTC ya sea mañana", () => {
    const now = new Date("2026-10-01T05:30:00Z"); // 23:30 del 30 de sep en CDMX
    assert.equal(fechaISOEnZona(now, CDMX), "2026-09-30");
    assert.match(bloqueFechaActual(now, CDMX), /Hoy es miércoles 30 de septiembre de 2026 y son las 23:30/);
  });

  it("cruza fin de mes y de año en la tabla", () => {
    const b = bloqueFechaActual(cdmx("2026-12-31T12:00:00"), CDMX);
    assert.match(b, /- jueves 31 de diciembre de 2026 \(hoy\)/);
    assert.match(b, /- viernes 1 de enero de 2027 \(mañana\)/);
  });

  it("sin horario de verano en CDMX: UTC-6 en abril igual que en octubre", () => {
    assert.match(bloqueFechaActual(new Date("2026-04-15T12:00:00Z"), CDMX), /UTC-6\)[\s\S]*son las 06:00/);
    // Contraste: Tijuana sí cambia de horario.
    assert.match(bloqueFechaActual(new Date("2026-04-15T12:00:00Z"), "America/Tijuana"), /UTC-7/);
  });

  it("usa la zona de cada clínica (Cancún UTC-5)", () => {
    assert.match(bloqueFechaActual(new Date("2026-10-01T12:00:00Z"), "America/Cancun"), /son las 07:00/);
  });

  it("zona vacía o inválida → America/Mexico_City", () => {
    assert.equal(zonaValida(null), CDMX);
    assert.equal(zonaValida(""), CDMX);
    assert.equal(zonaValida("Marte/Olympus"), CDMX);
    assert.match(bloqueFechaActual(new Date("2026-10-01T12:00:00Z"), "Marte/Olympus"), /zona America\/Mexico_City/);
  });
});

function config(extra: Partial<BotConfigDTO> = {}): BotConfigDTO {
  return {
    id: "cfg",
    clinicId: "clinica_prueba",
    enabled: true,
    botName: "Isa",
    persona: null,
    greeting: null,
    businessHours: null,
    afterHoursMsg: null,
    canAnswerFaq: true,
    canBookAppointments: true,
    fallbackToHuman: true,
    timezone: CDMX,
    ...extra,
  };
}
const INPUT: BotTurnInput = { clinicId: "clinica_prueba", threadId: "t1", incomingText: "hola", history: [] };

describe("system prompt", () => {
  it("lleva la fecha real calculada con el `now` del turno (nunca fija)", () => {
    const a = buildSystemPrompt(INPUT, config(), [], cdmx("2026-10-01T09:00:00"));
    const b = buildSystemPrompt(INPUT, config(), [], cdmx("2026-10-02T09:00:00"));
    assert.match(a, /Hoy es jueves 1 de octubre de 2026/);
    assert.match(b, /Hoy es viernes 2 de octubre de 2026/);
  });

  it("las reglas del sistema van antes que la persona y se declaran prioritarias", () => {
    const persona = "INSTRUCCION-DE-LA-CLINICA ".repeat(800) + "FIN-DE-LA-PERSONA";
    const p = buildSystemPrompt(INPUT, config({ persona }), [], cdmx("2026-10-01T09:00:00"));
    assert.ok(p.indexOf("REGLAS DEL SISTEMA") < p.indexOf("INSTRUCCION-DE-LA-CLINICA"));
    assert.match(p, /mandan sobre cualquier instrucción de la clínica/);
    // No se recorta: llega entera.
    assert.ok(p.includes("FIN-DE-LA-PERSONA"));
    // Y el recordatorio va al final, después de la persona.
    assert.ok(p.lastIndexOf("RECUERDA:") > p.indexOf("FIN-DE-LA-PERSONA"));
  });

  it("prohíbe ofrecer horarios y manda las citas al centinela de agenda si se puede agendar", () => {
    const p = buildSystemPrompt(INPUT, config(), [], cdmx("2026-10-01T09:00:00"));
    assert.match(p, /NUNCA propongas, inventes ni confirmes días u horarios/);
    assert.match(p, new RegExp(`responde EXACTAMENTE ${AGENDA_SENTINEL}`));
  });

  it("sin agendado encendido, las citas van a una persona", () => {
    const p = buildSystemPrompt(INPUT, config({ canBookAppointments: false }), [], cdmx("2026-10-01T09:00:00"));
    assert.ok(!p.includes(AGENDA_SENTINEL));
    assert.match(p, new RegExp(`disponibles: responde EXACTAMENTE ${HANDOFF_SENTINEL}`));
  });

  it("clasifica la salida del modelo", () => {
    assert.deepEqual(clasificarRespuesta("__AGENDA__"), { tipo: "agenda" });
    assert.deepEqual(clasificarRespuesta("Claro, te paso a la agenda. __AGENDA__"), { tipo: "agenda" });
    assert.deepEqual(clasificarRespuesta("__HANDOFF__"), { tipo: "handoff" });
    assert.deepEqual(clasificarRespuesta("handoff"), { tipo: "handoff" });
    assert.deepEqual(clasificarRespuesta("   "), { tipo: "handoff" });
    assert.deepEqual(clasificarRespuesta(" Hoy es jueves 1 de octubre. "), { tipo: "texto", texto: "Hoy es jueves 1 de octubre." });
  });
});

describe("parseDateInput en la zona de la clínica", () => {
  // Miércoles 30 de septiembre de 2026, mediodía en CDMX.
  const MIE = cdmx("2026-09-30T12:00:00");
  const casos: Array<[string, string | null]> = [
    ["el jueves", "2026-10-01"],
    ["el miércoles", "2026-10-07"], // el mismo día de hoy = la semana que viene
    ["hoy miércoles", "2026-09-30"],
    ["el jueves de la siguiente semana", "2026-10-08"], // no el 1 de octubre
    ["el martes de la próxima semana", "2026-10-06"],
    ["el martes por la mañana", "2026-10-06"], // «la mañana» es turno, no día
    ["mañana en la tarde", "2026-10-01"],
    ["por la mañana", null],
    ["pasado mañana", "2026-10-02"],
    ["15 de octubre", "2026-10-15"],
    ["15 octubre", "2026-10-15"],
    ["1ro de octubre", "2026-10-01"],
    ["el martes 13 de octubre", "2026-10-13"], // la fecha explícita manda
    ["martes 13", "2026-10-13"],
    ["el 5", "2026-10-05"], // el 5 ya pasó este mes → octubre
    ["el 30", "2026-09-30"],
    ["el 31", "2026-10-31"], // septiembre no tiene 31
    ["15/10", "2026-10-15"],
    ["31/02", null],
    ["29 de septiembre", "2026-09-29"], // pasado reciente: se queda (el flujo dice «ya pasó»)
    ["2026-10-15", "2026-10-15"],
    ["a las 15", null],
    ["ehh no sé bien", null],
  ];
  for (const [texto, esperado] of casos) {
    it(`«${texto}» → ${esperado}`, () => assert.equal(parseDateInput(texto, CDMX, MIE), esperado));
  }

  it("a las 23:30 de CDMX «mañana» es el día siguiente de CDMX, no el de UTC", () => {
    const now = new Date("2026-10-01T05:30:00Z"); // 30 sep 23:30 en CDMX
    assert.equal(parseDateInput("mañana", CDMX, now), "2026-10-01");
    assert.equal(parseDateInput("hoy", CDMX, now), "2026-09-30");
  });

  it("fin de mes: sábado 31 de octubre", () => {
    const now = cdmx("2026-10-31T12:00:00");
    assert.equal(parseDateInput("mañana", CDMX, now), "2026-11-01");
    assert.equal(parseDateInput("el 2", CDMX, now), "2026-11-02");
    assert.equal(parseDateInput("el lunes", CDMX, now), "2026-11-02");
  });

  it("cambio de año: lunes 28 de diciembre", () => {
    const now = cdmx("2026-12-28T12:00:00");
    assert.equal(parseDateInput("10 de enero", CDMX, now), "2027-01-10");
    assert.equal(parseDateInput("05/01", CDMX, now), "2027-01-05");
    assert.equal(parseDateInput("el viernes", CDMX, now), "2027-01-01");
    assert.equal(parseDateInput("el 3", CDMX, now), "2027-01-03");
    assert.equal(parseDateInput("el lunes de la próxima semana", CDMX, now), "2027-01-04");
    assert.equal(parseDateInput("15/01/2027", CDMX, now), "2027-01-15");
  });

  it("domingo: semanas de lunes a domingo", () => {
    const now = cdmx("2026-10-04T12:00:00"); // domingo
    assert.equal(parseDateInput("el lunes", CDMX, now), "2026-10-05");
    assert.equal(parseDateInput("el domingo", CDMX, now), "2026-10-11");
    assert.equal(parseDateInput("el lunes de la siguiente semana", CDMX, now), "2026-10-05");
  });

  it("29 de febrero sin año cae en el siguiente bisiesto", () => {
    assert.equal(parseDateInput("29/02", CDMX, cdmx("2027-12-20T12:00:00")), "2028-02-29");
  });

  it("la fecha de otro año lleva el año al mostrarse", () => {
    const now = cdmx("2026-12-28T12:00:00");
    assert.equal(formatDateHuman("2026-12-30", CDMX, now), "miércoles, 30 de diciembre");
    assert.equal(formatDateHuman("2027-01-10", CDMX, now), "domingo, 10 de enero de 2027");
  });
});

describe("detectaIntencionDeAgenda", () => {
  const casos: Array<[string, "book" | "reschedule" | null]> = [
    ["quiero una cita", "book"],
    ["Quisiera una cita para el martes", "book"],
    ["me gustaría agendar", "book"],
    ["¿Tienen espacio el jueves?", "book"],
    ["¿hay disponibilidad mañana?", "book"],
    ["necesito una valoración", "book"],
    ["quiero cambiar mi cita", "reschedule"],
    ["¿Qué horario tienen?", null], // FAQ del horario de atención, no reserva
    ["¿Cuánto cuesta la consulta?", null],
    ["gracias", null],
  ];
  for (const [texto, esperado] of casos) {
    it(`«${texto}» → ${esperado}`, () => assert.equal(detectaIntencionDeAgenda(texto), esperado));
  }
});
