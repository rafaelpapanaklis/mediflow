// «Componer» de la Bandeja a 1280/1366 px (ws1-t2, decisión 10 de Rafael, 2-oct-2026).
//
// El fallo: con el menú lateral del panel abierto, el contenido de /dashboard/inbox
// mide ~1014 px a viewport 1280 y ~1100 a 1366. Ahí la columna de Carpetas pasa a
// ser un cajón (data-narrow) que, cerrado, solo se DESPLAZABA a la izquierda: quedaba
// debajo del menú lateral (su sombra asomaba) y «Componer» —que solo vivía en ese
// cajón— estaba a la vista de nadie y no se podía pulsar (Playwright: «aside …
// intercepts pointer events»).
//
// Lo que fija:
//   1) el cajón cerrado es invisible (visibility:hidden), no solo desplazado, y
//      visible al abrirse — en tablet/móvil y en panel estrecho;
//   2) hay un «Componer» en el encabezado de la lista, oculto por defecto, visible
//      exactamente cuando la columna de Carpetas es un cajón y oculto en móvil
//      (donde ya está el FAB);
//   3) ese botón existe en el cliente, con el mismo permiso y la misma acción.
//
// Es de texto (Node no mide CSS): ver también las capturas de la tarea.
// Correr: npm run test:inbox-componer

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INBOX = join(__dirname, "..", "..", "..", "app", "dashboard", "inbox");
const css = readFileSync(join(INBOX, "inbox.module.css"), "utf8");
const cliente = readFileSync(join(INBOX, "inbox-client.tsx"), "utf8");

/** Cuerpo de un bloque `<cabecera> { … }` con llaves balanceadas. */
function bloque(texto: string, cabecera: string): string {
  const i = texto.indexOf(cabecera);
  assert.ok(i >= 0, `no existe «${cabecera}»`);
  const ini = texto.indexOf("{", i);
  let prof = 0;
  for (let k = ini; k < texto.length; k++) {
    if (texto[k] === "{") prof++;
    else if (texto[k] === "}" && --prof === 0) return texto.slice(ini + 1, k);
  }
  throw new Error(`«${cabecera}» sin cerrar`);
}

/** Cuerpo de la regla cuyo selector es exactamente `selector` dentro de `texto`. */
function regla(texto: string, selector: string): string {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = re.exec(texto);
  assert.ok(m, `no existe la regla «${selector}»`);
  return m[2];
}

const tablet = bloque(css, "@media (max-width: 1199px)");
const estrecho = bloque(css, "@media (min-width: 1200px)");
const movil = bloque(css, "@media (max-width: 767px)");

describe("el cajón de Carpetas cerrado no se queda debajo del menú lateral", () => {
  it("tablet/móvil: cerrado = visibility hidden; abierto = visible, sin retraso", () => {
    assert.match(regla(tablet, ".sidebar"), /visibility:\s*hidden/);
    assert.match(
      regla(tablet, '.page[data-mobile-sidebar-open="true"] .sidebar'),
      /visibility:\s*visible[^}]*transition-delay:\s*0s|transition-delay:\s*0s[^}]*visibility:\s*visible/,
    );
  });

  it("panel estrecho: cerrado = visibility hidden; abierto = visible, sin retraso", () => {
    assert.match(regla(estrecho, '.page[data-narrow="true"] .sidebar'), /visibility:\s*hidden/);
    assert.match(
      regla(estrecho, '.page[data-narrow="true"][data-mobile-sidebar-open="true"] .sidebar'),
      /visibility:\s*visible[^}]*transition-delay:\s*0s|transition-delay:\s*0s[^}]*visibility:\s*visible/,
    );
  });

  it("la visibilidad espera lo que dura el deslizamiento (no corta la animación de cierre)", () => {
    for (const r of [regla(tablet, ".sidebar"), regla(estrecho, '.page[data-narrow="true"] .sidebar')]) {
      assert.match(r, /visibility 0s linear var\(--dur-2\)/);
    }
  });
});

describe("«Componer» del encabezado de la lista", () => {
  it("por defecto no se pinta (en escritorio ancho el de la columna izquierda ya está a la vista)", () => {
    assert.match(regla(css, ".composeHeaderBtn"), /display:\s*none/);
  });

  it("se pinta cuando la columna de Carpetas es un cajón: tablet y panel estrecho", () => {
    assert.match(regla(tablet, ".composeHeaderBtn"), /display:\s*grid/);
    assert.match(regla(estrecho, '.page[data-narrow="true"] .composeHeaderBtn'), /display:\s*grid/);
  });

  it("en móvil se oculta de nuevo, también con el panel marcado estrecho (ya está el FAB)", () => {
    const r = regla(movil, `.composeHeaderBtn,\n  .page[data-narrow="true"] .composeHeaderBtn`);
    assert.match(r, /display:\s*none/);
  });

  it("el cliente lo monta con el mismo permiso y la misma acción que el del cajón", () => {
    const i = cliente.indexOf("styles.composeHeaderBtn");
    assert.ok(i > 0, "el cliente no monta .composeHeaderBtn");
    const antes = cliente.slice(Math.max(0, i - 200), i);
    const despues = cliente.slice(i, i + 400);
    assert.match(antes, /canSend\s*&&/, "tiene que ir detrás de canSend (sin inbox.send no se ofrece iniciar)");
    assert.match(despues, /onClick=\{openCompose\}/);
    assert.match(despues, /aria-label=\{t\("inbox\.client\.compose"\)\}/);
    // El del cajón sigue ahí: en escritorio ancho es el único.
    assert.match(cliente, /className=\{styles\.composeBtn\} onClick=\{openCompose\}/);
  });
});
