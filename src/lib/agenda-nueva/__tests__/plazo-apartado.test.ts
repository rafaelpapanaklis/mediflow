// Agenda — el plazo de una cita apartada, con su día (H4 de la revisión final, ws1-t4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { plazoApartadoEnPalabras } from "../plazo-apartado";

const ZONA = "America/Mexico_City";
// 28-sep-2026, 20:30 en Ciudad de México.
const AHORA = new Date("2026-09-29T02:30:00.000Z");

test("el mismo día: solo la hora", () => {
  assert.equal(plazoApartadoEnPalabras("2026-09-29T03:00:00.000Z", AHORA, ZONA), "las 21:00");
});

test("al día siguiente: «mañana a las…» (plazo de 24 h)", () => {
  assert.equal(plazoApartadoEnPalabras("2026-09-30T01:00:00.000Z", AHORA, ZONA), "mañana a las 19:00");
});

test("más adelante: con la fecha", () => {
  assert.match(plazoApartadoEnPalabras("2026-10-01T01:00:00.000Z", AHORA, ZONA), /^el mié 30 (de )?sep a las 19:00$/);
});

test("el día se cuenta en la zona de la clínica, no en UTC", () => {
  // 23:30 del 28 en CDMX = 05:30 del 29 en UTC: sigue siendo «hoy».
  assert.equal(plazoApartadoEnPalabras("2026-09-29T05:30:00.000Z", AHORA, ZONA), "las 23:30");
});
