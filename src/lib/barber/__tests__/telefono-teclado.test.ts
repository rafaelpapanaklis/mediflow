import { test } from "node:test";
import assert from "node:assert/strict";
import { soloDigitosTelefono } from "../phone-format";
import { mxTenDigits } from "@/lib/phone-mx";

test("teclear letras, guiones y espacios deja solo dígitos", () => {
  assert.equal(soloDigitosTelefono("999-555-0199 abc"), "9995550199");
  assert.equal(soloDigitosTelefono("abc"), "");
});

test("pegar un número con +52 sigue siendo válido para el servidor", () => {
  const pegado = soloDigitosTelefono("+52 999 555 0199");
  assert.equal(pegado, "529995550199");
  assert.equal(mxTenDigits(pegado), "9995550199");
});

test("tope de 13 dígitos (521 + 10)", () => {
  assert.equal(soloDigitosTelefono("52199955501991234").length, 13);
});

test("los signos de siempre (+ espacio - ( ) .) ya no se quedan: el servidor limpia con mxTenDigits", () => {
  assert.equal(soloDigitosTelefono("(55) 5555-0106"), "5555550106");
  assert.equal(soloDigitosTelefono("+52 999 438.7769"), "529994387769");
  assert.equal(mxTenDigits(soloDigitosTelefono("+52 999 438.7769")), "9994387769");
  assert.equal(soloDigitosTelefono("tel: 9994387769 ext"), "9994387769");
  assert.equal(soloDigitosTelefono(""), "");
});
