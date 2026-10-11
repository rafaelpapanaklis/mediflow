/**
 * Parpadeo de la franja de seguridad en iPad (7 y 11-oct-2026, ws1-t10).
 *
 * Rafael vio en un iPad real que el panel «Tus pacientes, protegidos»
 * alternaba entre su azul y el blanco de la página al bajar por la franja, y
 * que al tocar un sello dejaba de parpadear. Estas pruebas fijan las
 * condiciones del arreglo leyendo el CSS, el marcado y los componentes tal
 * cual están en el repo (sin navegador):
 *
 *  Primera vuelta (7-oct):
 *  1. Ningún `backdrop-filter` en la franja.
 *  2. El panel lleva un `background-color` sólido azul noche DESPUÉS del
 *     atajo `background`.
 *
 *  Segunda vuelta (11-oct), la causa de fondo:
 *  3. El panel NO lleva `data-reveal` (el panel entero en `opacity: 0` hasta
 *     que el observador lo ve, y la transición sobre una capa de 1160 × 730 px
 *     justo al pasar): el reveal va en la cabecera. Medido en WebKit: con el
 *     reveal en el panel, los dos primeros cuadros en que asoma son 100 %
 *     blancos.
 *  4. El panel NO recorta con `overflow: hidden`: recortar con radio a hijos
 *     compuestos obliga a WebKit a componerlo como capa propia, que iOS
 *     desengancha fuera de la cobertura y repinta con retraso al hacer scroll.
 *  5. Red de seguridad en Safari de iPad/iPhone (WebKit táctil): sin canvas,
 *     sin animaciones de capa, globo como imagen fija; los sellos siguen
 *     abriendo su descripción al tocarlos.
 *
 * Con el código del 8-oct (95e64867) fallan 3, 4 y 5.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { esWebKitTactil } from "../globo-seguridad-vivo";

const aqui = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(aqui, "..", "franja-seguridad.css"), "utf8");
const motor = readFileSync(join(aqui, "..", "globo-seguridad-motor.ts"), "utf8");
const marcado = readFileSync(join(aqui, "..", "franja-seguridad.tsx"), "utf8");
const vivo = readFileSync(join(aqui, "..", "globo-seguridad-vivo.tsx"), "utf8");
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Cuerpo de la primera regla cuyo selector es exactamente `selector`. */
function regla(selector: string): string {
  const re = new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = sinComentarios.match(re);
  assert.ok(m, `no encuentro la regla ${selector}`);
  return m[2];
}

describe("franja de seguridad: sin parpadeo en iPad (7-oct)", () => {
  it("la franja no usa backdrop-filter (ni con prefijo)", () => {
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
    assert.doesNotMatch(sinComentarios, /will-change\s*:/);
  });

  it("el motor repinta el canvas en cuanto cambia de tamaño, también en marcha", () => {
    const ro = motor.match(/new ResizeObserver\(\(\) => \{([\s\S]*?)\}\)/);
    assert.ok(ro, "el motor debe observar el tamaño del canvas con ResizeObserver");
    assert.match(ro[1], /if \(medir\(\)\) pintar\(\);/);
    assert.doesNotMatch(ro[1], /!corriendo/);
  });
});

describe("franja de seguridad: la causa de fondo (11-oct)", () => {
  it("el reveal de la página va en la cabecera, nunca en el panel entero", () => {
    assert.doesNotMatch(marcado, /data-reveal=""\s+className="dcsg__panel"|className="dcsg__panel"\s+data-reveal/, "el panel no debe llevar data-reveal");
    assert.match(marcado, /data-reveal=""\s+className="dcsg__head"/, "la cabecera sí lleva el reveal");
  });

  it("el panel no recorta con overflow (recortar hijos compuestos lo convierte en capa propia)", () => {
    assert.doesNotMatch(regla(".dcsg__panel"), /overflow\s*:/);
  });

  it("lo que llena el panel con inset: 0 recorta con su mismo radio", () => {
    assert.match(regla(".dcsg__panel"), /--dcsg-radio\s*:/);
    assert.match(regla(".dcsg__fondo"), /border-radius\s*:\s*var\(--dcsg-radio\)/);
    assert.match(regla(".dcsg__panel::after"), /left\s*:\s*var\(--dcsg-radio\)/);
  });
});

describe("franja de seguridad: versión estática en Safari de iPad/iPhone (11-oct)", () => {
  const coarse = (q: string) => q === "(any-pointer: coarse)";
  const fino = () => false;

  it("detecta WebKit táctil: Safari de iPad/iPhone sí; Safari de Mac, Chrome y Android no", () => {
    assert.equal(esWebKitTactil({ vendor: "Apple Computer, Inc.", maxTouchPoints: 5 }, fino), true, "iPad/iPhone Safari");
    assert.equal(esWebKitTactil({ vendor: "Apple Computer, Inc.", maxTouchPoints: 0 }, coarse), true, "WebKit táctil que no informa maxTouchPoints");
    assert.equal(esWebKitTactil({ vendor: "Apple Computer, Inc.", maxTouchPoints: 0 }, fino), false, "Safari de Mac");
    assert.equal(esWebKitTactil({ vendor: "Google Inc.", maxTouchPoints: 5 }, coarse), false, "Chrome en Android");
    assert.equal(esWebKitTactil({ vendor: "", maxTouchPoints: 5 }, coarse), false, "Firefox en Android");
  });

  it("en ese modo el componente no carga el motor, no arma la entrada y muestra la imagen fija", () => {
    assert.match(vivo, /classList\.add\("dcsg--estatico"\)/);
    assert.match(vivo, /if \(!quieto && !fijo\)/, "sin entrada (dcsg--js) en la versión estática");
    assert.match(vivo, /else if \(lienzo instanceof HTMLCanvasElement\)/, "el motor solo se pide cuando NO es la versión estática");
    assert.match(vivo, /<img[\s\S]*src=\{RUTA_GLOBO_ESTATICO\}/);
    assert.match(vivo, /classList\.add\("is-vivo"\)/, "la imagen apaga la malla de reserva como lo hacía el canvas");
  });

  it("el CSS apaga en dcsg--estatico todas las animaciones de capa y las cometas", () => {
    const bloque = sinComentarios.slice(sinComentarios.indexOf(".dcsg__panel.dcsg--estatico"));
    assert.ok(bloque.length > 0, "falta el bloque .dcsg__panel.dcsg--estatico");
    for (const sel of [".dcsg__sello", ".dcsg__escudo", ".dcsg__onda", ".dcsg__medalla::before", ".dcsg__meridiano", ".dcsg__lazo-pulso"]) {
      assert.match(bloque, new RegExp(`\\.dcsg__panel\\.dcsg--estatico [^{]*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]*\\{[^}]*animation\\s*:\\s*none`), `${sel} debe quedar sin animación`);
    }
    assert.match(bloque, /\.dcsg__panel\.dcsg--estatico \.dcsg__cometa\s*\{[^}]*display\s*:\s*none/);
    // Va al final del archivo: así pisa las reglas de movimiento con la misma especificidad.
    assert.ok(sinComentarios.lastIndexOf("@media") < sinComentarios.indexOf(".dcsg__panel.dcsg--estatico"), "el bloque estático debe ir después de todos los @media");
  });
});
