/**
 * Rediseño de Finanzas — candados.
 *
 * Run: npx tsx --test src/components/dashboard/finanzas-rediseno/__tests__/finanzas-rediseno.test.ts
 * (no hay script `test:finanzas-rediseno` en package.json: ese archivo queda
 * fuera del alcance de la tarea que creó este rediseño).
 *
 * Lo que fija:
 *  - Las marcas del eje de dinero son números redondos que cubren el máximo
 *    de la serie sin pasarse de un paso, y su etiqueta nombra EXACTAMENTE ese
 *    valor («$2.5k» es 2,500; nunca «$1k» para 1,499).
 *  - El rediseño no mete letra de máquina: ni `font-mono`, ni `monospace`, ni
 *    `ui-monospace` en ninguno de sus archivos. Rafael pidió Instrument Sans
 *    en el 100 % del panel, cantidades incluidas.
 *  - La gráfica no lleva ningún color escrito a mano: los colores de serie,
 *    ejes y rejilla salen de los tokens del menú (`--m2-*`) leídos en JS.
 *  - El camino viejo sigue siendo el viejo: `finanzas-client.tsx` no importa
 *    nada del rediseño, así que con el interruptor apagado no puede cambiar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { etiquetaDinero, marcasEje } from "../escala";

const CARPETA = join(process.cwd(), "src/components/dashboard/finanzas-rediseno");
const PAGINA = join(process.cwd(), "src/app/dashboard/finanzas");

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : archivosDe(ruta);
    return /\.(tsx?|css)$/.test(nombre) ? [ruta] : [];
  });
}

test("marcasEje: números redondos que cubren el máximo sin pasarse de un paso", () => {
  assert.deepEqual(marcasEje(0), [0]);
  assert.deepEqual(marcasEje(-5), [0]);
  assert.deepEqual(marcasEje(NaN), [0]);
  assert.deepEqual(marcasEje(8_500), [0, 2_500, 5_000, 7_500, 10_000]);
  assert.deepEqual(marcasEje(1_499), [0, 500, 1_000, 1_500]);
  assert.deepEqual(marcasEje(120), [0, 50, 100, 150]);
  assert.deepEqual(marcasEje(1_000_000), [0, 250_000, 500_000, 750_000, 1_000_000]);
  for (const max of [1, 7, 33, 999, 12_345, 250_000, 3_333_333]) {
    const marcas = marcasEje(max);
    assert.equal(marcas[0], 0);
    assert.ok(marcas[marcas.length - 1] >= max, `la última marca cubre ${max}`);
    const paso = marcas[1] - marcas[0];
    assert.ok(marcas[marcas.length - 1] - max < paso, `no se pasa de un paso para ${max}`);
    for (let i = 1; i < marcas.length; i++) {
      assert.equal(Number((marcas[i] - marcas[i - 1]).toPrecision(12)), paso, "pasos iguales");
    }
  }
});

test("etiquetaDinero: la etiqueta nombra exactamente el valor de la marca", () => {
  assert.equal(etiquetaDinero(0), "$0");
  assert.equal(etiquetaDinero(750), "$750");
  assert.equal(etiquetaDinero(2_500), "$2.5k");
  assert.equal(etiquetaDinero(12_500), "$12.5k");
  assert.equal(etiquetaDinero(1_250), "$1.25k");
  assert.equal(etiquetaDinero(1_000_000), "$1M");
  assert.equal(etiquetaDinero(1_250_000), "$1.25M");
  // Un valor que no cabe corto sin mentir se escribe entero.
  assert.equal(etiquetaDinero(1_499), "$1,499");
  assert.equal(etiquetaDinero(-2_500), "−$2.5k");
});

test("cero letra de máquina en el rediseño", () => {
  for (const ruta of [...archivosDe(CARPETA), join(PAGINA, "page.tsx")]) {
    const texto = readFileSync(ruta, "utf8");
    assert.doesNotMatch(texto, /font-mono|ui-monospace|\bmonospace\b/, ruta);
  }
});

test("la gráfica no lleva colores escritos a mano", () => {
  const grafica = readFileSync(join(CARPETA, "grafica.tsx"), "utf8");
  assert.doesNotMatch(grafica, /#[0-9a-fA-F]{3,8}\b/, "hex a mano en grafica.tsx");
  assert.match(grafica, /--m2-activo/, "lee el violeta del menú");
  assert.match(grafica, /getComputedStyle/, "lee los tokens en JS");
});

test("el camino viejo no depende del rediseño", () => {
  const viejo = readFileSync(join(PAGINA, "finanzas-client.tsx"), "utf8");
  assert.doesNotMatch(viejo, /finanzas-rediseno/);
  assert.doesNotMatch(viejo, /menu-dos-niveles/);
});

test("las mejoras no añaden ni una petición: siguen siendo /api/finanzas y /api/gastos", () => {
  const pantalla = readFileSync(join(CARPETA, "finanzas-rediseno.tsx"), "utf8");
  assert.doesNotMatch(pantalla, /\bfetch\(/, "la pantalla no pide datos: eso es de usar-finanzas.ts");
  const datos = readFileSync(join(CARPETA, "usar-finanzas.ts"), "utf8");
  const rutas = Array.from(datos.matchAll(/fetch\(\s*[`"']([^?`"'$]+)/g), (m) => m[1]).sort();
  assert.deepEqual(rutas, ["/api/finanzas", "/api/gastos", "/api/gastos", "/api/gastos"]);
});

test("cada indicador dice de dónde sale su cifra, y ninguna etiqueta se corta con puntos suspensivos", () => {
  const pantalla = readFileSync(join(CARPETA, "finanzas-rediseno.tsx"), "utf8");
  const indicadores = pantalla.match(/<Kpi\b[\s\S]*?\/>/g) ?? [];
  assert.equal(indicadores.length, 6, "siguen siendo los seis indicadores de siempre");
  for (const kpi of indicadores) assert.match(kpi, /\bpista=/, kpi.slice(0, 60));
  const css = readFileSync(join(CARPETA, "finanzas.module.css"), "utf8");
  const etiqueta = css.match(/\.kpiEtiqueta \{[^}]*\}/)?.[0] ?? "";
  assert.ok(etiqueta, "existe .kpiEtiqueta");
  assert.doesNotMatch(etiqueta, /text-overflow:\s*ellipsis/);
});

test("«Por doctor» avisa de que es lo facturado, no lo cobrado", () => {
  const pantalla = readFileSync(join(CARPETA, "finanzas-rediseno.tsx"), "utf8");
  assert.match(pantalla, /Lo facturado en el periodo, no lo cobrado/);
  assert.doesNotMatch(pantalla, /Ingresos generados/);
});
