/**
 * Las dos tablas del panel a ancho de móvil: nada se sale de la caja.
 *
 * Run: npm run test:tablas-movil
 *
 * ── Qué se midió, y por qué esta prueba mira CSS ────────────────────────────
 * El desborde se comprobó con un navegador de verdad (Chromium headless sobre
 * una maqueta estática que carga `globals.css` + la hoja del módulo, a 320,
 * 390 y 1440 px, en claro y en oscuro). Esa medición no se puede repetir en
 * `node --test`: haría falta levantar la app, y la app pide credenciales.
 *
 * Así que esta prueba es el CANDADO de lo que se arregló: exige que las tres
 * declaraciones que quitaron el desborde sigan ahí. Si alguien las borra, el
 * recorte vuelve en silencio — que es exactamente como llegó.
 *
 * ── Lo que se midió, con números ────────────────────────────────────────────
 * Antes (390 px, `.tablaCaja` de 342 px de ancho):
 *   · /admin/clinics  → contenido de 412 px: 70 px recortados.
 *   · /admin/clientes → 394 px: 52 px recortados (vía `PlanStatusBadge`).
 * Y a 320 px, las dos por `.volumen`, que es `nowrap` y mide 202 px.
 * Después: 0 px en los dos sitios, a 320, 390 y 1440.
 *
 * ⚠️ `box-sizing: border-box` NO era la causa, aunque el reporte que abrió
 * esta tarea así lo decía. El preflight de Tailwind (`@tailwind base`) ya pone
 * `*,::before,::after{box-sizing:border-box}` en todo el documento, así que la
 * declaración de `clientes.module.css` es redundante y copiarla a `clinics`
 * no habría movido un píxel. Se comprobó midiendo con y sin el preflight.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ADMIN = join(__dirname, "..", "..");
const CLINICS  = readFileSync(join(ADMIN, "clinics", "clinics.module.css"), "utf8");
const CLIENTES = readFileSync(join(ADMIN, "clientes", "clientes.module.css"), "utf8");

/** El cuerpo de una regla, sin comentarios (que aquí citan las propiedades). */
function regla(css: string, selector: string): string {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const i = limpio.indexOf(selector + " {");
  assert.notEqual(i, -1, `no existe la regla ${selector}`);
  return limpio.slice(i, limpio.indexOf("}", i));
}

test("clinics: .pila puede encogerse dentro de su celda", () => {
  // La causa REAL del desborde: `.pila` es un ítem flex dentro de un `td` que
  // en móvil también es flex. Sin `min-width: 0` no baja de su max-content, y
  // la insignia más larga le fijaba el ancho a toda la columna.
  assert.match(regla(CLINICS, ".pila"), /min-width:\s*0/);
});

test("las dos hojas: .celda puede encogerse", () => {
  // `.celda` ya lo tenía en las dos. Se fija para que no se pierda.
  assert.match(regla(CLINICS, ".celda"), /min-width:\s*0/);
  assert.match(regla(CLIENTES, ".celda"), /min-width:\s*0/);
});

test("las dos hojas: una insignia larga se recorta DENTRO de la píldora", () => {
  // Con `max-width: 100%` a secas la píldora quedaba limitada y el texto se
  // salía igual; el recorte lo acababa haciendo `.tablaCaja`, a mitad de
  // pantalla. La etiqueta que lo destapa es la de `PlanStatusBadge`:
  // "Al corriente · renueva el 12 de octubre".
  for (const [nombre, css] of [["clinics", CLINICS], ["clientes", CLIENTES]] as const) {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const i = sinComentarios.indexOf(".badge-new)");
    assert.notEqual(i, -1, `${nombre}: no hay regla para .badge-new dentro de la celda`);
    const cuerpo = sinComentarios.slice(i, sinComentarios.indexOf("}", i));
    assert.match(cuerpo, /max-width:\s*100%/, nombre);
    assert.match(cuerpo, /overflow:\s*hidden/, `${nombre}: sin esto el texto se sale de la píldora`);
    assert.match(cuerpo, /text-overflow:\s*ellipsis/, nombre);
  }
});

test("las dos hojas: en móvil el resumen de volumen puede envolver", () => {
  // `.volumen` es `nowrap` en escritorio a propósito ("116 citas · 12 facturas
  // · 34 notas" en una línea). A 320 px mide 202 px y la columna de valor deja
  // ~147: se salía 55 px en clinics y 51 en clientes.
  for (const [nombre, css] of [["clinics", CLINICS], ["clientes", CLIENTES]] as const) {
    const movil = css.slice(css.lastIndexOf("@media"));
    assert.match(movil, /\.volumen\s*\{[^}]*white-space:\s*normal/, `${nombre}: .volumen no envuelve en móvil`);
  }
});

test("ningún color escrito a mano en lo que se tocó", () => {
  // Regla (d) de la casa aplicada al CSS: sólo tokens. Se mira lo NUEVO: si
  // alguna de las dos hojas gana un hex, que se sepa aquí.
  for (const [nombre, css] of [["clinics", CLINICS], ["clientes", CLIENTES]] as const) {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const hexes = sinComentarios.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(hexes, [], `${nombre} tiene colores a mano: ${hexes.join(", ")}`);
  }
});
