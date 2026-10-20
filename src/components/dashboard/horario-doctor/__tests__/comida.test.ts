/**
 * LA COMIDA DEL HORARIO POR DOCTOR (WS1-T5) — la validación del cliente
 * espeja la del servidor, y el PUT solo lleva llaves de comida con la bandera.
 *
 *     npx tsx --test src/components/dashboard/horario-doctor/__tests__/comida.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { cuerpoPut, hayComidaInvalida, parseHorarioDoctor, validarComida, type Dia } from "../tipos";

const dia = (extra: Partial<Dia> = {}): Dia => ({
  dayOfWeek: 0,
  enabled: true,
  openTime: "09:00",
  closeTime: "18:00",
  ...extra,
});

test("validarComida: sin comida o con las dos horas bien, no hay error", () => {
  assert.equal(validarComida(dia()), null);
  assert.equal(validarComida(dia({ lunchStart: "", lunchEnd: "" })), null);
  assert.equal(validarComida(dia({ lunchStart: null, lunchEnd: null })), null);
  assert.equal(validarComida(dia({ lunchStart: "14:00", lunchEnd: "15:00" })), null);
  // Los bordes del horario valen (mismo semiabierto que el servidor).
  assert.equal(validarComida(dia({ lunchStart: "09:00", lunchEnd: "18:00" })), null);
});

test("validarComida: las dos horas o ninguna", () => {
  assert.equal(validarComida(dia({ lunchStart: "14:00", lunchEnd: "" }))?.clave, "settings.horarioDoctor.comida.errorPar");
  assert.equal(validarComida(dia({ lunchEnd: "15:00" }))?.clave, "settings.horarioDoctor.comida.errorPar");
});

test("validarComida: termina después de empezar", () => {
  assert.equal(validarComida(dia({ lunchStart: "15:00", lunchEnd: "14:00" }))?.clave, "settings.horarioDoctor.comida.errorOrden");
  assert.equal(validarComida(dia({ lunchStart: "14:00", lunchEnd: "14:00" }))?.clave, "settings.horarioDoctor.comida.errorOrden");
});

test("validarComida: dentro del horario del día, con las horas en las variables", () => {
  const e = validarComida(dia({ lunchStart: "08:00", lunchEnd: "09:30" }));
  assert.equal(e?.clave, "settings.horarioDoctor.comida.errorFuera");
  assert.deepEqual(e?.vars, { abre: "09:00", cierra: "18:00" });
  assert.equal(validarComida(dia({ lunchStart: "17:00", lunchEnd: "19:00" }))?.clave, "settings.horarioDoctor.comida.errorFuera");
});

test("validarComida: un día cerrado o con el rango roto no cuenta", () => {
  assert.equal(validarComida(dia({ enabled: false, lunchStart: "15:00", lunchEnd: "14:00" })), null);
  assert.equal(validarComida(dia({ openTime: "18:00", closeTime: "09:00", lunchStart: "10:00", lunchEnd: "11:00" })), null);
});

test("hayComidaInvalida mira todos los días", () => {
  assert.equal(hayComidaInvalida([dia(), dia({ dayOfWeek: 1, lunchStart: "14:00" })]), true);
  assert.equal(hayComidaInvalida([dia(), dia({ dayOfWeek: 1, lunchStart: "14:00", lunchEnd: "15:00" })]), false);
});

test("cuerpoPut sin comida no añade llaves de comida (el cuerpo de siempre)", () => {
  const cuerpo = cuerpoPut([dia({ lunchStart: "14:00", lunchEnd: "15:00" })]);
  for (const d of cuerpo.horario) {
    assert.deepEqual(Object.keys(d), ["dayOfWeek", "enabled", "openTime", "closeTime"]);
  }
});

test("cuerpoPut con comida manda lunchStart/lunchEnd en los 7 días, null si vacío", () => {
  const cuerpo = cuerpoPut([dia({ lunchStart: "14:00", lunchEnd: "15:00" }), dia({ dayOfWeek: 1, lunchStart: "", lunchEnd: "" })], true);
  assert.equal(cuerpo.horario.length, 7);
  assert.equal(cuerpo.horario[0].lunchStart, "14:00");
  assert.equal(cuerpo.horario[0].lunchEnd, "15:00");
  assert.equal(cuerpo.horario[1].lunchStart, null);
  assert.equal(cuerpo.horario[1].lunchEnd, null);
  assert.equal(cuerpo.horario[6].lunchStart, null);
});

test("parseHorarioDoctor lee comida (solo true cuenta) y conserva la comida de cada día", () => {
  const base = { hereda: false, horario: [{ dayOfWeek: 2, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "14:00", lunchEnd: "15:00" }] };
  const con = parseHorarioDoctor({ ...base, comida: true });
  assert.equal(con?.comida, true);
  assert.equal(con?.horario[2].lunchStart, "14:00");
  assert.equal(parseHorarioDoctor(base)?.comida, false);
  assert.equal(parseHorarioDoctor({ ...base, comida: "true" })?.comida, false);
});
