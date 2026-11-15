// QA B (15-nov-2026) · Productos → Movimiento: la ayuda decía «Positivo suma
// stock; negativo resta» también en «Salida (merma)», donde se escribe en
// POSITIVO y resta (con un negativo, «Registrar» se bloquea). Ahora cada tipo
// dice lo suyo; el ajuste ya pedía «Stock real contado».
//
//   npx tsx --test src/lib/barber/__tests__/movimiento-ayuda.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";

test("el diálogo de movimiento usa una ayuda por tipo, no la de los signos", () => {
  const src = readFileSync(join(__dirname, "../../../components/barber/products/product-modals.tsx"), "utf8");
  assert.match(src, /type === "ADJUST" \? t\("productos\.movementAdjustHint"\) : t\(type === "OUT" \? "productos\.movementOutHint" : "productos\.movementInHint"\)/);
});

test("los textos existen en es y en y hablan de positivo", () => {
  for (const locale of ["es", "en"] as const) {
    const p = (((getBarberDict(locale) as Dictionary).barber as Dictionary).caja as Dictionary).productos as Dictionary;
    assert.match(String(p.movementInHint), locale === "es" ? /positivo.*suman/ : /positive.*added/, locale);
    assert.match(String(p.movementOutHint), locale === "es" ? /positivo.*restan/ : /positive.*taken off/, locale);
  }
});
