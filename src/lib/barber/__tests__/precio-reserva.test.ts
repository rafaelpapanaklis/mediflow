import { test } from "node:test";
import assert from "node:assert/strict";
import { formatoPrecioReserva } from "../precio-reserva";
import { precioBarberWeb } from "../landing";

test("la reserva muestra los centavos que la página pública muestra", () => {
  const f = formatoPrecioReserva("es-MX");
  assert.equal(f.format(99.99), "$99.99");
  assert.equal(f.format(99.99), precioBarberWeb(99.99));
  assert.equal(f.format(280), "$280");
  assert.equal(f.format(199.5), "$199.50");
});

test("en inglés también conserva los centavos", () => {
  const f = formatoPrecioReserva("en-US");
  assert.equal(f.format(99.99), "MX$99.99");
  assert.equal(f.format(180), "MX$180");
});
