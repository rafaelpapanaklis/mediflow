/**
 * Los scripts de prueba de Sabina en package.json no se pisan.
 *
 *   npm run test:sabina-scripts
 *
 * Al juntar las tres ramas, `git merge` no dio conflicto y aun así se perdió
 * una suite: herramientas y pantalla registraron las dos `test:sabina-pantalla`,
 * en líneas distantes. JSON admite la clave repetida y npm se queda con la
 * ÚLTIMA, así que las pruebas de la pantalla dejaron de correr sin avisar.
 * `JSON.parse` no lo ve —ya se comió la primera—: hay que leer el texto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const texto = readFileSync(join(process.cwd(), "package.json"), "utf8");

test("ninguna clave test:sabina* aparece dos veces", () => {
  const claves = Array.from(texto.matchAll(/^\s*"(test:sabina[^"]*)"\s*:/gm), (m) => m[1]);
  const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
  assert.deepEqual(repetidas, []);
});

test("cada archivo de prueba de Sabina tiene un script que lo corre", () => {
  const scripts: Record<string, string> = JSON.parse(texto).scripts;
  const lineas = Object.values(scripts).join("\n");
  for (const archivo of [
    "src/components/sabina/__tests__/sabina-core.test.ts",
    "src/lib/sabina/engine-core.test.ts",
    "src/lib/sabina/engine.test.ts",
    "src/lib/sabina/tools/__tests__/numeros-vs-pantalla.test.ts",
    "src/lib/sabina/__tests__/punta-a-punta.test.ts",
    "src/lib/sabina/__tests__/historial.test.ts",
    "src/lib/sabina/__tests__/scripts-sabina.test.ts",
    "src/lib/sabina/__tests__/cobro-por-modelo.test.ts",
  ]) {
    assert.ok(lineas.includes(archivo), `${archivo} no lo corre ningún script`);
  }
});
