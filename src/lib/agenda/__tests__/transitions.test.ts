import { test } from "node:test";
import assert from "node:assert/strict";
import { availableTransitions, canTransition } from "../transitions";

// Una cita que empezó hace 1h (para que el predicate de no-show ya permita).
const NOW = new Date("2026-08-06T12:00:00Z");
const STARTED_1H_AGO = new Date("2026-08-06T11:00:00Z");
// Y una que empezó hace 5 min (dentro de la gracia de 15 min: no-show aún no).
const STARTED_5M_AGO = new Date("2026-08-06T11:55:00Z");

test("no-op: quedarse en el mismo estado se rechaza", () => {
  const r = canTransition("SCHEDULED", "SCHEDULED", "ADMIN", NOW, STARTED_1H_AGO);
  assert.equal(r.ok, false);
  assert.equal(r.code, "same_status");
});

test("READONLY no puede NADA: ni cancelar, ni completar, ni check-in", () => {
  // El agujero del no-op (P1-1): cualquier sesión cancelaba/completaba. Un rol
  // de solo lectura no aparece en ninguna allowlist de la matriz.
  for (const to of ["CANCELLED", "COMPLETED", "CHECKED_IN", "CONFIRMED"] as const) {
    const r = canTransition("SCHEDULED", to, "READONLY", NOW, STARTED_1H_AGO);
    assert.equal(r.ok, false, `READONLY → ${to} debería estar bloqueado`);
  }
  // Y no es solo desde SCHEDULED: tampoco puede cerrar una consulta en curso.
  const r = canTransition("IN_PROGRESS", "COMPLETED", "READONLY", NOW, STARTED_1H_AGO);
  assert.equal(r.ok, false);
  assert.equal(r.code, "forbidden_role");
});

test("recepción gestiona el mostrador pero NO completa consultas", () => {
  assert.equal(canTransition("SCHEDULED", "CONFIRMED", "RECEPTIONIST", NOW, STARTED_1H_AGO).ok, true);
  assert.equal(canTransition("CONFIRMED", "CHECKED_IN", "RECEPTIONIST", NOW, STARTED_1H_AGO).ok, true);
  assert.equal(canTransition("SCHEDULED", "CANCELLED", "RECEPTIONIST", NOW, STARTED_1H_AGO).ok, true);
  // Completar es acto clínico (COMPLETED es de CLINICAL en la matriz).
  const r = canTransition("IN_PROGRESS", "COMPLETED", "RECEPTIONIST", NOW, STARTED_1H_AGO);
  assert.equal(r.ok, false);
  assert.equal(r.code, "forbidden_role");
});

test("el doctor completa su consulta y arranca directo desde SCHEDULED", () => {
  assert.equal(canTransition("IN_PROGRESS", "COMPLETED", "DOCTOR", NOW, STARTED_1H_AGO).ok, true);
  // Atajos clínicos: muchas citas nunca pasan por CONFIRMED/CHECKED_IN.
  assert.equal(canTransition("SCHEDULED", "IN_PROGRESS", "DOCTOR", NOW, STARTED_1H_AGO).ok, true);
  assert.equal(canTransition("SCHEDULED", "IN_CHAIR", "DOCTOR", NOW, STARTED_1H_AGO).ok, true);
  // Pero cancelar una consulta EN CURSO es de admin, no del doctor.
  assert.equal(canTransition("IN_PROGRESS", "CANCELLED", "DOCTOR", NOW, STARTED_1H_AGO).ok, false);
});

test("transición fuera de la matriz → not_allowed (409), aunque seas admin", () => {
  const r = canTransition("CANCELLED", "COMPLETED", "SUPER_ADMIN", NOW, STARTED_1H_AGO);
  assert.equal(r.ok, false);
  assert.equal(r.code, "not_allowed");
});

test("no-show respeta la gracia de 15 min", () => {
  const early = canTransition("SCHEDULED", "NO_SHOW", "RECEPTIONIST", NOW, STARTED_5M_AGO);
  assert.equal(early.ok, false);
  assert.equal(early.code, "not_allowed");
  const late = canTransition("SCHEDULED", "NO_SHOW", "RECEPTIONIST", NOW, STARTED_1H_AGO);
  assert.equal(late.ok, true);
});

test("los escapes de estados terminales (y el de COMPLETED) son solo de admin", () => {
  for (const from of ["CANCELLED", "NO_SHOW", "COMPLETED"] as const) {
    assert.equal(canTransition(from, "SCHEDULED", "ADMIN", NOW, STARTED_1H_AGO).ok, true);
    const r = canTransition(from, "SCHEDULED", "RECEPTIONIST", NOW, STARTED_1H_AGO);
    assert.equal(r.ok, false, `${from} → SCHEDULED no debería poder recepción`);
    assert.equal(r.code, "forbidden_role");
  }
});

test("availableTransitions y canTransition cuentan la misma historia", () => {
  // Todo lo que availableTransitions ofrece debe pasar canTransition, y las
  // transiciones que canTransition permite deben estar ofrecidas. Cubre que
  // nadie edite la matriz por un lado y la validación por otro.
  const roles = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"] as const;
  const states = [
    "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR",
    "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW",
  ] as const;
  for (const role of roles) {
    for (const from of states) {
      const offered = availableTransitions(from, role, NOW, STARTED_1H_AGO);
      for (const to of offered) {
        assert.equal(
          canTransition(from, to, role, NOW, STARTED_1H_AGO).ok,
          true,
          `${role}: ${from} → ${to} ofrecida pero rechazada`,
        );
      }
      for (const to of states) {
        if (to === from || offered.includes(to)) continue;
        assert.equal(
          canTransition(from, to, role, NOW, STARTED_1H_AGO).ok,
          false,
          `${role}: ${from} → ${to} no ofrecida pero aceptada`,
        );
      }
    }
  }
});
