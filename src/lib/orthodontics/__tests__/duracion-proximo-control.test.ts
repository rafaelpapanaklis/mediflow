import { test } from "node:test";
import assert from "node:assert/strict";
import { duracionSugeridaProximoControl } from "../duracion-proximo-control";

test("usa la duración configurada de «Control de ortodoncia»", () => {
  assert.equal(duracionSugeridaProximoControl([{ label: "Control de ortodoncia", durationMin: 45 }]), 45);
});
test("una duración que el selector no ofrece se lleva a la más cercana", () => {
  assert.equal(duracionSugeridaProximoControl([{ label: "Control de ortodoncia", durationMin: 20 }]), 15);
  assert.equal(duracionSugeridaProximoControl([{ label: "Control de ortodoncia", durationMin: 75 }]), 60);
});
test("sin dato configurado devuelve null (la hoja usa 30)", () => {
  assert.equal(duracionSugeridaProximoControl([{ label: "Otra cita", durationMin: 60 }]), null);
  assert.equal(duracionSugeridaProximoControl(undefined), null);
});
