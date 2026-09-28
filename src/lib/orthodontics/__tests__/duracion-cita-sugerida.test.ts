import { test } from "node:test";
import assert from "node:assert/strict";
import { duracionSugeridaDeOrtodoncia } from "../duracion-cita-sugerida";

const tipos = [
  { label: "Valoración de ortodoncia", durationMin: 45 },
  { label: "Control de ortodoncia", durationMin: 25 },
  { label: "Retiro de aparatología" },
  { label: "Urgencia de ortodoncia" },
];

test("manda lo que la clínica configuró para ese tipo (sin importar mayúsculas ni acentos)", () => {
  assert.deepEqual(duracionSugeridaDeOrtodoncia("control de ORTODONCIA", tipos), {
    minutos: 25,
    tipo: "Control de ortodoncia",
    origen: "configuracion",
  });
  assert.equal(duracionSugeridaDeOrtodoncia("Valoracion de ortodoncia", tipos)?.minutos, 45);
});

test("sin minutos propios, cae a la sugerencia por texto", () => {
  const r = duracionSugeridaDeOrtodoncia("Retiro de aparatología", tipos);
  assert.equal(r?.minutos, 60);
  assert.equal(r?.origen, "texto");
  assert.equal(r?.tipo, "Retiro de aparatología");
});

test("nada reconocible o vacío: null", () => {
  assert.equal(duracionSugeridaDeOrtodoncia("Urgencia de ortodoncia", tipos), null);
  assert.equal(duracionSugeridaDeOrtodoncia("Limpieza", tipos), null);
  assert.equal(duracionSugeridaDeOrtodoncia("   ", tipos), null);
});
