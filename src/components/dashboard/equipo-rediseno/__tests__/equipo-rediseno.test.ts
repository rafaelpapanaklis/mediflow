/**
 * CANDADOS DEL REDISEÑO DE EQUIPO (ws1-t8).
 *
 * Run: npx tsx --test src/components/dashboard/equipo-rediseno/__tests__/equipo-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/
 * hoy-rediseno.test.ts`: lo que se vigila es CABLEADO (que la pantalla no
 * invente tokens ni copie a mano el violeta del menú), y eso se ve en el
 * archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "equipo-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("rediseno.module.css no declara ninguna variable CSS propia", () => {
  const css = archivosNuevos.find((a) => a.nombre === "rediseno.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/equipo-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
});

// ═══════════════════════════════════════════════════════════════════════════
// Ni un hex copiado a mano: el violeta del menú se lee, no se escribe
// ═══════════════════════════════════════════════════════════════════════════
test("la carpeta del rediseño no escribe ningún color en hex", () => {
  for (const a of archivosNuevos) {
    const sueltos = a.texto.split("\n").filter((l) => /#[0-9a-f]{3,8}\b/i.test(l) && !/var\(--/.test(l));
    assert.deepEqual(sueltos, [], `${a.nombre} escribe un color a mano:\n${sueltos.join("\n")}`);
  }
});
