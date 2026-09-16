/**
 * CANDADOS DEL REDISEÑO DE REPORTES (ws1-t8).
 *
 * Run: npx tsx --test src/components/dashboard/reportes-rediseno/__tests__/reportes-rediseno.test.ts
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
const CARPETA = join(SRC, "components", "dashboard", "reportes-rediseno");
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
  const raiz = leer("components/dashboard/reportes-rediseno/raiz.tsx");
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

// ═══════════════════════════════════════════════════════════════════════════
// Las gráficas toman el acento del menú con el rediseño encendido
// ═══════════════════════════════════════════════════════════════════════════
test("reports-client.tsx pinta las gráficas con var(--m2-activo) bajo el rediseño", () => {
  const cliente = leer("app/dashboard/reports/reports-client.tsx");
  assert.match(cliente, /rediseno \? "var\(--m2-activo\)" : "var\(--brand\)"/, "el acento elige el token del menú");
  assert.match(cliente, /DS_COLORS_REDISENO = \["var\(--m2-activo\)"/, "la primera serie es el acento del menú");
  assert.ok(!/fill="var\(--brand\)"|stroke="var\(--brand\)"/.test(cliente), "ninguna gráfica lleva var(--brand) fijo");
});
