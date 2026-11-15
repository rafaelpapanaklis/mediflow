/* ═══════════════════════════════════════════════════════════════════════
   EL ERROR DE UNA TRANSICIÓN SALE EN ESPAÑOL, NUNCA CON «DONE» / «PENDING».

     npx tsx --test src/lib/barber/__tests__/estados-mensaje.test.ts

   Auditoría del 14-nov: `No se puede pasar de "DONE" a "PENDING"`.
   Esta prueba NO fija qué transiciones están permitidas (decisión de
   Rafael): solo que, sea cual sea el par, el texto sea legible.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, transitionErrorMessage, type BarberAppointmentStatus } from "../types";

const ALL: BarberAppointmentStatus[] = ["PENDING", "CONFIRMED", "IN_PROGRESS", "DONE", "NO_SHOW", "CANCELLED"];

test("el ejemplo del hallazgo: completada → pendiente", () => {
  assert.equal(
    transitionErrorMessage("DONE", "PENDING"),
    "Esta visita ya está completada: no se puede cambiar.",
  );
});

test("desde un estado final, siempre «ya está …: no se puede cambiar» (a donde sea)", () => {
  assert.equal(transitionErrorMessage("CANCELLED", "PENDING"), "Esta visita ya está cancelada: no se puede cambiar.");
  assert.equal(
    transitionErrorMessage("NO_SHOW", "DONE"),
    "Esta visita ya está marcada como «no llegó»: no se puede cambiar.",
  );
  assert.equal(transitionErrorMessage("DONE", "IN_PROGRESS"), "Esta visita ya está completada: no se puede cambiar.");
});

test("el destino sale entre comillas", () => {
  assert.equal(
    transitionErrorMessage("IN_PROGRESS", "CONFIRMED"),
    "No se puede regresar una visita en silla a «confirmada».",
  );
  assert.equal(
    transitionErrorMessage("PENDING", "IN_PROGRESS"),
    "No se puede pasar una visita de «pendiente» a «en silla» sin los pasos de en medio.",
  );
});

test("ningún par de estados filtra un nombre interno", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const text = transitionErrorMessage(from, to);
      assert.doesNotMatch(text, /PENDING|CONFIRMED|IN_PROGRESS|DONE|NO_SHOW|CANCELLED|"/, `${from}→${to}: ${text}`);
      assert.match(text, /^[A-ZÁÉÍÓÚ]/);
      assert.match(text, /\.$/);
    }
  }
});

test("marcha atrás, salto y «no llegó» tras sentarse dicen cosas distintas", () => {
  assert.match(transitionErrorMessage("CANCELLED", "PENDING"), /ya está cancelada: no se puede cambiar/);
  assert.match(transitionErrorMessage("IN_PROGRESS", "CONFIRMED"), /regresar una visita en silla a «confirmada»/);
  assert.match(transitionErrorMessage("PENDING", "DONE"), /pasar una visita de «pendiente» a «completada» sin los pasos de en medio/);
  assert.match(transitionErrorMessage("IN_PROGRESS", "NO_SHOW"), /ya está en silla/);
});

test("no cambia qué transiciones se permiten (las de hoy)", () => {
  assert.equal(canTransition("PENDING", "CONFIRMED"), true);
  assert.equal(canTransition("IN_PROGRESS", "DONE"), true);
  assert.equal(canTransition("DONE", "PENDING"), false);
  assert.equal(canTransition("NO_SHOW", "PENDING"), false);
  assert.equal(canTransition("CANCELLED", "PENDING"), false);
  assert.equal(canTransition("IN_PROGRESS", "NO_SHOW"), false);
});
