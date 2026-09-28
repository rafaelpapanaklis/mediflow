import { test } from "node:test";
import assert from "node:assert/strict";
import { datosDeCierreDeCita, planDeCierreDeCita } from "../cerrar-cita-al-firmar";

const ahora = new Date("2026-09-28T19:00:00Z");
const inicio = new Date("2026-09-28T19:00:00Z");

test("desde «Agendada» el doctor cierra pasando por En consulta", () => {
  for (const estado of ["SCHEDULED", "CONFIRMED"]) {
    assert.deepEqual(planDeCierreDeCita(estado, "DOCTOR", ahora, inicio), { accion: "completar", pasaPorEnConsulta: true });
  }
});
test("desde en sillón o en consulta va directo", () => {
  assert.deepEqual(planDeCierreDeCita("IN_PROGRESS", "DOCTOR", ahora, inicio), { accion: "completar", pasaPorEnConsulta: false });
  assert.deepEqual(planDeCierreDeCita("IN_CHAIR", "DOCTOR", ahora, inicio), { accion: "completar", pasaPorEnConsulta: false });
});
test("cancelada, no asistió o ya completada: no se toca", () => {
  for (const estado of ["CANCELLED", "NO_SHOW", "COMPLETED"]) {
    assert.deepEqual(planDeCierreDeCita(estado, "DOCTOR", ahora, inicio), { accion: "nada" });
  }
});
test("un rol de solo lectura no cierra citas", () => {
  assert.deepEqual(planDeCierreDeCita("SCHEDULED", "READONLY", ahora, inicio), { accion: "nada" });
});
test("los datos a escribir traen startedAt y completedAt cuando pasa por En consulta", () => {
  const d = datosDeCierreDeCita({ accion: "completar", pasaPorEnConsulta: true }, ahora);
  assert.equal(d?.status, "COMPLETED");
  assert.ok(d && "startedAt" in d && "completedAt" in d);
  assert.equal(datosDeCierreDeCita({ accion: "nada" }, ahora), null);
});
