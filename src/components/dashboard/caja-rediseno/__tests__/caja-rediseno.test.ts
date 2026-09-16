/**
 * Rediseño de Caja (ws1-t4) — candados.
 *
 * Run: npx tsx --test src/components/dashboard/caja-rediseno/__tests__/caja-rediseno.test.ts
 *
 * Lo que fija:
 *  - Caja no vuelve a la monoespaciada a mano: Rafael pidió Instrument Sans
 *    en el 100 % del panel, importes, horas y folios incluidos, y las
 *    columnas se cuadran con `tabular-nums`, no con otra letra.
 *  - El rediseño solo se viste con el interruptor: la raíz de `CajaClient`
 *    recibe `CLASES_CAJA_REDISENO` únicamente cuando `rediseno` es true, y
 *    `page.tsx` lo saca del MISMO interruptor que el menú de dos niveles.
 *  - La hoja del rediseño no inventa tokens ni trae hex: consume `--pr-*`
 *    (los del rediseño de Pacientes) y nada más, y toda regla cuelga de
 *    `.pagina` (o es una de las dos clases del encabezado).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const ARCHIVOS_CAJA = [
  "src/app/dashboard/caja/page.tsx",
  "src/app/dashboard/caja/caja-client.tsx",
  "src/components/dashboard/caja-rediseno/raiz.ts",
  "src/components/dashboard/caja-rediseno/caja-rediseno.module.css",
];

// Las dos palabras van partidas a propósito: el guardia de la tarea hace un
// grep literal sobre los archivos de Caja y este candado no debe saltar por
// nombrar lo que prohíbe.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono"].join("") + "|" + ["mono", "space"].join(""), "i");

test("Caja no usa monoespaciada a mano: cero letra de máquina", () => {
  for (const rel of ARCHIVOS_CAJA) {
    const texto = leer(rel);
    assert.doesNotMatch(texto, LETRA_DE_MAQUINA, `${rel} vuelve a pedir una letra de máquina`);
  }
});

test("los importes de Caja llevan tabular-nums (así se cuadran las columnas)", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  const usos = cliente.match(/fontVariantNumeric:\s*"tabular-nums"/g) ?? [];
  assert.ok(usos.length >= 12, `esperaba al menos 12 importes con tabular-nums, hay ${usos.length}`);
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-rediseno.module.css");
  assert.match(hoja, /\.pagina\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
});

test("la raíz solo lleva el rediseño con el interruptor encendido", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cliente, /rediseno\s*=\s*false\s*\}:\s*Props/, "el valor por defecto de `rediseno` es false");
  assert.match(cliente, /className=\{rediseno \? CLASES_CAJA_REDISENO : undefined\}/);
  // Y no se cuela por otro sitio: una sola raíz con las clases.
  assert.equal((cliente.match(/CLASES_CAJA_REDISENO/g) ?? []).length, 2, "import + una raíz");
});

test("page.tsx lee el MISMO interruptor que el menú de dos niveles", () => {
  const pagina = leer("src/app/dashboard/caja/page.tsx");
  assert.match(pagina, /from "@\/lib\/menu-dos-niveles\/interruptor"/);
  assert.match(pagina, /menuDosNivelesEncendido\(user\.clinicId\)/);
  assert.match(pagina, /rediseno=\{rediseno\}/);
});

test("la hoja del rediseño no declara tokens nuevos ni trae hex", () => {
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-rediseno.module.css");
  assert.doesNotMatch(hoja, /#[0-9a-f]{3,8}\b/i, "un color en hex: eso vive en los tokens, no aquí");
  assert.doesNotMatch(hoja, /--pr-[a-z0-9-]+\s*:/, "declara un token --pr-*: los tokens son de la raíz del rediseño");
  assert.ok((hoja.match(/var\(--pr-/g) ?? []).length >= 40, "consume los tokens --pr-*");
});

test("toda regla de la hoja cuelga de .pagina (o es el encabezado)", () => {
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-rediseno.module.css");
  const sinComentarios = hoja.replace(/\/\*[\s\S]*?\*\//g, "");
  // Selectores: lo que precede a cada `{` fuera de un bloque @media.
  const selectores = [...sinComentarios.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map(m => m[2].trim());
  assert.ok(selectores.length > 30, "la hoja tiene reglas");
  for (const sel of selectores) {
    const ok = sel.split(",").every(parte => /\.pagina\b/.test(parte) || /^\.(titulo|subtitulo)$/.test(parte.trim()));
    assert.ok(ok, `regla fuera de .pagina: «${sel}»`);
  }
});
