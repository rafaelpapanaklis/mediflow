/**
 * WS1-T4 ronda 6 · G6 — los enlaces sueltos van a la agenda que toca.
 *
 * Run: npx tsx --test src/lib/agenda/__tests__/rutas-agenda.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { enlaceNuevaCita, rutaAgenda, rutaAgendaSemana } from "../rutas-agenda";

test("con el menú nuevo, los enlaces van a /dashboard/agenda", () => {
  assert.equal(rutaAgenda(true), "/dashboard/agenda");
  assert.equal(rutaAgendaSemana(true), "/dashboard/agenda?view=week");
});

test("con el menú de siempre, se quedan en la agenda clásica", () => {
  assert.equal(rutaAgenda(false), "/dashboard/appointments");
  assert.equal(rutaAgendaSemana(false), "/dashboard/appointments?view=week");
  assert.equal(enlaceNuevaCita(false), "/dashboard/appointments?new=1");
});

test("con el menú nuevo «Nueva cita» no navega: abre la ventana", () => {
  assert.equal(enlaceNuevaCita(true), null);
});
