/**
 * Imagen estática del globo de la franja de seguridad (11-oct-2026, ws1-t10).
 *
 * En Safari de iPad/iPhone el globo es public/landing/seguridad/globo.svg,
 * generado del mismo mapa y la misma proyección que el canvas
 * (scripts/landing-globo-estatico.ts). Estas pruebas fijan que:
 *  1. el archivo publicado es EXACTAMENTE lo que genera el código (si cambia
 *     el motor hay que regenerarlo);
 *  2. es el cuadro completo (tierra en cinco capas, arcos, ciudades), con la
 *     misma caja que el SVG del mar (240 × 240) y un peso razonable;
 *  3. la ruta que usa el componente de cliente es la del archivo publicado.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { resumenGloboEstatico, svgGloboEstatico } from "../globo-seguridad-estatico";
import { RUTA_GLOBO_ESTATICO } from "../globo-seguridad-ruta";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..", "..", "..", "..", "..", "..", "..");
const publicado = join(raiz, "public", RUTA_GLOBO_ESTATICO);

describe("globo estático de la franja de seguridad", () => {
  it("el SVG publicado coincide con lo que genera el código", () => {
    assert.ok(existsSync(publicado), `falta ${publicado}: corre npx tsx scripts/landing-globo-estatico.ts`);
    assert.equal(readFileSync(publicado, "utf8"), svgGloboEstatico(), "public/landing/seguridad/globo.svg está desactualizado: regenéralo");
  });

  it("es el cuadro completo, en la caja del SVG del mar, y pesa poco", () => {
    const svg = svgGloboEstatico();
    const r = resumenGloboEstatico(svg);
    assert.match(svg, /viewBox="0 0 240 240"/);
    assert.equal(r.capas, 5, "cinco capas de profundidad, como el canvas");
    assert.ok(r.puntos > 600, `muy pocos puntos de tierra: ${r.puntos}`);
    assert.ok(r.ciudades >= 4, `muy pocas ciudades a la vista: ${r.ciudades}`);
    assert.match(svg, /stroke="#93c5fd"/, "los arcos entre ciudades");
    assert.ok(r.bytes < 60_000, `pesa ${r.bytes} bytes`);
    assert.doesNotMatch(svg, /NaN|undefined/);
  });

  it("el componente de cliente usa esa misma ruta y no importa el generador ni el motor", () => {
    const vivo = readFileSync(join(aqui, "..", "globo-seguridad-vivo.tsx"), "utf8");
    assert.match(vivo, /from "\.\/globo-seguridad-ruta"/);
    assert.doesNotMatch(vivo, /from "\.\/globo-seguridad-estatico"/, "el bundle de la portada arrastraría el mapa");
    // `import type` se borra al compilar: solo cuenta un import de valor.
    assert.doesNotMatch(vivo, /^import (?!type )[^;]*from "\.\/globo-seguridad-motor"/m, "el motor solo se carga con import()");
    assert.match(RUTA_GLOBO_ESTATICO, /^\/landing\/seguridad\/globo\.svg$/);
  });
});
