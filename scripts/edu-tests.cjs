#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
 * CORREDOR DE PRUEBAS DEL VERTICAL INSTITUCIONAL — la gate que faltaba.
 *
 * Uso:
 *   npm run test:edu          (= node scripts/edu-tests.cjs)
 *
 * Cierra el hallazgo P3-15 de docs/audits/EDU_AUDIT.md: los archivos de
 * prueba del vertical existían y pasaban, pero ningún script los corría, así
 * que solo se ejecutaban cuando alguien se acordaba a mano.
 *
 * ── Por qué un runner y no un glob ────────────────────────────────────
 * La versión de tres palabras de esto sería:
 *
 *     "test:edu": "tsx --test \"src/lib/edu/__tests__/*.test.ts\""
 *
 * y está MAL, por dos agujeros que se comprobaron en node v24.13.1 y que
 * tienen la misma forma: la gate sale VERDE sin haber corrido nada.
 *
 *   1. Un glob que no encuentra nada NO es un error para `node --test`:
 *      imprime "tests 0 / fail 0" y sale con código 0. El día que alguien
 *      mueva o renombre la carpeta, la gate deja de probar el vertical y
 *      nadie se entera, porque sigue en verde.
 *   2. `--test` interpreta los CORCHETES de la ruta como patrón. Un archivo
 *      bajo `src/app/instituto/(panel)/[id]/` se salta EN SILENCIO, otra vez
 *      con exit 0. Es la misma trampa que ya documentan los scripts
 *      `test:landing` y `test:campo-edicion` para `src/app/[slug]/`.
 *
 * Este archivo tapa los dos: DESCUBRE los archivos leyendo el disco (no una
 * lista a mano, que se pudre en la primera ola nueva), FALLA si el
 * descubrimiento da cero, y los corchetes los corre sin `--test` —el mismo
 * rodeo que usa `test:landing`— en vez de tragárselos.
 *
 * Exit 0 → todas las pruebas del vertical pasaron.
 * Exit 1 → alguna falló, o no se descubrió ni un archivo, o falta tsx.
 *
 * Sin dependencias externas: fs + path + child_process.
 * ═══════════════════════════════════════════════════════════════════════ */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");

// ── 1. Dónde buscar ────────────────────────────────────────────────────
// Las MISMAS raíces que scripts/edu-guard.cjs llama "propias del vertical".
// Se barren enteras y en profundidad a propósito: hoy las 28 pruebas viven
// todas en src/lib/edu/__tests__/, pero una ola futura que ponga la suya al
// lado de su componente queda cubierta sin tocar este archivo.
//
// ⚠️ Si una ola futura crea una raíz nueva del vertical, va AQUÍ y también
// en OWN_PREFIXES de scripts/edu-guard.cjs.
const ROOTS = [
  "src/lib/edu",
  "src/components/edu",
  "src/app/instituto",
  "src/app/api/instituto",
];

const IS_TEST = /\.test\.tsx?$/;

// Lo que `node --test` lee como patrón en vez de como nombre de archivo.
const GLOB_CHARS = /[[\]*?]/;

function walk(absDir, relDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    // Una raíz que no existe no tumba el runner: lo que decide es el total.
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const rel = relDir + "/" + entry.name;
    if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel, out);
    else if (IS_TEST.test(entry.name)) out.push(rel);
  }
  return out;
}

const files = [];
for (const root of ROOTS) walk(path.join(REPO, root), root, files);
files.sort();

// ── 2. Cero archivos es un FALLO, no un éxito ──────────────────────────
// Una gate que pasa porque no corrió nada es peor que no tener gate: da la
// señal verde de "el vertical está probado" cuando nadie lo probó.
if (files.length === 0) {
  console.error("");
  console.error("PRUEBAS DEL INSTITUTO: no se descubrió NI UN archivo de prueba.");
  console.error("Se buscó *.test.ts(x), en profundidad, bajo:");
  for (const root of ROOTS) console.error("  · " + root + "/");
  console.error("");
  console.error("Esto es un fallo a propósito. O se movieron las pruebas —y hay");
  console.error("que actualizar ROOTS en scripts/edu-tests.cjs— o se borraron.");
  process.exit(1);
}

const plain = files.filter((p) => !GLOB_CHARS.test(p));
const bracketed = files.filter((p) => GLOB_CHARS.test(p));

console.log("════════════════════════════════════════════════════════");
console.log("PRUEBAS DEL VERTICAL INSTITUCIONAL — archivos descubiertos: " + files.length);
console.log("════════════════════════════════════════════════════════");
files.forEach((p, i) => console.log(String(i + 1).padStart(3, " ") + ". " + p));
if (bracketed.length > 0) {
  console.log("");
  console.log(
    bracketed.length +
      " con corchetes en la ruta: van sin --test, uno por uno (node los leería como patrón).",
  );
}
console.log("");

// ── 3. Lanzar tsx y propagar el exit code ──────────────────────────────
let tsxCli;
try {
  tsxCli = require.resolve("tsx/cli");
} catch {
  console.error("PRUEBAS DEL INSTITUTO: falta tsx. Corre `npm install` en este árbol.");
  process.exit(1);
}

function run(args, label) {
  const res = spawnSync(process.execPath, [tsxCli, ...args], {
    cwd: REPO,
    stdio: "inherit",
  });
  if (res.error) {
    console.error("PRUEBAS DEL INSTITUTO: no se pudo lanzar tsx (" + label + "): " + res.error.message);
    return 1;
  }
  // Una señal (p.ej. el proceso muerto por falta de memoria) deja status en
  // null: eso es un fallo, no un cero.
  if (res.status === null) {
    console.error("PRUEBAS DEL INSTITUTO: tsx terminó por señal " + res.signal + " (" + label + ")");
    return 1;
  }
  return res.status;
}

let failed = 0;

if (plain.length > 0) failed += run(["--test", ...plain], "lote principal") === 0 ? 0 : 1;
for (const file of bracketed) failed += run([file], file) === 0 ? 0 : 1;

console.log("");
if (failed > 0) {
  console.error("PRUEBAS DEL INSTITUTO: ROJO — falló " + failed + " de las tandas de arriba.");
  process.exit(1);
}
console.log(
  "PRUEBAS DEL INSTITUTO: VERDE — " + files.length + " archivos, todas las pruebas pasaron.",
);
process.exit(0);
