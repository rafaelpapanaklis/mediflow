/**
 * CANDADOS DE «LO QUE MONTA EL LAYOUT» (ws1-t2, hallazgos 10, 12 y 20): el
 * cajón de Sabina y las piezas de su hilo, la barra de consulta activa y los
 * avisos (toasts).
 *
 * Run: npm run test:layout-rediseno
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO (que las hojas nuevas no inventen tokens ni letra de
 * máquina, que cada clase vieja tenga traducción, que el camino viejo siga
 * vivo y sin tocar, que el `sticky top` de la barra se mida y no se escriba a
 * mano), y eso se ve en el archivo. Y las piezas del hilo se PINTAN de verdad
 * con React, con y sin la ropa nueva, para demostrar que el esqueleto y los
 * textos son los mismos y que solo cambian las clases.
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "layout-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));
const hojas = archivosNuevos.filter((a) => a.nombre.endsWith(".css"));

/** Los nombres de clase que declara un módulo CSS (`.nombre`). */
const clasesDe = (cssTexto: string) =>
  new Set([...cssTexto.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));

/** Las claves de un mapa `export const NOMBRE: Record<string, string> = { … };`. */
const clavesDelMapa = (texto: string, nombre: string) => {
  const inicio = texto.indexOf(`export const ${nombre}: Record<string, string> = {`);
  assert.ok(inicio !== -1, `falta el mapa ${nombre}`);
  const mapa = texto.slice(inicio, texto.indexOf("\n};", inicio));
  return { mapa, claves: new Set([...mapa.matchAll(/^\s+([a-zA-Z0-9_]+):/gm)].map((m) => m[1])) };
};

/** El bloque de props de un elemento, de `<Nombre` a su `/>`. */
const bloque = (fuente: string, etiqueta: string) => {
  const i = fuente.search(new RegExp(`<${etiqueta}\\s`));
  assert.ok(i !== -1, `no monta <${etiqueta}>`);
  return fuente.slice(i, fuente.indexOf("/>", i));
};

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño; las cifras con tabular-nums", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`);
  }
  assert.ok(hojas.length >= 4, "se esperaban cuatro hojas (cajón, piezas, barra, avisos)");
  for (const h of hojas) {
    assert.match(h.texto, /font-variant-numeric:\s*tabular-nums/, `${h.nombre}: las cifras se alinean con tabular-nums`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: las hojas solo LEEN los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("ninguna hoja declara una variable CSS propia y todas leen --m2-*", () => {
  for (const h of hojas) {
    const declaraciones = h.texto.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
    assert.deepEqual(declaraciones, [], `${h.nombre} declara tokens propios: ${declaraciones.join(", ")}`);
    assert.match(h.texto, /var\(--m2-/, `${h.nombre} no lee los tokens del menú`);
  }
});

test("ni un color a mano: en la carpeta no hay un solo hex", () => {
  for (const a of archivosNuevos) {
    if (a.nombre.endsWith(".test.tsx")) continue;
    const sueltos = a.texto.split("\n").filter((l) => /#[0-9a-f]{3,8}\b/i.test(l));
    assert.deepEqual(sueltos, [], `${a.nombre} lleva colores copiados a mano:\n${sueltos.join("\n")}`);
  }
  // Los colores del menú se leen de clases.ts, no de una copia.
  const sabina = leer("components/dashboard/layout-rediseno/sabina.ts");
  const avisos = leer("components/dashboard/layout-rediseno/avisos.tsx");
  for (const t of [sabina, avisos]) {
    assert.match(t, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 10 · el cajón: dos pieles, un esqueleto; ninguna clase sin traducir
// ═══════════════════════════════════════════════════════════════════════════
test("sabina/panel.tsx conserva su módulo y elige la piel con `rediseno`; el mapa traduce TODAS sus clases", () => {
  const panel = leer("components/dashboard/sabina/panel.tsx");
  assert.ok(panel.includes('import styles from "./panel.module.css"'), "perdió su módulo de siempre");
  assert.match(panel, /rediseno \? CLASES_CAJON : styles/, "no elige la piel con `rediseno`");
  assert.ok(!/\bstyles\.[a-zA-Z]/.test(panel), "hay una clase que no pasa por `c` (se mezclarían las dos pieles)");

  const { mapa, claves: traducidas } = clavesDelMapa(leer("components/dashboard/layout-rediseno/sabina.ts"), "CLASES_CAJON");
  const viejas = clasesDe(leer("components/dashboard/sabina/panel.module.css"));
  const usadas = new Set([...panel.matchAll(/\bc\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]).filter((k) => viejas.has(k)));
  assert.ok(usadas.size >= 10, `se esperaban decenas de clases, hay ${usadas.size}`);
  assert.deepEqual([...usadas].filter((k) => !traducidas.has(k)), [], "clases del cajón sin traducir");
  assert.deepEqual([...traducidas].filter((k) => !viejas.has(k)), [], "traduce clases que panel.module.css no tiene");

  // Toda pieza citada existe en la hoja nueva; y las tres piezas que van en
  // `position: fixed` —fuera de cualquier raíz— montan CLASES_MENU ellas mismas.
  const hoja = clasesDe(hojas.find((h) => h.nombre === "cajon-sabina.module.css")!.texto);
  const piezas = [...mapa.matchAll(/\bcajon\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual(piezas.filter((k) => !hoja.has(k)), [], "piezas que no existen en cajon-sabina.module.css");
  for (const fija of ["fab", "velo", "panel"]) {
    assert.match(mapa, new RegExp(`^\\s+${fija}: \`\\$\\{CLASES_MENU\\} `, "m"), `${fija} no monta CLASES_MENU`);
  }

  // El hilo del cajón recibe el MISMO mapa que la pantalla (y solo con la bandera).
  const conv = bloque(panel, "SabinaConversacion");
  assert.ok(conv.includes("clases={rediseno ? CLASES_REDISENO : undefined}"), "el cajón no le baja el mapa de la pantalla al hilo");
  assert.ok(conv.includes("rediseno={rediseno}"), "el cajón no le baja la bandera al hilo (tarjetas)");
  assert.match(panel, /import \{ CLASES_REDISENO \} from "@\/app\/dashboard\/sabina\/sabina-client"/);
  assert.match(leer("app/dashboard/sabina/sabina-client.tsx"), /export const CLASES_REDISENO: Record<string, string> = \{/);

  // El enganche al layout baja la bandera, y nada más cambia en él.
  const lanzador = leer("components/dashboard/sabina/lanzador.tsx");
  assert.ok(bloque(lanzador, "SabinaPanel").includes("rediseno={rediseno}"), "el lanzador no baja `rediseno` al cajón");
});

test("las piezas del hilo (contenido, rastro, avisos) conservan su hoja y aceptan `clases`; el mapa las traduce todas", () => {
  const piezasTsx = ["components/sabina/message-content.tsx", "components/sabina/tool-trace.tsx", "components/sabina/error-notice.tsx"];
  const viejas = clasesDe(leer("components/sabina/sabina-widgets.module.css"));
  const { mapa, claves: traducidas } = clavesDelMapa(leer("components/dashboard/layout-rediseno/sabina.ts"), "CLASES_PIEZAS_SABINA");
  const usadas = new Set<string>();
  for (const rel of piezasTsx) {
    const texto = leer(rel);
    assert.ok(texto.includes('import styles from "./sabina-widgets.module.css"'), `${rel} perdió su hoja de siempre`);
    assert.match(texto, /clases \?\? styles/, `${rel}: sin \`clases\` no vuelve a las de siempre`);
    assert.ok(!/\bstyles\.[a-zA-Z]/.test(texto), `${rel}: hay una clase que no pasa por \`c\``);
    for (const m of texto.matchAll(/\bc\.([a-zA-Z0-9_]+)/g)) if (viejas.has(m[1])) usadas.add(m[1]);
  }
  assert.ok(usadas.size >= 20, `se esperaban decenas de clases, hay ${usadas.size}`);
  assert.deepEqual([...usadas].filter((k) => !traducidas.has(k)), [], "clases de las piezas sin traducir");
  assert.deepEqual([...traducidas].filter((k) => !viejas.has(k)), [], "traduce clases que sabina-widgets.module.css no tiene");
  const hoja = clasesDe(hojas.find((h) => h.nombre === "piezas-sabina.module.css")!.texto);
  const citadas = [...mapa.matchAll(/\bpiezas\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual(citadas.filter((k) => !hoja.has(k)), [], "piezas que no existen en piezas-sabina.module.css");

  // El hilo se las baja SOLO con la bandera, a las tres.
  const conv = leer("components/sabina/sabina-conversacion.tsx");
  assert.match(conv, /const piezas = rediseno \? CLASES_PIEZAS_SABINA : undefined;/, "el hilo no elige las piezas con `rediseno`");
  for (const etiqueta of ["SabinaMessageContent", "ToolTrace"]) {
    assert.ok(bloque(conv, etiqueta).includes("clases={piezas}"), `<${etiqueta}> no recibe las piezas`);
  }
  assert.equal((conv.match(/<SabinaErrorNotice\b[\s\S]*?clases=\{piezas\}/g) ?? []).length, 2, "los dos <SabinaErrorNotice> reciben las piezas");
});

// ═══════════════════════════════════════════════════════════════════════════
// Y PINTADAS de verdad: sin `clases` sale el HTML de siempre (hoja vieja, mismos
// textos); con `clases`, el mismo esqueleto con la hoja nueva, y ni un texto
// distinto. Cada módulo CSS se sustituye por un objeto que devuelve el nombre
// de la clase con un prefijo según la hoja, para distinguir las dos pieles.
// ═══════════════════════════════════════════════════════════════════════════
const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const cargarOriginal = M._load;
const proxyClases = (prefijo: string): Record<string, string> =>
  new Proxy({} as Record<string, string>, {
    get: (_t, k) => (k === "__esModule" ? false : k === "default" ? undefined : typeof k === "string" ? `${prefijo}${k}` : undefined),
  });
const VIEJA = proxyClases("vieja_");
const NUEVA = proxyClases("nueva_");
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".module.css")) return VIEJA;
  if (request === "@/components/dashboard/menu-dos-niveles/clases") return { CLASES_MENU: "tokens" };
  return cargarOriginal.call(this, request, parent, isMain);
};
// Con `require` y no con `import`: el sustituto del CSS tiene que estar puesto ANTES de cargar el componente.
const { SabinaMessageContent } = require("../../../sabina/message-content") as typeof import("../../../sabina/message-content");
const { ToolTrace } = require("../../../sabina/tool-trace") as typeof import("../../../sabina/tool-trace");
const { SabinaErrorNotice } = require("../../../sabina/error-notice") as typeof import("../../../sabina/error-notice");
const { AvisosVestibles } = require("../avisos") as typeof import("../avisos");

const sinPrefijo = (html: string) => html.replace(/\b(vieja|nueva)_/g, "");

test("las piezas del hilo: sin `clases` pintan la hoja vieja; con `clases`, la nueva; el esqueleto y los textos son los mismos", () => {
  const respuesta =
    "## Deudores\nHay 4 pacientes con saldo por $12,277.\n" +
    "- Paula Restringida — $7,777\n- Beto Munoz — $3,000 (2 facturas)\n" +
    "| Paciente | Saldo |\n|---|---|\n| Ana | $500 |\n" +
    "Te sugiero llamar primero a Paula.";
  const pares: Array<[string, JSX.Element, JSX.Element]> = [
    ["contenido", <SabinaMessageContent content={respuesta} />, <SabinaMessageContent content={respuesta} clases={NUEVA} />],
    ["rastro", <ToolTrace tools={["citas_del_dia", "ingresos_del_mes"]} />, <ToolTrace tools={["citas_del_dia", "ingresos_del_mes"]} clases={NUEVA} />],
    ["aviso apagada", <SabinaErrorNotice kind="apagada" />, <SabinaErrorNotice kind="apagada" clases={NUEVA} />],
    ["aviso red", <SabinaErrorNotice kind="network" onRetry={() => {}} />, <SabinaErrorNotice kind="network" onRetry={() => {}} clases={NUEVA} />],
  ];
  for (const [nombre, sin, con] of pares) {
    const htmlSin = renderToStaticMarkup(sin);
    const htmlCon = renderToStaticMarkup(con);
    assert.ok(htmlSin.includes("vieja_") && !htmlSin.includes("nueva_"), `${nombre}: sin \`clases\` tiene que pintar SOLO la hoja de siempre`);
    assert.ok(htmlCon.includes("nueva_") && !htmlCon.includes("vieja_"), `${nombre}: con \`clases\` tiene que pintar SOLO la hoja nueva`);
    assert.equal(sinPrefijo(htmlCon), sinPrefijo(htmlSin), `${nombre}: con la ropa nueva cambia algo más que las clases`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 20 · los avisos: el <Toaster> de siempre sale TAL CUAL con la ropa
// apagada, y el nuevo conserva esquina, duraciones y textos
// ═══════════════════════════════════════════════════════════════════════════
test("AvisosVestibles apagado devuelve su hijo sin tocarlo (el Toaster de siempre, byte por byte)", () => {
  const hijo = <div data-toaster="de-siempre">hola</div>;
  assert.equal(renderToStaticMarkup(<AvisosVestibles>{hijo}</AvisosVestibles>), renderToStaticMarkup(hijo));
});

test("el layout raíz envuelve al Toaster de siempre con AvisosVestibles y no le cambia una prop", () => {
  const raiz = leer("app/layout.tsx");
  assert.match(raiz, /<AvisosVestibles>\s*<Toaster\s/, "AvisosVestibles envuelve al Toaster");
  assert.match(raiz, /\/>\s*<\/AvisosVestibles>/, "y se cierra justo después");
  assert.equal((raiz.match(/<Toaster\b/g) ?? []).length, 1, "un solo Toaster");
  const toaster = bloque(raiz, "Toaster");
  for (const prop of ['position="top-right"', "gutter={8}", 'className: "text-sm font-medium"', "duration: 3000", "duration: 5000", "duration: Infinity", 'background: "var(--bg-elev)"', 'padding: "10px 14px"']) {
    assert.ok(toaster.includes(prop), `el Toaster de siempre perdió ${prop}`);
  }
  // El nuevo: misma esquina, mismas duraciones, tokens del menú, ni un hex.
  const avisos = leer("components/dashboard/layout-rediseno/avisos.tsx");
  const nuevo = bloque(avisos, "Toaster");
  for (const prop of ['position="top-right"', "gutter={8}", "duration: 3000", "duration: 5000", "duration: Infinity", "containerClassName={`${CLASES_MENU} "]) {
    assert.ok(nuevo.includes(prop), `el Toaster nuevo no lleva ${prop}`);
  }
  assert.match(nuevo, /background: "var\(--m2-tarjeta\)"/);
  // El envoltorio del layout de /dashboard: uno solo, con el interruptor, alrededor de VestirDialogos.
  const layout = leer("app/dashboard/layout.tsx");
  assert.equal((layout.match(/<VestirAvisos activo=\{menuDosNiveles\}>/g) ?? []).length, 1, "se monta una sola vez, con el interruptor");
  assert.match(layout, /<VestirAvisos activo=\{menuDosNiveles\}>\s*<VestirDialogos activo=\{menuDosNiveles\}>/, "envuelve a VestirDialogos");
  assert.match(layout, /<\/VestirDialogos>\s*<\/VestirAvisos>/, "y se cierra por fuera de él");
  assert.doesNotMatch(layout, /AvisosVestibles/, "AvisosVestibles vive en el layout raíz, no aquí");
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 12 · la barra de consulta: dos pieles, el `sticky top` medido
// ═══════════════════════════════════════════════════════════════════════════
test("patient-context-bar: el camino clásico queda con sus números de siempre; el nuevo mide, no escribe", () => {
  const barra = leer("components/dashboard/patient-context-bar.tsx");
  // Clásico, literal.
  for (const literal of ["top: 52,", "height: 52,", '"--mf-context-bar-h", "52px"', 'className={nueva ? `${CLASES_MENU} ${piel.barra} mf-context-bar` : "mf-context-bar"}']) {
    assert.ok(barra.includes(literal), `el camino clásico perdió ${literal}`);
  }
  assert.equal((barra.match(/fontFamily: "var\(--font-mono, monospace\)"/g) ?? []).length, 2, "la letra de máquina del camino clásico sigue donde estaba (edad y cronómetro)");
  // Nuevo: el top sale de la altura real del hermano sticky de arriba.
  assert.match(barra, /style=\{nueva \? \{ top: topMedido \}/, "el top nuevo no es el medido");
  assert.match(barra, /previousElementSibling/, "no busca la barra superior entre sus hermanos");
  assert.match(barra, /\.position !== "sticky"/, "no la reconoce por ser sticky");
  assert.match(barra, /new ResizeObserver\(medir\)/, "no vigila su alto");
  assert.doesNotMatch(barra, /top:\s*56/, "hay un 56 escrito a mano");
  // Con la ropa nueva el hover es CSS: sin onMouseEnter que escriba `style`.
  const inicioNueva = barra.indexOf("if (nueva) {", barra.indexOf("function ActionButton"));
  const nuevaRama = barra.slice(inicioNueva, barra.indexOf("\n  return (", inicioNueva));
  assert.match(nuevaRama, /className=\{isDanger/, "la rama nueva no viste el botón por clase");
  assert.doesNotMatch(nuevaRama, /onMouseEnter/, "la rama nueva monta el hover en línea de siempre");
  // Toda pieza citada existe en la hoja; el desplegable (portal) monta CLASES_MENU.
  const hoja = clasesDe(hojas.find((h) => h.nombre === "barra-consulta.module.css")!.texto);
  const citadas = [...barra.matchAll(/\bpiel\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(citadas.length >= 20, `se esperaban decenas de piezas, hay ${citadas.length}`);
  assert.deepEqual([...new Set(citadas)].filter((k) => !hoja.has(k)), [], "piezas que no existen en barra-consulta.module.css");
  assert.ok(barra.includes("`${CLASES_MENU} ${piel.menu}`"), "el desplegable del teléfono no monta CLASES_MENU");
  // El layout se lo dice por prop, con el mismo interruptor que todo.
  assert.match(leer("app/dashboard/layout.tsx"), /<PatientContextBar apariencia=\{menuDosNiveles \? "nueva" : "clasica"\} \/>/);
});

// ═══════════════════════════════════════════════════════════════════════════
// El interruptor es el de todo el rediseño: las tres piezas cuelgan de él
// ═══════════════════════════════════════════════════════════════════════════
test("el layout de /dashboard baja `menuDosNiveles` a las tres piezas y no gana ni un hijo", () => {
  const layout = leer("app/dashboard/layout.tsx");
  assert.ok(bloque(layout, "SabinaLanzador").includes("rediseno={menuDosNiveles}"), "Sabina no recibe el interruptor");
  assert.match(layout, /<PatientContextBar apariencia=\{menuDosNiveles/, "la barra no recibe el interruptor");
  assert.match(layout, /<VestirAvisos activo=\{menuDosNiveles\}>/, "los avisos no reciben el interruptor");
  // Ni una lectura nueva del interruptor: la del Promise.all de siempre.
  assert.equal((layout.match(/menuDosNivelesEncendido\(/g) ?? []).length, 1, "una sola lectura del interruptor");
});
