// QA B (15-nov-2026) · Caja: abrir o cerrar el turno con la cifra VACÍA.
//
// parseAmountText("") devuelve 0, y los dos diálogos lo usaban: «Abrir
// turno» con el fondo vacío abría con $0.00 sin preguntar, y «Cerrar turno»
// con el efectivo contado vacío cerraba con $0 contados → un faltante de TODO
// el efectivo del turno (−$607.70 en la prueba) en un turno que ya no se
// puede reabrir. Ahora vacío = «todavía no escribe nada»: el botón no se
// habilita hasta que haya una cifra; quien empieza sin fondo escribe 0.
//
//   npx tsx --test src/lib/barber/__tests__/turno-cifra-obligatoria.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAmountText, parseRequiredAmountText } from "@/components/barber/cash/money";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";

test("vacío NO es $0 en las cifras que se cuentan a mano", () => {
  assert.equal(parseAmountText(""), 0, "el parser de siempre sigue igual (descuento y propina vacíos = 0)");
  assert.equal(parseRequiredAmountText(""), null);
  assert.equal(parseRequiredAmountText("   "), null);
  assert.equal(parseRequiredAmountText("0"), 0, "empezar sin fondo se escribe");
  assert.equal(parseRequiredAmountText("607.70"), 607.7);
  assert.equal(parseRequiredAmountText("1,250.5"), 1250.5);
  assert.equal(parseRequiredAmountText("abc"), null);
  assert.equal(parseRequiredAmountText("-5"), null);
});

test("abrir y cerrar turno usan la versión obligatoria y lo dicen en es y en", () => {
  const src = readFileSync(join(__dirname, "../../../components/barber/cash/session-modals.tsx"), "utf8");
  assert.match(src, /const amount = parseRequiredAmountText\(amountText\)/);
  assert.match(src, /const counted = parseRequiredAmountText\(countedText\)/);
  assert.match(src, /disabled=\{amount === null \|\| busy\}/);
  assert.match(src, /disabled=\{counted === null \|\| busy\}/);
  for (const locale of ["es", "en"] as const) {
    const s = (((getBarberDict(locale) as Dictionary).barber as Dictionary).caja as Dictionary).session as Dictionary;
    assert.match(String(s.openingRequired), /0/, locale);
    assert.match(String(s.countedRequired), /0/, locale);
  }
});
