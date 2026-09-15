/**
 * La burbuja de Sabina PINTA las listas como listas.
 *
 * Run: npm run test:sabina-pantalla
 *
 * `sabina-core.test.ts` prueba que el texto se parte bien en bloques; esto prueba
 * el último paso, el HTML que ve el doctor, con el componente de verdad
 * (`SabinaMessageContent`) y React de verdad. Nació del 14-sep-2026: una lista de
 * deudores llegó como una tira separada por comas.
 *
 * El CSS module se sustituye por un objeto que devuelve el nombre de cada clase
 * («rows», «row»…): en Node pelado `require` no sabe leer CSS, y así la prueba
 * puede preguntar por la clase que decide cómo se ve cada bloque.
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const cargarOriginal = M._load;
const clases: Record<string | symbol, unknown> = new Proxy(
  {},
  { get: (_t, k) => (k === "__esModule" ? false : k === "default" ? clases : typeof k === "string" ? k : undefined) },
);
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".module.css")) return clases;
  return cargarOriginal.call(this, request, parent, isMain);
};

// Con `require` y no con `import`: el sustituto del CSS tiene que estar puesto ANTES de cargar el componente.
const { SabinaMessageContent } = require("../message-content") as typeof import("../message-content");

function pintar(texto: string): string {
  return renderToStaticMarkup(<SabinaMessageContent content={texto} />);
}

/** Cuántas veces aparece `aguja` en `pajar`. */
function veces(pajar: string, aguja: string): number {
  return pajar.split(aguja).length - 1;
}

test("la respuesta de deudores, tal como la trae el resumen, se pinta como lista con la cantidad en su columna", () => {
  const html = pintar(
    "4 pacientes con saldo por $12,277, de los que $3,000 ya están vencidos. De mayor a menor:\n" +
      "- Paula Restringida — $7,777\n- Beto Munoz — $3,000 (2 facturas)\n- Dora Sanchez — $1,000\n- Carla Gomez — $500",
  );
  assert.equal(veces(html, '<ul class="rows '), 1, html);
  assert.equal(veces(html, '<li class="row">'), 4, html);
  assert.match(html, /<span class="rowLabel">Paula Restringida<\/span><span class="rowAmount">\$7,777<\/span>/);
  assert.match(html, /Beto Munoz<span class="rowDetail"> \(2 facturas\)<\/span><\/span><span class="rowAmount">\$3,000<\/span>/);
  // La cabecera sigue siendo un párrafo, antes de la lista.
  assert.ok(html.indexOf("<p ") < html.indexOf("<ul "), html);
});

test("una lista numerada sale como <ol>, con su número", () => {
  const html = pintar("1. Paula Restringida — $7,777\n2. Beto Munoz — $3,000");
  assert.equal(veces(html, "<ol "), 1, html);
  assert.match(html, /<span class="rowIndex">1\.<\/span>Paula Restringida/);
  const sinMontos = pintar("1. Llama a Paula\n2. Llama a Beto");
  assert.match(sinMontos, /<ol class="bullets "><li>Llama a Paula<\/li><li>Llama a Beto<\/li><\/ol>/);
});

test("una lista sin cantidades es una lista de viñetas normal", () => {
  const html = pintar("- 07:30–08:15 Ana Perez — Urgencia (Hugo Salas, confirmada)\n- 10:00–10:30 Beto Munoz — Limpieza dental (Hugo Salas, completada)");
  assert.equal(veces(html, '<ul class="bullets '), 1, html);
  assert.equal(veces(html, "<li>"), 2, html);
});

test("la tira separada por comas NO se convierte en lista (la pantalla no inventa), y la frase corta tampoco", () => {
  const tira = pintar("Te deben Paula Restringida $7,777, Beto Munoz $3,000, Dora Sanchez $1,000 y Carla Gomez $500.");
  assert.equal(veces(tira, "<li"), 0, tira);
  const corta = pintar("Hoy tienes 4 citas.");
  assert.equal(corta, '<div class="content"><p class="paragraph ">Hoy tienes 4 citas.</p></div>');
});

test("una tabla se pinta como tabla, con la etiqueta de su columna en cada celda para el teléfono", () => {
  const html = pintar("| Paciente | Saldo |\n|---|---|\n| Paula | $7,777 |\n| Beto | $3,000 |");
  assert.equal(veces(html, "<table"), 1, html);
  assert.match(html, /<td data-label="Saldo" class="num"><span>\$7,777<\/span><\/td>/);
  assert.doesNotMatch(html, /\|/);
});
