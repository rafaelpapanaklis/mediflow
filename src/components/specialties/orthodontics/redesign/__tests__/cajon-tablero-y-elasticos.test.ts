/**
 * ws1-t10 — dos detalles del manual en panel.108:
 *  1. «Registrar control» desde el Tablero: la barra de pestañas se dibujaba ENCIMA del cajón.
 *  2. La fila de elásticos «Clase II · Del control anterior» se salía por la derecha del cajón.
 *
 *   npm run test:orto-cajon-tablero
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("la causa: la fila del Tablero crea su propia capa (z-index 1) y la barra de pestañas está en 4", () => {
  const css = leer("src/components/specialties/orthodontics/modulo/modulo.module.css");
  assert.match(css, /\.filaDerecha \{[^}]*position: relative;[^}]*z-index: 1;/, "si esto cambia, revisa que el portal siga haciendo falta");
  assert.match(css, /\.submenuPegajoso \{[^}]*z-index: 4;/);
  const cajon = leer("src/components/specialties/orthodontics/redesign/orto.module.css");
  assert.match(cajon, /\.cajon \{[^}]*position: fixed;[^}]*z-index: 61;/);
});

test("«Registrar control» monta el cajón en un portal a <body>, con los tokens y alias que trae la ficha", () => {
  const b = sinComentarios(leer("src/components/specialties/orthodontics/agenda/BotonHojaControl.tsx"));
  assert.match(b, /import \{ createPortal \} from "react-dom";/);
  assert.match(b, /createPortal\(\s*<div className=\{`\$\{CLASES_REDISENO\} \$\{orto\.raiz\} \$\{modulo\.portal\}`\}>\s*<DrawerTreatmentCard/);
  assert.match(b, /document\.body/);
  // Sin `document` (render de servidor) no se monta; el cajón solo abre tras un clic, ya en el navegador.
  assert.match(b, /typeof document !== "undefined"/);
  // El cajón ya no cuelga del botón dentro de la fila.
  assert.equal((b.match(/<DrawerTreatmentCard/g) ?? []).length, 1);
});

test("la fila de elásticos salta de línea y el campo puede encogerse: no se sale del cajón", () => {
  const d = sinComentarios(leer("src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"));
  const bloque = d.slice(d.indexOf("function ElasticsBlock"), d.indexOf("function IprBlock"));
  const filas = bloque.match(/className=\{`\$\{orto\.caja\} flex[^`]*`\}/g) ?? [];
  assert.equal(filas.length, 2, "la fila editable y la de solo lectura");
  for (const f of filas) assert.match(f, /flex-wrap/, f);
  assert.match(bloque, /\$\{orto\.entrada\} min-w-\[120px\] flex-1 basis-\[120px\]/);
  assert.match(bloque, /\$\{orto\.entrada\} w-\[140px\] min-w-0 max-w-full shrink-0/);
  assert.match(bloque, /\[overflow-wrap:anywhere\]/, "el texto largo de un elástico ya firmado tampoco empuja");
});
