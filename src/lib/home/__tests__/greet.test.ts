// H26 (QA ws1-t9): "Hoy" decía "lunes, 28 de septiembre" a las 23:25 del
// domingo en CDMX (01:25 EDT del servidor de pruebas) mientras la Agenda, que
// ya pinta en la zona de la clínica, decía "domingo 27" — bien. Ver ../greet.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLongDate, timeGreeting } from "../greet";

// 23:25 del domingo 27-sep-2026 en CDMX (UTC-6) = 05:25 UTC del lunes 28.
const INSTANTE_QA = new Date("2026-09-28T05:25:00.000Z");
const CDMX = "America/Mexico_City";

test("EL CASO QUE FALLABA HOY: en la zona de la clínica sigue siendo domingo, aunque en UTC ya sea lunes", () => {
  const fecha = formatLongDate(INSTANTE_QA, CDMX);
  assert.match(fecha, /^domingo/);
  assert.doesNotMatch(fecha, /^lunes/);
});

test("sin zona (home vieja): usa la del entorno, comportamiento de siempre", () => {
  // No se afirma el día (depende de dónde corra el test); solo que no truena.
  assert.doesNotThrow(() => formatLongDate(INSTANTE_QA));
});

test("timeGreeting: 23:25 en CDMX sigue siendo de noche, no de madrugada del día siguiente", () => {
  assert.equal(timeGreeting(INSTANTE_QA, CDMX), "Buenas noches");
});

test("timeGreeting respeta la zona en horas normales del día", () => {
  const mediodiaCdmx = new Date("2026-09-28T18:00:00.000Z"); // 12:00 CDMX
  assert.equal(timeGreeting(mediodiaCdmx, CDMX), "Buenos días");
});

test("timeGreeting con zona inválida no truena (Intl.DateTimeFormat la rechazaría)", () => {
  assert.doesNotThrow(() => timeGreeting(INSTANTE_QA, "Zona/Inventada"));
});

// ws1-t9 (revisión en panel.108, fallo 7): «TU SIGUIENTE PACIENTE» pintaba la
// hora en la zona del NAVEGADOR (17:00 en Nueva York) mientras el aviso de la
// misma cita la pintaba en la de la clínica (15:00). Estas pruebas pasan la
// zona explícita, así que no dependen de la del equipo que las corre.
import { diaEnZona, diasHastaEnZona, formatShortTime } from "../greet";

const CITA_21Z = "2026-10-02T21:00:00.000Z"; // 15:00 en CDMX (UTC-6)

test("formatShortTime con la zona de la clínica da la hora de la clínica (15:00), no la del navegador (17:00 en NY)", () => {
  assert.equal(formatShortTime(CITA_21Z, CDMX), "15:00");
  assert.equal(formatShortTime(CITA_21Z, "America/New_York"), "17:00");
});

test("formatShortTime con zona vacía o corrupta no truena (cae a la de la Agenda)", () => {
  assert.doesNotThrow(() => formatShortTime(CITA_21Z, ""));
  assert.doesNotThrow(() => formatShortTime(CITA_21Z, "No/Existe"));
  assert.equal(formatShortTime(CITA_21Z, "No/Existe"), "15:00");
});

test("diaEnZona y diasHastaEnZona cuentan los días en la zona de la clínica", () => {
  // 23:25 del domingo 27-sep en CDMX = lunes 28 en UTC.
  assert.equal(diaEnZona(INSTANTE_QA, CDMX), "2026-09-27");
  assert.equal(diaEnZona(INSTANTE_QA, "UTC"), "2026-09-28");
  // Una cita a las 00:30 del lunes (CDMX) es «mañana», no «hoy», para ese domingo.
  assert.equal(diasHastaEnZona("2026-09-28T06:30:00.000Z", INSTANTE_QA, CDMX), 1);
  assert.equal(diasHastaEnZona("2026-09-28T06:30:00.000Z", INSTANTE_QA, "UTC"), 0);
});
