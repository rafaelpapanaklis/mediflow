import { test } from "node:test";
import assert from "node:assert/strict";
import { accionDeFases } from "../efectos-estado-caso";

const f = (id: string, phaseKey: string, status: string, orderIndex: number) => ({ id, phaseKey, status, orderIndex });
const fases = [f("a", "ALIGNMENT", "PENDING", 1), f("b", "LEVELING", "PENDING", 2), f("r", "RETENTION", "PENDING", 9)];

test("colocar la aparatología arranca la primera fase", () => {
  assert.deepEqual(accionDeFases("IN_PROGRESS", fases), { completar: [], iniciar: "a" });
});
test("si ya hay una fase en curso no se toca", () => {
  assert.deepEqual(accionDeFases("IN_PROGRESS", [f("a", "ALIGNMENT", "IN_PROGRESS", 1)]), { completar: [], iniciar: null });
});
test("pasar a retención cierra la fase en curso y abre retención", () => {
  const con = [f("a", "ALIGNMENT", "IN_PROGRESS", 1), f("r", "RETENTION", "PENDING", 9)];
  assert.deepEqual(accionDeFases("RETENTION", con), { completar: ["a"], iniciar: "r" });
});
test("si retención ya está en curso no hace nada", () => {
  assert.deepEqual(accionDeFases("RETENTION", [f("r", "RETENTION", "IN_PROGRESS", 9)]), { completar: [], iniciar: null });
});
test("pausa o abandono no tocan fases", () => {
  assert.deepEqual(accionDeFases("ON_HOLD", fases), { completar: [], iniciar: null });
});
