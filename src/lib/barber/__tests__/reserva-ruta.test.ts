/* ═══════════════════════════════════════════════════════════════════════
   LA LIGA DE RESERVA PUEDE LLEVAR BARBERO Y/O SERVICIO.

     npx tsx --test src/lib/barber/__tests__/reserva-ruta.test.ts

   M13 de la auditoría del 14-nov: el «Reservar» de cada servicio en /b/<slug>
   no llevaba el servicio elegido. La ruta sigue igual sin parámetros extra.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarConfigBarberWeb, rutaReservaBarberia } from "../landing";

test("sin nada, la ruta de siempre", () => {
  assert.equal(rutaReservaBarberia("mi-barber"), "/b/mi-barber/reservar");
  assert.equal(rutaReservaBarberia("mi-barber", null, null), "/b/mi-barber/reservar");
});

test("con barbero: igual que antes", () => {
  assert.equal(rutaReservaBarberia("mi-barber", "b1"), "/b/mi-barber/reservar?barbero=b1");
});

test("con servicio: lleva ese servicio", () => {
  assert.equal(rutaReservaBarberia("mi-barber", null, "sv1"), "/b/mi-barber/reservar?servicio=sv1");
});

test("con los dos: los dos, y se escapa lo raro", () => {
  assert.equal(
    rutaReservaBarberia("mi-barber", "b 1", "sv&1"),
    "/b/mi-barber/reservar?barbero=b%201&servicio=sv%261",
  );
});

test("una barbería sin configuración guardada NO está apagada (la página base se ve)", () => {
  assert.equal(normalizarConfigBarberWeb(null).oculta, false);
  assert.equal(normalizarConfigBarberWeb(undefined).oculta, false);
  assert.equal(normalizarConfigBarberWeb({ oculta: true }).oculta, true);
});
