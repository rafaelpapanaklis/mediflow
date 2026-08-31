/**
 * EL VISOR DE TOMOGRAFÍAS DEL INSTITUTO — panorámica, rejilla y pantalla.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-visor.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE PUEDE PROBAR AQUÍ Y QUÉ NO
 *
 * El visor es lienzos: sin navegador no hay `getBoundingClientRect`, ni
 * `ResizeObserver`, ni un dedo que arrastre. Nada de eso se comprueba aquí
 * y se dice en el reporte.
 *
 * Lo que SÍ se puede comprobar —y es justo lo que se rompe solo con el
 * tiempo— son los CONTRATOS que sostienen el visor y que no viven en un
 * único archivo:
 *
 *   1. Dos números que tienen que ser el MISMO número en el CSS y en el
 *      JS. Si se separan, los paneles dejan de ser cuadrados en silencio:
 *      nada falla, solo se ve mal, que es la peor forma de fallar.
 *   2. Que la rejilla se decida con @media y NUNCA con @container: el
 *      visor a pantalla completa es `fixed` y un contenedor de consulta lo
 *      atraparía dentro de su columna.
 *   3. Que la panorámica siga siendo del DENTAL —importada, no copiada— y
 *      que las tres piezas que se le importan sigan siendo PURAS. El día
 *      que el dental les meta un `fetch` a `/api/patients/**`, este
 *      archivo se pone rojo ANTES de que el instituto reciba un 401 en
 *      producción; es el mismo aviso que dejó la Ola 12 sobre
 *      `DicomSetViewer`.
 *   4. Que el efecto que DECODIFICA el volumen no dependa de nada del
 *      tamaño. Es el candado de "girar el iPad no vuelve a decodificar
 *      296 MB": si alguien añade `compacto` o el lado del panel a esa
 *      lista de dependencias, el estudio se vuelve a leer entero cada vez
 *      que el aparato rota, y en una pantalla eso no se nota hasta que un
 *      alumno está en el sillón.
 *   5. Que siga en pie lo que no se debía romper: el aviso de que el CBCT
 *      no da unidades Hounsfield, los presets de ventana, el umbral del
 *      volumen y el bloque de apoyo de IA.
 *
 * Los comentarios se quitan antes de buscar: se juzga a un archivo por lo
 * que hace, no por lo que dice su prosa.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_COLUMNAS_CANDIDATAS,
  EDU_MEDIA_COMPACTO,
  EDU_PANEL_CHROME,
  EDU_REJILLA_GAP,
  eduMejorReparto,
} from "../../../components/edu/estudios/visor-medidas";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** Un texto sin sus comentarios. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** El archivo, sin comentarios. */
function fuente(...tramos: string[]): string {
  return sinComentarios(crudo(...tramos));
}

/** Todos los .ts/.tsx bajo una carpeta del vertical. */
function archivosDe(...tramos: string[]): string[] {
  const base = join(RAIZ, ...tramos);
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((p) => join(base, p));
}

const CBCT = "src/components/edu/estudios/cbct-viewer.tsx";
const PANO_HOST = "src/components/edu/estudios/panoramica-pane.tsx";
const MEDIDAS = "src/components/edu/estudios/visor-medidas.ts";
const GESTOS = "src/components/edu/estudios/visor-gestos.ts";
const SHELL = "src/components/edu/estudios/visor-shell.tsx";
const VIEWER = "src/components/edu/expediente/estudio-viewer.tsx";
const TEMA = "src/app/instituto/edu-theme.css";

/** El bloque del CSS que va desde una regla hasta su llave de cierre. */
function regla(css: string, selector: string): string {
  const i = css.indexOf(selector + " {");
  assert.notEqual(i, -1, `no se encontró la regla ${selector}: ¿la renombraron?`);
  const fin = css.indexOf("}", i);
  return css.slice(i, fin);
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · Los números del CSS y los del JS son EL MISMO número
 * ═══════════════════════════════════════════════════════════════════════ */

test("el hueco de la rejilla es el mismo en el CSS que en visor-medidas.ts", () => {
  const css = crudo(TEMA);
  const bloque = regla(css, ".edu-visor3d-grid");
  assert.match(
    bloque,
    new RegExp(`gap:\\s*${EDU_REJILLA_GAP}px`),
    `.edu-visor3d-grid debe declarar gap: ${EDU_REJILLA_GAP}px — el lado del ` +
      "cuadrado se calcula descontando ese hueco, y si se separan los paneles " +
      "dejan de ser cuadrados sin que nada falle",
  );
});

test("la barra bajo el corte mide lo que el JS descuenta para el cuadrado", () => {
  const css = crudo(TEMA);
  const bloque = regla(css, ".edu-visor3d-pane__barra");
  assert.match(
    bloque,
    new RegExp(`height:\\s*${EDU_PANEL_CHROME}px`),
    `.edu-visor3d-pane__barra debe medir ${EDU_PANEL_CHROME}px — es lo que se ` +
      "resta del lado para que la TARJETA salga cuadrada, no solo su imagen",
  );
  assert.match(bloque, /box-sizing:\s*border-box/, "sin border-box el borde suma y descuadra");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · @media, NUNCA @container
 * ═══════════════════════════════════════════════════════════════════════ */

test("la rejilla del visor no usa consultas de contenedor", () => {
  const css = crudo(TEMA);
  const desde = css.indexOf(".edu-visor3d-grid {");
  const hasta = css.indexOf(".edu-visor3d-aviso {");
  assert.ok(desde > 0 && hasta > desde, "no se encontró el bloque del visor en edu-theme.css");
  const bloque = css.slice(desde, hasta);
  assert.equal(
    /@container/.test(bloque),
    false,
    "el visor a pantalla completa es `fixed`: un @container lo atraparía dentro de su columna",
  );
  assert.ok(bloque.includes("min-width: 760px"), "falta el @media de respaldo de la rejilla");
  assert.ok(
    bloque.includes("grid-column: 1 / -1"),
    "la panorámica va de borde a borde: si no, quedan huecos en su fila",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 bis · El reparto que hace los paneles MÁS GRANDES
 * ═══════════════════════════════════════════════════════════════════════ */

test("en un monitor ancho gana la tira de cuatro, y usa el ancho entero", () => {
  // 1834×650 es una ventana de 1080p maximizada, ya descontados cabecera,
  // barras, avisos y pie. Dos filas de cuadrados topan en 321 px y dejan
  // 855 px de monitor en negro; una sola fila llega a 448.
  const { columnas, lado } = eduMejorReparto(1818, 650);
  assert.equal(columnas, 4);
  assert.equal(lado, 448);
  const ancho = columnas * lado + (columnas - 1) * EDU_REJILLA_GAP;
  assert.ok(ancho > 1800, `la rejilla solo usa ${ancho} px de 1818`);
  assert.ok(lado <= 650, "un panel no puede ser más alto que el hueco que hay");
});

test("en una tablet de pie gana el 2×2", () => {
  // iPad vertical: 768 de ancho, ~700 de alto libre.
  const { columnas, lado } = eduMejorReparto(748, 700);
  assert.equal(columnas, 2);
  assert.ok(lado >= 340 && lado <= 346, `lado inesperado: ${lado}`);
});

test("los cuatro cuadrados SIEMPRE caben en el alto que hay", () => {
  // La promesa del reparto: nadie tiene que desplazar para ver los cuatro
  // planos. Se comprueba en una parrilla de ventanas reales y raras.
  const ventanas = [
    [1818, 650], // 1080p maximizado
    [2723, 629], // monitor muy ancho y bajo
    [748, 700], // tablet de pie
    [1000, 450], // tablet acostada
    [640, 1200], // ventana angosta y alta
    [1500, 300], // ventana muy baja
  ];
  for (const [w, h] of ventanas) {
    const { columnas, lado } = eduMejorReparto(w, h);
    const filas = Math.ceil(4 / columnas);
    assert.ok(
      columnas * lado + (columnas - 1) * EDU_REJILLA_GAP <= w,
      `${w}×${h}: la rejilla (${columnas}×${lado}) se sale de ancho`,
    );
    assert.ok(
      filas * lado + (filas - 1) * EDU_REJILLA_GAP <= h,
      `${w}×${h}: los cuatro cuadrados (${filas} filas de ${lado}) no caben en el alto`,
    );
  }
});

test("solo se consideran 1, 2 y 4 columnas", () => {
  // Con 3, el cuarto panel se queda solo en la segunda fila dejando dos
  // huecos, y encima nunca gana: necesita las mismas dos filas que el 2×2
  // con columnas más estrechas.
  assert.deepEqual(EDU_COLUMNAS_CANDIDATAS, [1, 2, 4]);
  for (const [w, h] of [
    [1818, 650],
    [748, 700],
    [2723, 629],
    [640, 1200],
  ]) {
    assert.notEqual(eduMejorReparto(w, h).columnas, 3);
  }
});

test("el umbral compacto mira el lado MENOR, para que girar no cambie de modo", () => {
  // Ancho pequeño O alto pequeño con dedo: un teléfono da compacto de pie y
  // acostado, así que rotarlo no cruza el umbral ni remonta un lienzo.
  assert.match(EDU_MEDIA_COMPACTO, /max-width:\s*599\.98px/);
  assert.match(EDU_MEDIA_COMPACTO, /max-height:\s*599\.98px/);
  assert.match(EDU_MEDIA_COMPACTO, /pointer:\s*coarse/);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · La panorámica se IMPORTA del dental. No se copia.
 * ═══════════════════════════════════════════════════════════════════════ */

const PIEZAS_PANO = [
  "src/components/patient-3d/PanoramicPane.tsx",
  "src/components/patient-3d/arch-autodetect.ts",
  "src/components/patient-3d/panoramic-reslice.ts",
];

test("el anfitrión importa PanoramicPane del dental", () => {
  const src = fuente(PANO_HOST);
  assert.ok(
    src.includes("@/components/patient-3d/PanoramicPane"),
    "la panorámica tiene que venir del dental, no de una copia",
  );
});

test("ninguna pieza de la panorámica está copiada dentro del vertical", () => {
  const firmas = ["export function autoDetectArch", "export function reslicePanoramic"];
  for (const archivo of archivosDe("src/components/edu")) {
    const src = sinComentarios(readFileSync(archivo, "utf8"));
    for (const firma of firmas) {
      assert.equal(
        src.includes(firma),
        false,
        `${archivo} contiene "${firma}": la matemática de la arcada se IMPORTA del ` +
          "dental; una copia se queda sin las correcciones que el dental pague mañana",
      );
    }
  }
});

test("las tres piezas de la panorámica siguen siendo PURAS", () => {
  // Este es el guardián de "no hizo falta adaptador". Cuando una de ellas se
  // acople a las tablas del dental habrá que envolverla —o dejar de
  // importarla—, y más vale enterarse aquí que con un 401 en producción.
  const acoples = [/\/api\//, /\bpatientId\b/, /\bfileId\b/, /\bfetch\(/, /\bprisma\b/];
  for (const pieza of PIEZAS_PANO) {
    const src = fuente(pieza);
    for (const acople of acoples) {
      assert.equal(
        acople.test(src),
        false,
        `${pieza} ya no es pura (${acople}): el instituto la importa TAL CUAL y ` +
          "eso deja de ser correcto en cuanto toca datos del dental",
      );
    }
  }
});

test("el contenedor acoplado del dental sigue fuera del vertical", () => {
  // DicomSetViewer trae fetch INTERNOS a /api/patients/**: con ids del
  // instituto contestan 401/404 y un adaptador no puede redirigirlos.
  const carpetas = ["src/components/edu", "src/app/instituto"];
  for (const carpeta of carpetas) {
    for (const archivo of archivosDe(carpeta)) {
      // Sin comentarios a propósito: el visor EXPLICA en su cabecera por qué
      // no lo importa, y esa prosa no es una importación.
      const src = sinComentarios(readFileSync(archivo, "utf8"));
      assert.equal(
        src.includes("DicomSetViewer"),
        false,
        `${archivo} importa DicomSetViewer: el contenedor del dental trae fetch a ` +
          "/api/patients/** que con ids del instituto contestan 401/404",
      );
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · Cambiar de tamaño NO vuelve a decodificar
 * ═══════════════════════════════════════════════════════════════════════ */

test("el efecto que decodifica el volumen no depende de nada del tamaño", () => {
  const src = fuente(CBCT);
  const i = src.indexOf("}, [cacheKey, url");
  assert.notEqual(
    i,
    -1,
    "no se encontró la lista de dependencias del efecto de carga: ¿se reescribió?",
  );
  const deps = src.slice(i + 4, src.indexOf("]", i) + 1);
  const prohibidas = [
    "compacto",
    "maximizada",
    "medidas",
    "lado",
    "disponible",
    "vista",
    "montadas",
    "tactil",
  ];
  for (const d of prohibidas) {
    assert.equal(
      deps.includes(d),
      false,
      `"${d}" está en las dependencias del efecto que decodifica ${deps}. ` +
        "Girar el iPad o maximizar un panel volvería a leer los 668 cortes " +
        "(296 MB) desde cero.",
    );
  }
  assert.ok(deps.includes("cacheKey") && deps.includes("url"), "debe depender del estudio");
});

test("maximizar OCULTA los demás paneles, no los desmonta", () => {
  // Desmontarlos obligaría a re-rasterizar los cortes, resubir la textura 3D
  // y RE-DETECTAR la arcada al volver a la rejilla.
  const css = crudo(TEMA);
  assert.ok(
    css.includes(".edu-visor3d-grid--solo > * {"),
    "falta la regla que oculta las celdas no activas",
  );
  assert.match(regla(css, ".edu-visor3d-grid--solo > *"), /display:\s*none/);
});

test("el alto del volumen 3D no entra en las dependencias de su textura", () => {
  // Dicom3DVolume reconstruye la Data3DTexture con [slices, maxDim,
  // zSpacingMm, zPhysicalOrder]. El instituto le pasa `height="100%"` justo
  // para que el tamaño lo resuelva el CSS y no un cambio de prop pesada.
  const src = fuente(CBCT);
  assert.match(src, /height="100%"/, "el volumen debe medirse por CSS, no por una prop de alto");
  assert.match(
    src,
    /maxDim=\{lowMem \? 128 : 256\}/,
    "la resolución de la textura depende de la MEMORIA del aparato, no de la ventana",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5 · Lo que no se debía romper sigue en pie
 * ═══════════════════════════════════════════════════════════════════════ */

test("el aviso de que el CBCT no da unidades Hounsfield sigue textual", () => {
  const src = crudo(CBCT);
  assert.ok(
    src.includes("El CBCT no entrega unidades Hounsfield reales"),
    "ese aviso es lo que evita prometer densidad ósea que el equipo no mide",
  );
  assert.ok(src.includes("no sustituye una estación diagnóstica"));
});

test("los presets de ventana y el umbral del volumen siguen ahí", () => {
  const src = fuente(CBCT);
  // Auto / Hueso / Tejido / Aire viven en WINDOW_PRESETS (dental).
  assert.ok(src.includes("WINDOW_PRESETS.map"), "faltan los presets de ventana 2D");
  // El umbral (iso) lo pinta la propia barra de Dicom3DVolume.
  assert.ok(src.includes("<Dicom3DVolume"), "sin el volumen no hay umbral que ajustar");
  assert.ok(src.includes("<GeometryWarning"), "el juicio de geometría del dental sigue puesto");
});

test("el bloque de apoyo de IA sigue montado en el visor", () => {
  const src = fuente(VIEWER);
  assert.ok(
    src.includes("<EduAnalisisIa"),
    "el panel de IA se pinta SIEMPRE, también apagado: su primer trabajo es decir por qué",
  );
});

test("el freno del estudio pesado sigue existiendo y sigue siendo de MEMORIA", () => {
  const src = fuente(CBCT);
  assert.ok(src.includes("EDU_CBCT_MOVIL_MAX_BYTES"), "se quitó el freno del estudio pesado");
  assert.ok(
    src.includes("eduLowMemDevice"),
    "el freno mira la memoria del aparato, no el tamaño de la ventana",
  );
  // Y el tamaño de la ventana NO decide si se descarga.
  const i = src.indexOf("EDU_CBCT_MOVIL_MAX_BYTES)");
  const guardia = src.slice(Math.max(0, i - 200), i);
  assert.equal(
    guardia.includes("compacto"),
    false,
    "el freno de memoria no puede depender del tamaño de la ventana",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6 · Higiene del vertical
 * ═══════════════════════════════════════════════════════════════════════ */

test("ningún texto visible del visor dice \"Ola N\"", () => {
  for (const archivo of [CBCT, PANO_HOST, MEDIDAS, GESTOS, SHELL, VIEWER]) {
    const src = fuente(archivo);
    assert.equal(
      /Ola\s+\d/.test(src),
      false,
      `${archivo} menciona una ola fuera de un comentario: el usuario no sabe qué es una ola`,
    );
  }
});

test("el visor no escribe ni lee nada del servidor por su cuenta", () => {
  // Todo lo que necesita llega por props desde la galería, que ya resolvió
  // institutionId con getEduContext() y el alcance con visibility.ts. Un
  // fetch nuevo aquí sería una puerta sin gate.
  for (const archivo of [CBCT, PANO_HOST, MEDIDAS, GESTOS, SHELL]) {
    const src = fuente(archivo);
    assert.equal(/\/api\//.test(src), false, `${archivo} llama a una API por su cuenta`);
    assert.equal(/\bprisma\b/.test(src), false, `${archivo} toca prisma desde el navegador`);
  }
});

test("los gestos táctiles no editan el dental: solo le reenvían eventos", () => {
  const src = fuente(GESTOS);
  assert.ok(src.includes("dispatchEvent"), "los gestos se traducen a eventos que MprPane ya entiende");
  assert.ok(src.includes("ctrlKey: true"), "el pellizco viaja como Ctrl+rueda, que es el zoom de MprPane");
  assert.ok(
    src.includes("button: boton"),
    "el paneo a dos dedos viaja como botón central, que MprPane ya trata como paneo",
  );
});
