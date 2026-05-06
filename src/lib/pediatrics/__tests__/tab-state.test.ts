/**
 * Tests unitarios de derivePediatricsTabState — la función pura que
 * decide si el tab "Pediatría" se renderiza enabled, disabled u hidden.
 *
 * El caso de regresión clave es `hasData=false + moduleActive=true →
 * disabled`. Antes de la UX clarificadora ese par caía en "hidden" y
 * dejaba sin feedback al admin que recién había contratado el módulo
 * pero abría un paciente adulto.
 *
 * Correr con:
 *   npx tsx --test src/lib/pediatrics/__tests__/tab-state.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivePediatricsTabState,
  PEDIATRICS_DISABLED_REASON,
} from "../tab-state";

test("paciente pediátrico + módulo activo → enabled", () => {
  assert.equal(
    derivePediatricsTabState({ hasData: true, moduleActive: true }),
    "enabled",
  );
});

test("paciente adulto + módulo activo → disabled (regresión PR #11)", () => {
  assert.equal(
    derivePediatricsTabState({ hasData: false, moduleActive: true }),
    "disabled",
  );
});

test("paciente sin DOB + módulo activo → disabled", () => {
  // hasData ya es false cuando loadPediatricsData detecta dob=null;
  // el tab se muestra deshabilitado con la misma razón.
  assert.equal(
    derivePediatricsTabState({ hasData: false, moduleActive: true }),
    "disabled",
  );
});

test("módulo no activo (cualquier paciente) → hidden", () => {
  assert.equal(
    derivePediatricsTabState({ hasData: false, moduleActive: false }),
    "hidden",
  );
});

test("hasData true pero módulo no activo → enabled (defensivo)", () => {
  // En la práctica nunca debería ocurrir — page.tsx solo carga datos
  // cuando canSeePediatrics aprueba, y eso exige módulo activo. Pero
  // el helper es puro y no asume contexto: si hay datos los muestra.
  assert.equal(
    derivePediatricsTabState({ hasData: true, moduleActive: false }),
    "enabled",
  );
});

test("razón del estado disabled — copy estable para el tooltip", () => {
  assert.equal(
    PEDIATRICS_DISABLED_REASON,
    "Disponible solo para pacientes menores de 18 años",
  );
});
