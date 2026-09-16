/**
 * CANDADOS DEL REDISEÑO DEL EDITOR DE PÁGINA WEB (ws1-t3).
 *
 * Run: npx tsx --test src/components/dashboard/pagina-web-rediseno/__tests__/pagina-web-rediseno.test.ts
 *
 * Copia el patrón de src/components/dashboard/hoy-rediseno/__tests__/hoy-rediseno.test.ts
 * (rama `rediseno/hoy`), con una diferencia deliberada: aquí el JSX nuevo NO
 * vive en archivos propios dentro de esta carpeta — vive DENTRO de los tres
 * archivos de siempre (landing-config-client.tsx, manifest-editor.tsx,
 * editor-client.tsx), en un bloque `if (rediseno) { … }` que se inserta ANTES
 * del `return` de siempre, que queda intacto y sin tocar (el mismo patrón que
 * ya usa `patients-client.tsx` con `rediseno`/`CLASES_REDISENO`).
 *
 * Por eso, en vez de leer una carpeta entera de archivos nuevos, este test
 * RECORTA de cada archivo el tramo entre su marcador `if (rediseno) {` y el
 * `return (` del camino viejo que le sigue — el mismo truco de slice por
 * marcador que ya usa `hoy-rediseno.test.ts` sobre `piezas.tsx`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");                 // src/
const CARPETA = join(SRC, "components", "dashboard", "pagina-web-rediseno");
const LANDING = join(SRC, "app", "dashboard", "landing");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const css   = readFileSync(join(CARPETA, "pagina-web.module.css"), "utf8");
const raiz  = readFileSync(join(CARPETA, "raiz.tsx"), "utf8");
const config = readFileSync(join(LANDING, "landing-config-client.tsx"), "utf8");
const manifest = readFileSync(join(LANDING, "manifest-editor.tsx"), "utf8");
const editor = readFileSync(join(LANDING, "editor", "editor-client.tsx"), "utf8");

/** El tramo NUEVO de un archivo: de su `if (rediseno) {` al siguiente `\n  return (` (el viejo). */
function tramoNuevo(texto: string, marcador = "if (rediseno) {"): string {
  const ini = texto.indexOf(marcador);
  assert.ok(ini >= 0, `no se encontró "${marcador}"`);
  const fin = texto.indexOf("\n  return (", ini + marcador.length);
  assert.ok(fin > ini, `no se encontró el "return (" del camino viejo después de "${marcador}"`);
  return texto.slice(ini, fin);
}

// El tramo nuevo de editor-client.tsx tiene DOS `if (rediseno) {` (el de
// `Aviso()` y el de `EditorVisual()`): se juntan los dos para las
// comprobaciones de contenido (letra de máquina, destinos).
const nuevoConfig = tramoNuevo(config);
const nuevoManifest = tramoNuevo(manifest);
const nuevoEditorAviso = tramoNuevo(editor, 'function Aviso({ titulo, cuerpo, rediseno = false }');
const nuevoEditorLienzo = editor.slice(editor.indexOf("El lienzo — REDISEÑO"), editor.indexOf("\n  return (\n    /* fixed y no absolute"));
const nuevoTotal = [nuevoConfig, nuevoManifest, nuevoEditorAviso, nuevoEditorLienzo].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en el código nuevo
// ═══════════════════════════════════════════════════════════════════════════
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en el bloque nuevo (rediseno) de las tres pantallas", () => {
  assert.ok(!LETRA_DE_MAQUINA.test(nuevoTotal), "el bloque `if (rediseno)` usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans");
});

test("pagina-web.module.css: sin letra de máquina", () => {
  assert.ok(!LETRA_DE_MAQUINA.test(css), "pagina-web.module.css usa letra de máquina");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los semánticos
// ═══════════════════════════════════════════════════════════════════════════
test("pagina-web.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
});

test("la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)", () => {
  assert.match(raiz, /CLASES_MENU/, "raiz.tsx no monta CLASES_MENU");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "no importa clases.ts del menú");
});

// ═══════════════════════════════════════════════════════════════════════════
// El interruptor es el compartido, no uno propio — y agrupado, no suelto
// ═══════════════════════════════════════════════════════════════════════════
test("las dos páginas usan el interruptor compartido, agrupado en su Promise.all", () => {
  for (const archivo of ["page.tsx", join("editor", "page.tsx")]) {
    const texto = leer(join("app", "dashboard", "landing", archivo));
    assert.match(texto, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${archivo} no usa el interruptor compartido`);
    assert.match(texto, /menuDosNivelesEncendido\(user\.clinicId\)/, `${archivo} no llama a menuDosNivelesEncendido`);
    // Agrupado: la llamada vive DENTRO de un Promise.all, no como un await suelto
    // (que sería una consulta añadida fuera del viaje que ya hacía la pantalla).
    // Cada page.tsx tiene un solo Promise.all, así que basta con que aparezca
    // ANTES de la llamada (sin ventana fija: el select de la clínica varía de
    // largo entre las dos páginas).
    const idx = texto.indexOf("menuDosNivelesEncendido(user.clinicId)");
    const posPromiseAll = texto.lastIndexOf("Promise.all(", idx);
    assert.ok(posPromiseAll >= 0 && posPromiseAll < idx, `${archivo}: menuDosNivelesEncendido no está dentro de un Promise.all`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo, intacto, y es el que sale por defecto
// ═══════════════════════════════════════════════════════════════════════════
test("las tres piezas devuelven el árbol de siempre cuando `rediseno` es false (el default)", () => {
  assert.match(config, /rediseno = false \}: Props/, "LandingConfigClient no tiene rediseno=false por default");
  assert.match(manifest, /rediseno = false,\n\}: ManifestEditorProps/, "ManifestEditor no tiene rediseno=false por default");
  assert.match(editor, /rediseno = false \}: \{ inicial: ClinicaDelEditor; rediseno\?: boolean \}/, "EditorVisual no tiene rediseno=false por default");

  // El bloque nuevo es un `if` que TERMINA antes del `return` de siempre —
  // no lo reemplaza. `tramoNuevo` ya exige exactamente esta forma (revienta
  // si no encuentra el `if` o el `return (` viejo que le sigue), así que
  // reusarlo aquí es la prueba: si el `if (rediseno)` no cerrara antes del
  // camino viejo, `tramoNuevo` ya habría fallado más arriba en el archivo.
  assert.ok(nuevoConfig.length > 100, "el bloque nuevo de landing-config-client.tsx está vacío");
  assert.ok(nuevoManifest.length > 100, "el bloque nuevo de manifest-editor.tsx está vacío");

  // Marcas del JSX de SIEMPRE que tienen que seguir ahí, sin tocar.
  assert.match(config, /const CARD_CLS\s*=\s*"bg-card/, "el JSX viejo de landing-config-client.tsx cambió (CARD_CLS)");
  assert.match(manifest, /const CARD = "bg-card/, "el JSX viejo de manifest-editor.tsx cambió (CARD)");
  assert.match(editor, /className="fixed inset-0 z-\[70\] flex flex-col bg-\[color:var\(--bg\)\]"/, "el JSX viejo de editor-client.tsx cambió (pantalla fixed)");
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos destinos que siempre: ni un botón que mande a otro sitio
// ═══════════════════════════════════════════════════════════════════════════
test("el rediseño manda a los mismos endpoints y rutas que la pantalla de siempre", () => {
  const destinos = [
    "/api/clinic-landing",
    "/api/landing-upload",
    "/landing-preview/",
    "/dashboard/landing/editor",
    "/dashboard/team",
  ];
  // Viven en funciones COMPARTIDAS por los dos caminos (save(), uploadImage(),
  // guardar()...), así que basta con que existan una vez en el archivo: el
  // camino nuevo los llama a través de las MISMAS funciones, no los repite.
  for (const d of destinos) {
    const enAlgunArchivo = config.includes(d) || manifest.includes(d) || editor.includes(d);
    assert.ok(enAlgunArchivo, `el rediseño perdió el destino ${d}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Nada se esconde por ancho: la vista previa se APILA, nunca `display:none`
// ═══════════════════════════════════════════════════════════════════════════
test("la vista previa del rediseño se apila en angosto, nunca desaparece", () => {
  assert.ok(!/\.previa\s*\{[^}]*display:\s*none/.test(css), "una regla .previa apaga la vista previa");
  assert.match(css, /@container paginaWeb \(max-width: 900px\)/, "falta el punto de corte que apila en vez de esconder");
  const bloqueApilado = css.slice(css.indexOf("@container paginaWeb"), css.indexOf("@container paginaWeb") + 400);
  assert.ok(!/display:\s*none/.test(bloqueApilado), "el punto de corte usa display:none en vez de apilar");
});
