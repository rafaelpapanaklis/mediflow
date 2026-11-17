/**
 * Reportes: al cambiar de SEDE se suelta el filtro de barbero (QA de cierre E,
 * 16-nov-2026). Antes la liga conservaba `barber=<id de la sede anterior>`: la
 * sede nueva salía en $0.00 y el selector decía «Todos los barberos», porque
 * ese barbero no es de ahí.
 *
 *   npx tsx --test src/lib/barber/__tests__/reportes-sede-limpia-barbero.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.resolve(__dirname, "../../../components/barber/dashboard/reportes-view.tsx"), "utf8");

test("el selector de sede navega con el barbero vacío", () => {
  assert.match(src, /aria-label=\{t\("branch\.label"\)\} onChange=\{\(e\) => go\(\{ branch: e\.target\.value, barber: "" \}\)\}/);
});

test("un barbero vacío no viaja en la liga; periodo y sede se conservan", () => {
  // buildQuery solo pone `barber` si trae algo: «""» lo quita.
  assert.match(src, /const barber = next\.barber !== undefined \? next\.barber : currentBarber;\s*\n\s*if \(barber\) p\.set\(/);
  // El selector de barbero y los botones de periodo no tocan la sede.
  assert.match(src, /onChange=\{\(e\) => go\(\{ barber: e\.target\.value \}\)\}/);
  assert.match(src, /go\(\{ range: r \}\)/);
});
