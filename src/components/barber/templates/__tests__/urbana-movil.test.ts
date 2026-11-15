/* ═══════════════════════════════════════════════════════════════════════
   URBANA EN CELULAR: SIN DESBORDE Y EL NOMBRE LARGO SIN RECORTAR.

     npx tsx --test "src/components/barber/templates/__tests__/urbana-movil.test.ts"

   Auditoría del 14-nov (M3): a 390 px la portada de Urbana medía 448 px y un
   nombre largo salía recortado. La causa era la columna única de la rejilla
   de la portada (mide lo que mida su palabra más larga) y el titular de
   tamaño fijo. Esta prueba es ESTÁTICA (el desborde se midió en Chromium a
   390 y a 320 px): fija las tres piezas del arreglo para que nadie las quite.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const CARPETA = path.resolve(__dirname, "..");
const css = readFileSync(path.join(CARPETA, "skins.css"), "utf8");
const tsx = readFileSync(path.join(CARPETA, "t-urbana.tsx"), "utf8");

/** El bloque de una regla `selector { … }` (la primera que aparece). */
function regla(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `no encontré la regla ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}

test("la rejilla de la portada no crece con su palabra más larga", () => {
  assert.match(regla(".dcbw-ur-hero-in"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(regla(".dcbw-ur-hero-txt"), /min-width:\s*0/);
});

test("el titular se achica según la palabra más larga y parte lo que no quepa", () => {
  const h1 = regla(".dcbw-urbana .dcbw-h1");
  assert.match(h1, /--ur-palabra/);
  assert.match(h1, /overflow-wrap:\s*anywhere/);
  assert.match(h1, /max\(22px/, "tiene que haber un piso de tamaño");
});

test("la plantilla le pasa al titular la palabra más larga del nombre", () => {
  assert.match(tsx, /--ur-palabra/);
  assert.match(tsx, /function palabraMasLarga/);
});
