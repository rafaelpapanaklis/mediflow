/**
 * Tipografía del panel (Instrument Sans en todo /dashboard) — candados.
 *
 * Run: npm run test:tipografia-panel
 *
 * Lo que fija:
 *  - La tipografía cuelga del MISMO interruptor que el menú de dos niveles: si
 *    alguien quita esa condición, todas las clínicas cambiarían de letra.
 *  - Se declara en UN solo sitio (este componente) y sobre el <body>, que es lo
 *    único que alcanza a los menús, tooltips y avisos que cuelgan fuera del panel.
 *  - Reusa el archivo de fuente que ya está en el repo (`src/fonts/menu.ts`,
 *    `instrument-sans-latin-var.woff2`): ni una segunda copia, ni Google, y sin
 *    precarga para que las demás clínicas no lo descarguen.
 *  - No toca `--font-mono` (importes, horas y folios) ni `--font-logo` (wordmark).
 *  - Los números siguen saliendo de ancho fijo: IBM Plex Sans lo hacía solo,
 *    Instrument Sans necesita `tabular-nums`, también en botones y campos, donde
 *    el navegador borra la herencia. Dentro del menú, los numerales del diseño.
 *  - Los PDF y los correos se quedan como están: ni una referencia a la fuente
 *    nueva ni a `--font-sans`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const COMPONENTE = "src/components/dashboard/menu-dos-niveles/tipografia-panel.tsx";
const BARRA = "src/components/dashboard/menu-dos-niveles/topbar-dos-niveles.tsx";
const LAYOUT = "src/app/dashboard/layout.tsx";
const MODULO_CSS = "src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css";

test("la tipografía se monta SOLO con el interruptor del menú encendido", () => {
  // Va dentro de la barra superior del diseño nuevo: el layout solo la pinta
  // con el interruptor encendido y, a diferencia del menú —que en el teléfono
  // vive en un cajón y no se monta hasta abrirlo—, la barra está siempre.
  const barra = leer(BARRA);
  assert.match(barra, /import \{ TipografiaPanel \} from "\.\/tipografia-panel"/);
  assert.equal((barra.match(/<TipografiaPanel/g) ?? []).length, 1);
  assert.match(leer(LAYOUT), /menuDosNiveles \? \(\s*<TopbarDosNiveles/);
});

test("el layout no se entera: el camino del menú de siempre queda intacto", () => {
  // Un hijo más entre los del layout —aunque su condición casi siempre dé
  // falso— le cambia a React el número de ranuras de ese nivel, y con él los
  // `useId` de todo lo que cuelga: las clínicas SIN interruptor dejarían de
  // recibir el HTML de hoy. Medido: con este montaje sale idéntico.
  assert.doesNotMatch(leer(LAYOUT), /TipografiaPanel/);
});

test("nadie más lo monta: el panel tiene una sola raíz de tipografía", () => {
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        recorrer(rel);
      } else if (/\.tsx?$/.test(e.name) && leer(rel).includes("TipografiaPanel")) {
        encontrados.push(rel);
      }
    }
  };
  recorrer("src");
  assert.deepEqual(encontrados.sort(), [
    COMPONENTE,
    BARRA,
    "src/components/dashboard/menu-dos-niveles/__tests__/tipografia-panel.test.ts",
  ].sort());
});

test("la fuente es la que ya está en el repo, local y sin precarga", () => {
  const componente = leer(COMPONENTE);
  assert.match(componente, /import \{ instrumentSans \} from "@\/fonts\/menu"/);
  // Ni Google, ni un módulo de fuente nuevo, ni un @font-face a mano.
  assert.doesNotMatch(componente, /next\/font\/google|fonts\.googleapis|@font-face/);

  const menu = leer("src/fonts/menu.ts");
  assert.match(menu, /instrument-sans-latin-var\.woff2/);
  assert.match(menu, /preload:\s*false/); // si no, la descargarían TODAS las clínicas

  // Una sola copia del archivo en el repo.
  const woff2 = readdirSync(join(RAIZ, "src/fonts")).filter((f) => /instrument.*\.woff2$/.test(f));
  assert.deepEqual(woff2, ["instrument-sans-latin-var.woff2"]);
});

/** Solo las reglas CSS del componente, sin los comentarios que las explican. */
function reglas(): string {
  const m = leer(COMPONENTE).match(/const CSS = \[([\s\S]*?)\]\.join\(""\);/);
  assert.ok(m, "no se encontró el bloque de reglas CSS del componente");
  return m![1];
}

test("redefine --font-sans sobre el <body>, y nada más", () => {
  const css = reglas();
  assert.match(css, /:root body\{--font-sans:\$\{instrumentSans\.style\.fontFamily\}/);
  // La monoespaciada, la del wordmark y la de los íconos no se tocan.
  assert.doesNotMatch(css, /--font-mono\s*:/);
  assert.doesNotMatch(css, /--font-logo\s*:/);
  assert.doesNotMatch(css, /--font-iconos-menu\s*:/);
  // Sin !important: el peso lo da `:root` delante de `body`.
  assert.doesNotMatch(css, /!important/);
});

test("los números siguen siendo de ancho fijo, incluso en botones y campos", () => {
  const css = reglas();
  assert.match(css, /:root body\{--font-sans:[\s\S]*?;font-variant-numeric:tabular-nums\}/);
  // Sin `:root` delante: solo tiene que ganarle a la hoja del navegador, para
  // que una clase puesta a mano en un botón o un campo siga mandando.
  assert.match(css, /`body button,body input,body select,body textarea\{font-variant-numeric:inherit\}`/);
  // Y el menú conserva los suyos.
  assert.match(css, /:root body \.\$\{s\.tokens\}\{font-variant-numeric:normal\}/);
});

test("la clase con la que se excluye al menú sigue existiendo", () => {
  // `s.tokens` sale de un módulo CSS: TypeScript lo da por `string` aunque la
  // clase no exista, así que un renombre dejaría el selector en `.undefined`
  // —válido, silencioso y sin efecto— y el menú perdería los numerales de su
  // diseño. Esto lo caza aquí.
  assert.match(leer(MODULO_CSS), /^\.tokens \{/m);
  // Desde «Personalizar» (WS1-T4) esa clase ya no se escribe en el menú: vive en
  // CLASES_MENU (clases.ts), que es lo que se pone a la raíz del menú y a cada
  // portal suyo (cajón, tooltips, desplegables, el diálogo de Personalizar).
  assert.match(leer("src/components/dashboard/menu-dos-niveles/clases.ts"), /s\.tokens/);
  assert.match(leer("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.tsx"), /CLASES_MENU/);
});

test("los PDF y los correos se quedan fuera", () => {
  const pdfs = readdirSync(join(RAIZ, "src/lib/pdf")).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  assert.ok(pdfs.length > 0);
  for (const f of [...pdfs.map((f) => `src/lib/pdf/${f}`), "src/lib/invoices/print-pdf.tsx", "src/lib/email.ts"]) {
    const texto = leer(f);
    assert.doesNotMatch(texto, /var\(--font-sans|instrumentSans|instrument-sans/, `${f} no debe saber de la tipografía del panel`);
    // @react-pdf/renderer solo puede usar una fuente si alguien la REGISTRA; sin
    // ese registro sigue con las suyas (Helvetica) y el PDF sale igual que hoy.
    // Los comentarios de esos archivos hablan de Font.register: se busca la
    // llamada, no la palabra.
    assert.doesNotMatch(texto, /Font\.register\s*\(/, `${f}: registrar una fuente en el PDF es otra tarea`);
  }
});
