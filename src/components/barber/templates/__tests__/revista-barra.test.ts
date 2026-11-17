/* ═══════════════════════════════════════════════════════════════════════
   REVISTA EN TELÉFONO: LA BARRA DE ABAJO NO CORTA SUS PALABRAS POR EN MEDIO.

     npx tsx --test "src/components/barber/templates/__tests__/revista-barra.test.ts"

   QA de cierre B (16-nov): a 320 px con los textos de fábrica, y a 390 px en
   cuanto la barbería alargaba su botón de reservar, «Servicios» salía como
   «ervicio»: cada liga era una caja flex de ancho fijo con el texto centrado,
   y en una caja flex los puntos suspensivos no se pintan. Esta prueba es
   ESTÁTICA (el corte se midió en Chromium a 320, 360 y 390 px sobre la página
   real): fija las piezas del arreglo para que nadie las quite.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(__dirname, "..", "skins.css"), "utf8");

/** El bloque de una regla `selector { … }` (la primera que aparece). */
function regla(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `no encontré la regla ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}

test("las ligas de la barra van en bloque: los puntos suspensivos sí se pintan", () => {
  const liga = regla(".dcbw-rv-abajo > a:not(.dcbw-btn)");
  assert.match(liga, /display:\s*block/);
  assert.doesNotMatch(liga, /display:\s*flex/, "en una caja flex el texto se corta por los dos lados y sin «…»");
  assert.match(liga, /text-overflow:\s*ellipsis/);
  assert.match(liga, /overflow:\s*hidden/);
  assert.match(liga, /white-space:\s*nowrap/);
  assert.match(liga, /min-width:\s*0/);
});

test("cada liga mide lo que su palabra, no un tercio fijo", () => {
  const liga = regla(".dcbw-rv-abajo > a:not(.dcbw-btn)");
  assert.match(liga, /flex:\s*1 1 auto/);
  assert.doesNotMatch(liga, /flex:\s*1 1 0/, "con base 0 «Servicios» y «Visita» reciben el mismo ancho y la larga se corta");
});

test("el botón cede antes que las ligas, con «…», y nunca desaparece", () => {
  const boton = regla(".dcbw-revista .dcbw-rv-abajo-btn");
  const encoge = Number(/flex:\s*0 (\d+) auto/.exec(boton)?.[1] ?? 0);
  assert.ok(encoge > 1, "el botón tiene que encoger más que las ligas (flex-shrink > 1)");
  assert.match(boton, /text-overflow:\s*ellipsis/);
  assert.match(boton, /display:\s*block/);
  const minimo = Number(/min-width:\s*(\d+)px/.exec(boton)?.[1] ?? 0);
  assert.ok(minimo >= 100, "con ligas muy largas el botón de reservar no puede quedarse sin sitio");
  const maximo = Number(/max-width:\s*(\d+)%/.exec(boton)?.[1] ?? 100);
  assert.ok(maximo <= 60, "un botón larguísimo no se come la barra");
});

test("en los teléfonos más angostos la letra baja un punto", () => {
  const i = css.indexOf("@container dcbw (max-width: 350px)");
  assert.ok(i >= 0, "falta el corte de 350 px");
  const bloque = css.slice(i, i + 400);
  assert.match(bloque, /\.dcbw-rv-abajo > a:not\(\.dcbw-btn\)\s*\{\s*font-size:\s*14px/);
  assert.match(bloque, /\.dcbw-revista \.dcbw-rv-abajo-btn\s*\{[^}]*padding:\s*0 14px/);
});
