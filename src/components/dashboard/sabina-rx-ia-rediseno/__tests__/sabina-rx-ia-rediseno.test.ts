/**
 * CANDADOS DEL REDISEÑO DEL LOTE «Sabina · Radiografías · Asistente IA» (ws1-t8).
 *
 * Run: npx tsx --test src/components/dashboard/sabina-rx-ia-rediseno/__tests__/sabina-rx-ia-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts` y
 * `app/dashboard/__tests__/botones-prometidos.test.ts`: lo que se vigila es
 * CABLEADO, y eso se ve en el archivo:
 *  - la hoja del rediseño no inventa tokens: solo lee los del menú (`--m2-*`)
 *    y los semánticos de globals; ni un hex fuera de un respaldo `var()`;
 *  - ni una letra de máquina: las cifras van con tabular-nums sobre
 *    Instrument Sans;
 *  - la raíz monta CLASES_MENU;
 *  - las tres pantallas siguen con su módulo de siempre y eligen la piel con
 *    `rediseno` (el interruptor compartido, leído en su page.tsx), y NINGUNA
 *    clase que usan se queda sin traducir al rediseño;
 *  - los destinos (rutas y endpoints) son los de siempre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "sabina-rx-ia-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

/** Los nombres de clase que declara un módulo CSS (`.nombre`). */
const clasesDe = (cssTexto: string) =>
  new Set([...cssTexto.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));

const css = archivosNuevos.find((a) => a.nombre === "rediseno.module.css")!.texto;
const clasesCss = clasesDe(css);

/** Las cinco pantallas cliente del lote y su módulo de siempre. */
const CLIENTES = [
  { rel: "app/dashboard/sabina/sabina-client.tsx", modulo: "./sabina.module.css" },
  { rel: "app/dashboard/sabina/propuesta-card.tsx", modulo: "./propuesta.module.css" },
  { rel: "app/dashboard/xrays/patients-list-client.tsx", modulo: "./patients-list.module.css" },
  { rel: "app/dashboard/xrays/xrays-client.tsx", modulo: "./xrays.module.css" },
  { rel: "app/dashboard/ai-assistant/ai-assistant-client.tsx", modulo: "./ai-assistant.module.css" },
];


/** Las cuatro páginas de servidor que leen el interruptor. */
const PAGINAS = [
  "app/dashboard/sabina/page.tsx",
  "app/dashboard/xrays/page.tsx",
  "app/dashboard/xrays/[patientId]/page.tsx",
  "app/dashboard/ai-assistant/page.tsx",
];

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("rediseno.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/sabina-rx-ia-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts, no de una copia");
});

test("ni un color a mano: todo hex de la hoja es el respaldo de un var()", () => {
  const sueltos = css
    .split("\n")
    .filter((linea) => /#[0-9a-f]{3,8}\b/i.test(linea) && !/var\(--[a-z0-9-]+,\s*#[0-9a-f]{3,8}\)/i.test(linea));
  assert.deepEqual(sueltos, [], `colores copiados a mano:\n${sueltos.join("\n")}`);
  // Y los respaldos solo para lo que el menú NO tiene: los semánticos.
  const respaldos = [...css.matchAll(/var\(--([a-z0-9-]+),\s*#[0-9a-f]{3,8}\)/gi)].map((m) => m[1]);
  const noSemanticos = respaldos.filter((r) => !/^(success|warning|danger|info)(-[a-z-]+)?$/.test(r));
  assert.deepEqual(noSemanticos, [], `respaldo con hex para un token que el menú sí tiene: ${noSemanticos.join(", ")}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Dos pieles, un esqueleto: cada pantalla conserva su módulo y elige con
// `rediseno`; ninguna clase usada se queda sin traducir; toda pieza citada
// existe en la hoja.
// ═══════════════════════════════════════════════════════════════════════════
for (const { rel, modulo } of CLIENTES) {
  test(`${rel}: el camino viejo sigue vivo y el rediseño traduce TODAS sus clases`, () => {
    const texto = leer(rel);
    assert.ok(texto.includes(`import styles from "${modulo}"`), "perdió su módulo de siempre");
    assert.match(texto, /rediseno \? CLASES_REDISENO : styles/, "no elige la piel con `rediseno`");
    assert.ok(!/\bstyles\.[a-zA-Z]/.test(texto), "hay una clase que no pasa por `c` (se mezclarían las dos pieles)");

    // El mapa de traducción.
    const inicio = texto.indexOf("const CLASES_REDISENO: Record<string, string> = {");
    assert.ok(inicio !== -1, "falta el mapa CLASES_REDISENO");
    const fin = texto.indexOf("\n};", inicio);
    const mapa = texto.slice(inicio, fin);
    const traducidas = new Set([...mapa.matchAll(/^\s+([a-zA-Z0-9_]+):/gm)].map((m) => m[1]));

    // Toda clase del módulo de siempre que la pantalla usa (`c.xxx`) tiene
    // traducción. Se cruza con las clases del módulo viejo porque `c` también
    // es el nombre de alguna variable de datos (`(c) => c.id`).
    const viejas = clasesDe(leer(join(rel, "..", modulo)));
    const usadas = new Set(
      [...texto.matchAll(/\bc\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]).filter((k) => viejas.has(k)),
    );
    assert.ok(usadas.size >= 20, `se esperaban decenas de clases, hay ${usadas.size}`);
    const sinTraducir = [...usadas].filter((k) => !traducidas.has(k));
    assert.deepEqual(sinTraducir, [], `clases sin traducir al rediseño: ${sinTraducir.join(", ")}`);
    // Y ninguna traducción apunta a una clase que el módulo viejo no tiene
    // (sería un renombre a ciegas).
    const sobrantes = [...traducidas].filter((k) => !viejas.has(k));
    assert.deepEqual(sobrantes, [], `traduce clases que el módulo viejo no tiene: ${sobrantes.join(", ")}`);

    // Toda pieza citada (`piel.xxx`) existe en la hoja del rediseño.
    const piezas = new Set([...texto.matchAll(/\bpiel\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
    assert.ok(piezas.size > 0, "no cita ninguna pieza del rediseño");
    const inexistentes = [...piezas].filter((k) => !clasesCss.has(k));
    assert.deepEqual(inexistentes, [], `piezas que no existen en rediseno.module.css: ${inexistentes.join(", ")}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// El interruptor es el de todo el rediseño y se lee en el servidor
// ═══════════════════════════════════════════════════════════════════════════
test("las cuatro páginas leen menuDosNivelesEncendido y bajan `rediseno` al cliente", () => {
  for (const rel of PAGINAS) {
    const page = leer(rel);
    assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${rel}: usa el interruptor compartido, no uno propio`);
    assert.match(page, /menuDosNivelesEncendido\(/, `${rel}: no consulta el interruptor`);
    assert.match(page, /rediseno=\{rediseno\}/, `${rel}: no baja la bandera al cliente`);
  }
});

test("con la bandera apagada, ningún cliente monta la raíz del rediseño", () => {
  for (const { rel } of CLIENTES) {
    const texto = leer(rel);
    for (const m of texto.matchAll(/CLASES_REDISENO_LOTE/g)) {
      if (texto.slice(m.index! - 60, m.index!).includes("import")) continue;
      // Cada montaje de la raíz va detrás de `rediseno ?`.
      const antes = texto.slice(Math.max(0, m.index! - 40), m.index!);
      assert.match(antes, /rediseno \? `\$\{$/, `${rel}: la raíz se monta sin mirar la bandera`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos destinos que las pantallas de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("los destinos y endpoints son los de siempre", () => {
  const destinos: Record<string, string[]> = {
    "app/dashboard/sabina/sabina-client.tsx": [
      "/api/sabina/conversations",
      "/api/sabina/propuestas/${encodeURIComponent(id)}",
      "fetch(\"/api/sabina\"",
    ],
    "app/dashboard/xrays/patients-list-client.tsx": ["/dashboard/xrays/${p.id}"],
    "app/dashboard/xrays/xrays-client.tsx": [
      "href=\"/dashboard/xrays\"",
      "/api/xrays/${activeFileId}/annotations",
      "fetch(\"/api/xrays\"",
      "/analyze?mode=",
    ],
    "app/dashboard/ai-assistant/ai-assistant-client.tsx": [
      "/api/ai-assistant/conversations",
      "fetch(\"/api/ai\"",
      "/api/ai/usage",
      "/api/ai/transcribe",
    ],
  };
  for (const [rel, lista] of Object.entries(destinos)) {
    const texto = leer(rel);
    for (const d of lista) assert.ok(texto.includes(d), `${rel} perdió ${d}`);
  }
});
