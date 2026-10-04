/**
 * Borrar un gasto con el diálogo del panel y diciendo que queda en la
 * bitácora; «Insumos Compra» con su espacio (ws1-t2, auditoría de uso del
 * 3/4-oct-2026, C-35 y C-36).
 *
 * Run: npm run test:finanzas-borrar-gasto
 *
 * Con el código viejo falla: `aviso-borrar-gasto.ts` no existía, las dos
 * pantallas de Finanzas usaban `window.confirm("¿Eliminar este gasto?")` y la
 * categoría quedaba pegada a la pastilla «Compra» en el texto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { avisoBorrarGasto } from "@/lib/finanzas/aviso-borrar-gasto";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

test("C-35: el aviso nombra el gasto y dice que queda en Movimientos", () => {
  const a = avisoBorrarGasto({ category: "Insumos", amount: 2700 });
  assert.equal(a.title, "¿Eliminar el gasto «Insumos» de $2,700.00?");
  assert.match(a.description, /Movimientos \(la bitácora\)/);
  assert.match(a.description, /deja de contar en los gastos y en la utilidad/i);
  assert.doesNotMatch(a.description, /inventario/);
  assert.equal(a.confirmText, "Eliminar gasto");
  const compra = avisoBorrarGasto({ category: "Insumos", amount: 2700, purchaseId: "p1" });
  assert.match(compra.description, /NO revierte las existencias/);
  const en = avisoBorrarGasto({ category: "Supplies", amount: 100 }, "en");
  assert.match(en.description, /audit log/);
  assert.equal(avisoBorrarGasto(null).title, "¿Eliminar el gasto?");
});

test("C-35: ninguna de las dos Finanzas usa el confirm() del navegador para borrar", () => {
  for (const f of ["src/components/dashboard/finanzas-rediseno/usar-finanzas.ts", "src/app/dashboard/finanzas/finanzas-client.tsx"]) {
    const s = leer(f);
    assert.doesNotMatch(s, /window\.confirm\(/, f);
    assert.match(s, /await confirm\(\{ \.\.\.aviso, variant: "danger" \}\)/, f);
    assert.match(s, /avisoBorrarGasto\(gasto,/, f);
  }
});

test("C-36: la categoría y «Compra» llevan un espacio en el texto", () => {
  assert.match(leer("src/components/dashboard/finanzas-rediseno/finanzas-rediseno.tsx"), /\{g\.purchaseId && " "\}/);
  assert.match(leer("src/app/dashboard/finanzas/finanzas-client.tsx"), /\{g\.purchaseId && " "\}/);
});
