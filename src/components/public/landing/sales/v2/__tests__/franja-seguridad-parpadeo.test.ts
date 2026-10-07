/**
 * Parpadeo de la franja de seguridad en iPad (7-oct-2026, ws1-t10).
 *
 * Rafael vio en una tableta que el panel «Tus pacientes, protegidos» alternaba
 * entre su azul y el blanco de la página al hacer scroll. Estas pruebas fijan
 * las dos condiciones del arreglo leyendo el CSS y el motor tal cual están en
 * el repo (sin navegador):
 *
 *  1. Ningún `backdrop-filter` en la franja. Siete descripciones con desenfoque
 *     de fondo (ocultas casi siempre) dentro de un panel con `isolation` y
 *     `overflow: hidden` + radio obligan a WebKit a componer el panel entero
 *     como un grupo aparte, que se rehace cada vez que Safari cambia el alto
 *     del viewport al hacer scroll; en el hueco se ve blanco.
 *  2. El panel lleva un `background-color` sólido azul noche DESPUÉS del atajo
 *     `background` (que lo deja transparente): el fondo azul se pinta siempre,
 *     esté o no listo el canvas o cualquier capa compuesta.
 *
 * Fallan con el CSS anterior (tenía `backdrop-filter: blur(10px)` en
 * `.dcsg__desc` y ningún `background-color` en `.dcsg__panel`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const aqui = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(aqui, "..", "franja-seguridad.css"), "utf8");
const motor = readFileSync(join(aqui, "..", "globo-seguridad-motor.ts"), "utf8");

/** Cuerpo de la primera regla cuyo selector es exactamente `selector`. */
function regla(selector: string): string {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = sinComentarios.match(re);
  assert.ok(m, `no encuentro la regla ${selector}`);
  return m[2];
}

describe("franja de seguridad: sin parpadeo en iPad", () => {
  it("la franja no usa backdrop-filter (ni con prefijo)", () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(sinComentarios, /backdrop-filter\s*:/, "hay un backdrop-filter en franja-seguridad.css");
  });

  it("la descripción del sello sigue siendo un globo oscuro casi opaco (mismo diseño)", () => {
    const desc = regla(".dcsg__desc");
    const m = desc.match(/background:\s*rgba\(9,\s*14,\s*40,\s*(\.\d+|0?\.\d+|1)\)/);
    assert.ok(m, "la descripción debe llevar el fondo azul noche rgba(9, 14, 40, a)");
    assert.ok(Number(m[1]) >= 0.94, `con el desenfoque fuera, el fondo debe ir casi opaco (a ≥ .94), va ${m[1]}`);
  });

  it("el panel pinta un azul noche sólido después del atajo background", () => {
    const panel = regla(".dcsg__panel");
    const atajo = panel.search(/(^|;)\s*background\s*:/);
    const color = panel.search(/background-color\s*:\s*#101a3c/);
    assert.notEqual(atajo, -1, "el panel debe tener su atajo `background` con los degradados");
    assert.notEqual(color, -1, "el panel debe tener `background-color: #101a3c`");
    assert.ok(color > atajo, "`background-color` debe ir DESPUÉS del atajo `background` (el atajo lo resetea a transparente)");
  });

  it("el panel no usa will-change (en WebKit crea capas compuestas enormes)", () => {
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /will-change\s*:/);
  });

  it("el motor repinta el canvas en cuanto cambia de tamaño, también en marcha", () => {
    // Cambiar `canvas.width` lo deja transparente: si solo se repintara
    // parado, en marcha el globo desaparecería un cuadro al girar la tableta.
    const ro = motor.match(/new ResizeObserver\(\(\) => \{([\s\S]*?)\}\)/);
    assert.ok(ro, "el motor debe observar el tamaño del canvas con ResizeObserver");
    assert.match(ro[1], /if \(medir\(\)\) pintar\(\);/);
    assert.doesNotMatch(ro[1], /!corriendo/);
  });
});
