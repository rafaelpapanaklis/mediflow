// QA A (15-nov-2026): en la reserva pública, con el nombre vacío salía la
// burbuja del NAVEGADOR («Please fill out this field» con el celular en
// inglés) en vez del aviso de la barbería; el teléfono sí usaba el propio.
//   npx tsx --test src/lib/barber/__tests__/reserva-formulario.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FLUJO = readFileSync("src/components/barber/booking/booking-flow.tsx", "utf8");

test("el formulario de datos no deja que el navegador valide por su cuenta", () => {
  assert.match(FLUJO, /<form\s+noValidate\s+onSubmit=/);
});

test("el nombre y el teléfono los valida submit() con los textos del diccionario (es y en)", () => {
  assert.match(FLUJO, /name\.trim\(\)\.length < 2\) return setError\(t\("barber\.reserva\.errores\.nombreCorto"\)\)/);
  assert.match(FLUJO, /barber\.reserva\.errores\.telefonoInvalido/);
  for (const lang of ["es", "en"]) {
    const d = JSON.parse(readFileSync(`src/i18n/dictionaries/barber/reserva.${lang}.json`, "utf8"));
    assert.ok(d.errores?.nombreCorto, `${lang}: nombreCorto`);
    assert.ok(d.errores?.telefonoInvalido, `${lang}: telefonoInvalido`);
  }
});
