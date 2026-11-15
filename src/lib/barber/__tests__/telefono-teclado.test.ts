import { test } from "node:test";
import assert from "node:assert/strict";
import { soloTelefono } from "../telefono-teclado";

test("las letras no entran a un campo de teléfono; los signos de siempre sí", () => {
  assert.equal(soloTelefono("abc123xyz"), "123");
  assert.equal(soloTelefono("(55) 5555-0106"), "(55) 5555-0106");
  assert.equal(soloTelefono("+52 999 438.7769"), "+52 999 438.7769");
  assert.equal(soloTelefono("tel: 9994387769 ext"), " 9994387769 ");
  assert.equal(soloTelefono(""), "");
});
