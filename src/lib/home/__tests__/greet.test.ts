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
