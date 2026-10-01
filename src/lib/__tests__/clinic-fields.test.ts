// A1/A2: lo que el panel acepta como nombre de clínica y como RFC.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  esNombreDeClinicaValido, esRfcValido, normalizarRfc, sinEtiquetas,
} from "../clinic-fields";
import { CAMPOS_EDITABLES } from "../landing-fields";

test("nombre: acepta nombres reales (acentos, &, punto, guiones, números)", () => {
  for (const n of ["Clínica Dental Sonrisa", "Dr. Pérez & Asociados", "Odonto-Plus 24/7", "Ñandú S.A. de C.V.", "Clínica «Los Pinos»"]) {
    assert.equal(esNombreDeClinicaValido(n), true, n);
  }
});

test("nombre: rechaza etiquetas, script y cierres de script", () => {
  for (const n of [
    '</script><script>alert(1)</script>',
    "<img src=x onerror=alert(1)>",
    "Clínica <b>",
    "a>b",
    "＜script＞",
    "Clínica\u0000",
  ]) {
    assert.equal(esNombreDeClinicaValido(n), false, n);
  }
});

test("nombre: rechaza vacío, muy corto, muy largo y tipos que no son texto", () => {
  assert.equal(esNombreDeClinicaValido(""), false);
  assert.equal(esNombreDeClinicaValido(" a "), false);
  assert.equal(esNombreDeClinicaValido("x".repeat(121)), false);
  assert.equal(esNombreDeClinicaValido("x".repeat(120)), true);
  for (const v of [null, undefined, 5, {}, ["Clínica"]]) assert.equal(esNombreDeClinicaValido(v), false);
});

test("sinEtiquetas: tab y salto de línea sí, controles no", () => {
  assert.equal(sinEtiquetas("a\tb\nc"), true);
  assert.equal(sinEtiquetas("a\u0007b"), false);
});

test("landing-fields: el nombre de la mini-web usa la misma regla", () => {
  assert.equal(CAMPOS_EDITABLES.name("Clínica Sonrisa"), true);
  assert.equal(CAMPOS_EDITABLES.name("</script><script>x</script>"), false);
});

test("RFC: persona moral, física, genéricos y minúsculas con espacios", () => {
  for (const r of ["ABC010101AB1", "PEGJ800101AB3", "XAXX010101000", "XEXX010101000", "Ñ&A010101AB1", " abc010101ab1 "]) {
    assert.equal(esRfcValido(r), true, r);
  }
  assert.equal(normalizarRfc(" abc010101ab1 "), "ABC010101AB1");
});

test("RFC: rechaza etiquetas, longitudes raras y tipos que no son texto", () => {
  for (const r of ['<script>alert(1)</script>', "ABC010101", "ABC010101AB12345", "12345678901", "ABC01010AAAB1", "", null, 12, {}]) {
    assert.equal(esRfcValido(r), false, String(r));
  }
});

test("/api/clinic y /api/settings validan nombre; /api/settings y /api/settings/cfdi validan RFC", () => {
  const leer = (f: string) => readFileSync(f, "utf8");
  const clinic = leer("src/app/api/clinic/route.ts");
  assert.match(clinic, /esNombreDeClinicaValido\(body\.name\)/);
  const settings = leer("src/app/api/settings/route.ts");
  assert.match(settings, /esNombreDeClinicaValido\(data\.name\)/);
  assert.match(settings, /esRfcValido\(v\)/);
  assert.match(settings, /"taxId", "rfcEmisor"/);
  assert.match(leer("src/app/api/settings/cfdi/route.ts"), /esRfcValido\(rfcEmisor\)/);
});
