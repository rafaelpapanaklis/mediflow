/* ═══════════════════════════════════════════════════════════════════════
   LAS FOTOS SALEN TAL CUAL LAS SUBE LA BARBERÍA.

     npx tsx --test "src/components/barber/templates/__tests__/fotos-color.test.ts"

   Rafael (16-nov-2026), viendo Barrio en producción con los barberos en
   blanco y negro: «no quiero blanco y negro, necesito que la foto salga así
   como la sube el dueño de la barbería».

   En las plantillas que se OFRECEN ninguna regla de la piel puede cambiarle
   el color a una foto de la barbería (retratos, portada, local, portafolio,
   productos, logo): ni `filter`, ni mezclas, ni opacidad fija. Se permite:
     · el `filter` del MAPA de Google (.dcbw-mapa), que no es una foto suya;
     · degradados ENCIMA de la foto para leer el texto (son otra capa);
     · una entrada animada por opacidad (termina en 1; nunca con `filter`).

   La prueba es ESTÁTICA sobre skins.css y los .tsx. El resultado en pantalla
   se midió aparte en Chromium (estilos calculados de cada <img> y contraste
   del texto encima de fotos claras y oscuras, a 390 y 1440 px).
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const CARPETA = path.resolve(__dirname, "..");
const css = readFileSync(path.join(CARPETA, "skins.css"), "utf8");

/** Las pieles revisadas, en el orden en que aparecen en skins.css. */
const PIELES = ["oficio", "barrio", "revista"] as const;

/** Dónde empieza cada una de las tres que se ofrecen (van al final del archivo, en este orden). */
const ORDEN = ["oficio", "barrio", "revista"];
function trozo(piel: string): string {
  const desde = css.indexOf(`.dcbw-${piel} {`);
  assert.ok(desde > 0, `no encontré la piel ${piel}`);
  const sig = ORDEN[ORDEN.indexOf(piel) + 1];
  const hasta = sig ? css.indexOf(`.dcbw-${sig} {`) : css.length;
  assert.ok(hasta > desde, `las pieles ya no van en el orden ${ORDEN.join(", ")}`);
  return css.slice(desde, hasta);
}

/** Bloques `selector { declaraciones }` más internos (incluye los pasos de @keyframes). */
function reglas(texto: string): { selector: string; cuerpo: string }[] {
  const limpio = texto.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; cuerpo: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio))) out.push({ selector: m[1].trim().replace(/\s+/g, " "), cuerpo: m[2] });
  return out;
}

const valor = (cuerpo: string, prop: string): string | null => {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(cuerpo);
  return m ? m[1].trim() : null;
};

/** ¿El selector apunta a una foto de la barbería (o a su caja)? */
const ES_FOTO = /\bimg\b|-foto\b|-logo\b|retrato|rejilla|pared|galeria|-tira\b|capsula|espejo/;
const ES_PASO = /^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$/;

for (const piel of PIELES) {
  test(`${piel}: ningún filter fuera del mapa (ni en reglas ni en animaciones)`, () => {
    for (const r of reglas(trozo(piel))) {
      const f = valor(r.cuerpo, "filter");
      if (!f || f === "none") continue;
      assert.ok(
        r.selector.includes(".dcbw-mapa"),
        `«${r.selector}» aplica filter: ${f}. Las fotos de la barbería salen tal cual; solo el mapa puede llevar filtro.`,
      );
    }
  });

  test(`${piel}: nada de mezclas de color`, () => {
    for (const r of reglas(trozo(piel))) {
      for (const prop of ["mix-blend-mode", "background-blend-mode"]) {
        const v = valor(r.cuerpo, prop);
        assert.ok(!v || v === "normal", `«${r.selector}» usa ${prop}: ${v}`);
      }
    }
  });

  test(`${piel}: ninguna foto queda con opacidad fija menor que 1`, () => {
    for (const r of reglas(trozo(piel))) {
      if (ES_PASO.test(r.selector)) continue; // un paso de entrada; el final se revisa abajo
      const o = valor(r.cuerpo, "opacity");
      if (o === null || Number(o) >= 1) continue;
      assert.ok(!ES_FOTO.test(r.selector), `«${r.selector}» deja una foto con opacity: ${o}`);
    }
  });

  test(`${piel}: las animaciones de entrada terminan con la foto intacta`, () => {
    const texto = trozo(piel).replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const pasos = reglas(m[2]);
      for (const p of pasos) assert.equal(valor(p.cuerpo, "filter"), null, `@keyframes ${m[1]} usa filter en «${p.selector}»`);
      const fin = pasos.find((p) => /\bto\b|100%/.test(p.selector));
      const o = fin ? valor(fin.cuerpo, "opacity") : null;
      assert.ok(o === null || Number(o) === 1, `@keyframes ${m[1]} termina con opacity: ${o}`);
    }
  });

  test(`${piel}: el componente no tiñe fotos con estilos en línea`, () => {
    const tsx = readFileSync(path.join(CARPETA, `t-${piel}.tsx`), "utf8");
    assert.doesNotMatch(tsx, /\bfilter\s*:/, "hay un `filter:` en línea");
    assert.doesNotMatch(tsx, /mixBlendMode|backgroundBlendMode/);
    assert.doesNotMatch(tsx, /\bopacity\s*:/, "hay un `opacity:` en línea");
  });
}

test("las piezas compartidas (Foto, productos) tampoco llevan filtros en línea", () => {
  const piezas = readFileSync(path.join(CARPETA, "pieces.tsx"), "utf8");
  assert.doesNotMatch(piezas, /\bfilter\s*:/);
  assert.doesNotMatch(piezas, /mixBlendMode|backgroundBlendMode/);
});
