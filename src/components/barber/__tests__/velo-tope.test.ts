// EL VELO DE LAS VENTANAS A TODA LA PANTALLA — «se ve rara la pantalla y el
// blur» (Rafael, 16-nov, Clientes → «Estrellas y bonos» en monitor ancho).
//
// El tope de 1320 px de barber-theme.css (`#main-content > *`) alcanzaba al
// velo de las ventanas que se montan como hijas directas de #main-content, y
// un `position: fixed; inset: 0` con max-width se encoge a una franja de
// 1320 centrada. La regla deja fuera todo hijo que contenga directamente un
// [aria-modal="true"]; estas pruebas fijan eso y que cada copia de ventana
// siga teniendo la forma «velo > [aria-modal="true"]».
// Estáticas (no hay DOM en Node); la medición con navegador está en
// ~/capturas/ws6-t2-velo/barrido.mjs.
//
//   npx tsx --test src/components/barber/__tests__/velo-tope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(rel, "utf8");
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("el tope de 1320 px no alcanza a los velos de las ventanas", () => {
  const css = sinComentarios(leer("src/app/barber/barber-theme.css"));
  const reglas = [...css.matchAll(/([^{}]+)\{([^{}]*max-width:\s*1320px[^{}]*)\}/g)];
  assert.ok(reglas.length > 0, "no encontré la regla del tope de 1320 px");
  for (const [, selector] of reglas) {
    if (!selector.includes("#main-content")) continue;
    assert.match(
      selector,
      /:not\(:has\(>\s*\[aria-modal="true"\]\)\)/,
      `la regla «${selector.trim()}» le pondría tope al velo de una ventana`,
    );
  }
});

// Cada copia de ventana de barber: el panel con aria-modal es hijo DIRECTO
// del velo, que es lo que el :has(> …) de la regla reconoce.
const VENTANAS: Array<[string, RegExp]> = [
  ["src/components/barber/clients/ui.tsx", /className=\{s\.overlay\}[\s\S]{0,200}?<div[\s\S]{0,200}?aria-modal="true"/],
  ["src/components/barber/cash/modal.tsx", /className="modal-overlay"[\s\S]{0,200}?<div[\s\S]{0,200}?aria-modal="true"/],
  ["src/components/barber/team/admin-ui.tsx", /className=\{s\.modalRoot\}[\s\S]{0,200}?<div[\s\S]{0,200}?aria-modal="true"/],
  ["src/components/barber/memberships/ui.tsx", /className="bmem-overlay"[\s\S]{0,300}?<div[\s\S]{0,200}?aria-modal="true"/],
  ["src/components/barber/billing/modal.tsx", /className="dcbb-modal-backdrop"[\s\S]{0,200}?<div[\s\S]{0,200}?aria-modal="true"/],
  ["src/components/barber/agenda/agenda-ui.tsx", /className=\{css\.backdrop\}[\s\S]{0,400}?<div[\s\S]{0,200}?aria-modal="true"/],
  ["src/components/barber/agenda/appointment-detail.tsx", /className=\{css\.velo\}[\s\S]{0,400}?<div[\s\S]{0,300}?aria-modal="true"/],
];

for (const [archivo, forma] of VENTANAS) {
  test(`${archivo}: velo > [aria-modal="true"]`, () => {
    assert.match(leer(archivo), forma);
  });
}
