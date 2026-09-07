import { test } from "node:test";
import assert from "node:assert/strict";
import {
  possibleTransitions,
  canTransition,
  type UserRole,
} from "../transitions";
import type { AppointmentStatus } from "../types";

/**
 * Hallazgos 33 y 39 (mismo bug): `possibleTransitions()` devolvía "todos los
 * estados menos el actual" ignorando la matriz, así que el panel de la agenda
 * pintaba ~10 botones y el servidor rechazaba los inválidos con 409.
 *
 * Verificado en la app real (REPORTE-ws1-t2): en CHECKED_OUT el panel ofrecía
 * Confirmar / Iniciar consulta / Marcar no-show / Marcar completada y las
 * cuatro devolvían 409; y en una cita COMPLETADA ofrecía "Cancelar", que
 * también daba 409.
 */

const ALL_ROLES: UserRole[] = [
  "SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY",
] as UserRole[];

const EVERY_STATUS: AppointmentStatus[] = [
  "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR",
  "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW",
];

// Una cita que empezó hace 1 h: la gracia de no-show (15 min) ya pasó.
const NOW = new Date("2026-09-08T18:00:00Z");
const STARTED_1H_AGO = new Date("2026-09-08T17:00:00Z");
const STARTED_5M_AGO = new Date("2026-09-08T17:55:00Z");

test("39: una cita COMPLETADA no ofrece 'Cancelar' (el server da 409)", () => {
  const targets = possibleTransitions("COMPLETED");
  assert.ok(
    !targets.includes("CANCELLED"),
    `COMPLETED no debe ofrecer CANCELLED; ofreció [${targets.join(", ")}]`,
  );
  // Lo que la matriz SÍ permite desde COMPLETED.
  assert.deepEqual([...targets].sort(), ["CHECKED_OUT", "SCHEDULED"]);
});

test("33: CHECKED_OUT es terminal — no ofrece ninguna salida", () => {
  assert.deepEqual(possibleTransitions("CHECKED_OUT"), []);
});

test("33: en consulta no se ofrecen transiciones hacia atrás", () => {
  const targets = possibleTransitions("IN_PROGRESS");
  for (const backwards of ["CONFIRMED", "CHECKED_IN", "SCHEDULED", "NO_SHOW"] as const) {
    assert.ok(
      !targets.includes(backwards),
      `IN_PROGRESS no debe ofrecer ${backwards}; ofreció [${targets.join(", ")}]`,
    );
  }
  assert.deepEqual([...targets].sort(), ["CANCELLED", "CHECKED_OUT", "COMPLETED"]);
});

test("todo lo que el panel ofrece lo acepta canTransition para ALGÚN rol", () => {
  // Esta es la invariante que el bug rompía: el panel prometía botones que
  // NINGÚN rol podía ejecutar. Sin rol, possibleTransitions es estructural.
  for (const from of EVERY_STATUS) {
    for (const to of possibleTransitions(from)) {
      const someRoleCan = ALL_ROLES.some(
        (role) => canTransition(from, to, role, NOW, STARTED_1H_AGO).ok,
      );
      assert.ok(someRoleCan, `${from} → ${to} no lo puede hacer ningún rol`);
    }
  }
});

test("y al revés: nada que la matriz permita se queda fuera del panel", () => {
  for (const from of EVERY_STATUS) {
    const offered = possibleTransitions(from);
    for (const to of EVERY_STATUS) {
      const someRoleCan = ALL_ROLES.some(
        (role) => canTransition(from, to, role, NOW, STARTED_1H_AGO).ok,
      );
      if (someRoleCan) {
        assert.ok(offered.includes(to), `${from} → ${to} es válido y no se ofreció`);
      }
    }
  }
});

test("con rol, el panel ofrece solo lo de ESE rol", () => {
  // Recepción no inicia consultas (IN_PROGRESS es de CLINICAL en la matriz).
  const recepcion = possibleTransitions("CONFIRMED", { role: "RECEPTIONIST" as UserRole });
  assert.ok(!recepcion.includes("IN_PROGRESS"));
  assert.ok(recepcion.includes("CHECKED_IN"));

  // El doctor no confirma citas (CONFIRMED es de FRONT_DESK).
  const doctor = possibleTransitions("SCHEDULED", { role: "DOCTOR" as UserRole });
  assert.ok(!doctor.includes("CONFIRMED"));
  assert.ok(doctor.includes("IN_PROGRESS"));

  // READONLY no aparece en ninguna allowlist: ni un botón.
  assert.deepEqual(possibleTransitions("SCHEDULED", { role: "READONLY" as UserRole }), []);
});

test("la gracia de 15 min del no-show también se respeta en el panel", () => {
  const pronto = possibleTransitions("SCHEDULED", {
    now: NOW,
    appointmentStart: STARTED_5M_AGO,
  });
  assert.ok(
    !pronto.includes("NO_SHOW"),
    "no-show no debe ofrecerse dentro de la gracia de 15 min",
  );

  const tarde = possibleTransitions("SCHEDULED", {
    now: NOW,
    appointmentStart: STARTED_1H_AGO,
  });
  assert.ok(tarde.includes("NO_SHOW"));
});

test("sin argumentos opcionales sigue siendo estructural (ignora rol y predicates)", () => {
  // El contrato documentado de possibleTransitions: sin `role` no filtra por
  // rol. Esto es lo que usa el panel hoy, que no recibe el rol del usuario.
  assert.ok(possibleTransitions("SCHEDULED").includes("NO_SHOW"));
  assert.ok(possibleTransitions("SCHEDULED").includes("CONFIRMED"));
  assert.ok(possibleTransitions("SCHEDULED").includes("IN_PROGRESS"));
});
