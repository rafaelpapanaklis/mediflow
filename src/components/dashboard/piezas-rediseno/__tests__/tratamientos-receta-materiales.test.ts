/**
 * A3 de la QA en vivo de ws1-t10 (REPORTE-ws1-t10.md): en el rediseño de
 * Tratamientos, "Registrar sesión" no tenía el selector de procedimiento, así
 * que la receta de materiales nunca se disparaba desde la pantalla (el motor
 * sí funcionaba, probado por API). La vista vieja (treatments-client.tsx,
 * fuera de rediseño) siempre lo tuvo — este candado exige que el rediseño
 * tenga el mismo selector, conectado al mismo estado que ya usa `addSession`.
 *
 * Run: npx tsx --test src/components/dashboard/piezas-rediseno/__tests__/tratamientos-receta-materiales.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const REDISENO = leer("components/dashboard/piezas-rediseno/tratamientos.tsx");
const CLIENTE = leer("app/dashboard/treatments/treatments-client.tsx");

test("el rediseño de Tratamientos pinta el selector de procedimiento en Registrar sesión", () => {
  assert.match(REDISENO, /procedureOpts:\s*\{[^}]*\}\[\]/, "TratamientosVm declara procedureOpts");
  assert.match(REDISENO, /selProcedureId:\s*string/, "TratamientosVm declara selProcedureId");
  assert.match(REDISENO, /setSelProcedureId:\s*\(v:\s*string\)\s*=>\s*void/, "TratamientosVm declara setSelProcedureId");
  assert.match(REDISENO, /loadProcedureOpts:\s*\(\)\s*=>\s*Promise<void>/, "TratamientosVm declara loadProcedureOpts");
  // El <select> tiene que existir y leer/escribir el mismo estado.
  assert.match(REDISENO, /<select[^>]*value=\{selProcedureId\}/, "hay un <select> atado a selProcedureId");
  assert.match(REDISENO, /onChange=\{\(e\)\s*=>\s*setSelProcedureId\(e\.target\.value\)\}/, "el <select> escribe con setSelProcedureId");
  assert.match(REDISENO, /procedureOpts\.map/, "el <select> pinta procedureOpts");
});

test("abrir Registrar sesión en el rediseño carga los procedimientos del catálogo", () => {
  // No basta con declarar loadProcedureOpts: alguien tiene que llamarlo al
  // abrir el formulario, igual que la vista vieja (línea 654 de
  // treatments-client.tsx).
  assert.match(
    REDISENO,
    /setAddingSession\(selected\.id\);\s*loadProcedureOpts\(\);/,
    "el botón «Registrar sesión completada» dispara loadProcedureOpts",
  );
});

test("cancelar Registrar sesión limpia también el procedimiento elegido", () => {
  assert.match(
    REDISENO,
    /setAddingSession\(null\);\s*setSessionNote\(""\);\s*setSelInv\(\[\]\);\s*setSelProcedureId\(""\);/,
    "Cancelar limpia selProcedureId, si no queda pegado para la próxima sesión",
  );
});

test("treatments-client.tsx pasa procedureOpts/selProcedureId/loadProcedureOpts al rediseño", () => {
  const vm = /vm=\{\{([\s\S]*?)\}\}/.exec(CLIENTE)?.[1] ?? "";
  for (const campo of ["procedureOpts", "selProcedureId", "setSelProcedureId", "loadProcedureOpts"]) {
    assert.match(vm, new RegExp(`\\b${campo}\\b`), `vm del rediseño no lleva ${campo}`);
  }
});

test("addSession (compartido por las dos vistas) sigue mandando procedureId al PATCH", () => {
  assert.match(CLIENTE, /procedureId:\s*selProcedureId\s*\|\|\s*undefined/, "el PATCH manda procedureId");
});

test("las claves nuevas del selector existen en es.json y en.json", () => {
  for (const idioma of ["es", "en"]) {
    const dict = JSON.parse(leer(`i18n/dictionaries/${idioma}.json`)) as any;
    assert.ok(dict.pages?.treatments?.procedureOptionalLabel, `falta pages.treatments.procedureOptionalLabel en ${idioma}.json`);
    assert.ok(dict.pages?.treatments?.procedureNoneOption, `falta pages.treatments.procedureNoneOption en ${idioma}.json`);
  }
});
