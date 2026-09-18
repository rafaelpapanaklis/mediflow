/**
 * CANDADOS DEL REDISEÑO DE «CONFIGURACIÓN» (ws1-t2).
 *
 * Run: npx tsx --test src/components/dashboard/configuracion-rediseno/__tests__/configuracion-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO —que la carpeta nueva no invente tokens ni letra de
 * máquina, que lea los del menú, que las trece pantallas de settings sigan
 * teniendo vivo el camino de siempre y elijan con el MISMO interruptor—, y
 * eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "configuracion-rediseno");
const SETTINGS = join(SRC, "app", "dashboard", "settings");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = archivosNuevos.find((a) => a.nombre === "configuracion.module.css")!.texto;

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 3, "faltan archivos en la carpeta del rediseño");
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
test("configuracion.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
});

test("todo hex de la hoja es un respaldo DENTRO de un var(), nunca un color suelto", () => {
  // `color: var(--danger, #dc2626)` vale (el menú no tiene semánticos);
  // un color escrito a mano, sin var(), no. Se mira línea por línea, como el gerente.
  const sueltos = css
    .split("\n")
    .filter((l) => /#[0-9a-f]{6}\b/i.test(l) && !/var\(--/.test(l));
  assert.deepEqual(sueltos, [], `colores a mano: ${sueltos.join(" | ")}`);
});

test("la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts) y no una copia", () => {
  const raiz = leer("components/dashboard/configuracion-rediseno/raiz.tsx");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "importa clases.ts del menú");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU");
  // Los tokens del menú apagan tabular-nums; la raíz lo vuelve a encender en
  // un nodo HIJO (si fuera el mismo nodo, perdería por especificidad).
  assert.match(raiz, /className=\{CLASES_MENU\}>\s*<div className=\{\[s\.raiz/, "CLASES_MENU envuelve a .raiz, no comparten nodo");
  assert.match(css, /\.raiz\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s, ".raiz enciende tabular-nums");
});

test("la carpeta nueva no importa librerías de UI ni toca clases.ts", () => {
  for (const a of archivosNuevos) {
    assert.ok(!/@radix-ui|@headlessui|@mui|antd|chakra/.test(a.texto), `${a.nombre} mete una librería de UI`);
  }
  const clases = leer("components/dashboard/menu-dos-niveles/clases.ts");
  assert.match(clases, /export const CLASES_MENU = \[s\.tokens, instrumentSans\.variable, materialSymbols\.variable\]\.join\(" "\);/, "clases.ts es compartido: no se toca");
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo y el interruptor es el de todo el rediseño
// ═══════════════════════════════════════════════════════════════════════════
const PAGINAS = [
  "page.tsx",
  "signature/page.tsx",
  "integrations/page.tsx",
  "sucursales/page.tsx",
  "arco-requests/page.tsx",
];

test("las cinco páginas eligen con menuDosNivelesEncendido, dentro de su Promise.all, y bajan la bandera", () => {
  for (const rel of PAGINAS) {
    const page = readFileSync(join(SETTINGS, rel), "utf8");
    assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${rel}: usa el interruptor compartido, no uno propio`);
    assert.equal((page.match(/menuDosNivelesEncendido\(user\.clinicId\)/g) ?? []).length, 1, `${rel}: una sola lectura, con el clinicId de la sesión`);
    assert.match(page, /Promise\.all\(\[[\s\S]*menuDosNivelesEncendido\(user\.clinicId\),?[\s\S]*\]\)/, `${rel}: la lectura va en el Promise.all, no en cascada`);
    assert.match(page, /rediseno=\{rediseno\}/, `${rel}: no baja la bandera al cliente`);
    // Ni polling ni intervalos nuevos.
    assert.ok(!/setInterval/.test(page), `${rel}: setInterval nuevo`);
  }
});

const CLIENTES: Array<[string, RegExp]> = [
  // [archivo, un trozo del camino VIEJO que tiene que seguir ahí, tal cual]
  ["settings-client.tsx", /className=\{`vnav-item \$\{tab === item\.id \? "vnav-item--active" : ""\}`\}/],
  ["reminders-section.tsx", /<div className="card max-w-lg space-y-4" style=\{\{ padding: 24 \}\}>/],
  ["recall-section.tsx", /<div className="card max-w-lg space-y-4" style=\{\{ padding: 24 \}\}>/],
  ["signature/signature-client.tsx", /<form onSubmit=\{submit\} style=\{\{ background: "var\(--bg-elev, #fff\)"/],
  ["integrations/integrations-client.tsx", /<div className=\{styles\.page\}>/],
  ["sucursales/sucursales-client.tsx", /<div style=\{\{ maxWidth: 760, margin: "0 auto", padding: "0 4px" \}\}>/],
  ["arco-requests/arco-requests-client.tsx", /<table className="table-new">/],
];

test("cada cliente conserva su camino de siempre y solo entra al rediseño con la bandera", () => {
  for (const [rel, viejo] of CLIENTES) {
    const src = readFileSync(join(SETTINGS, rel), "utf8");
    assert.match(src, viejo, `${rel}: el camino viejo ya no está`);
    assert.match(src, /rediseno = false/, `${rel}: la bandera no cae en false por defecto`);
    assert.match(src, /if \(rediseno\) \{/, `${rel}: el rediseño no está detrás de la bandera`);
    assert.ok(!/setInterval/.test(src), `${rel}: setInterval nuevo`);
  }
});

test("el rediseño de settings-client baja la bandera a Recordatorios y Reactivación", () => {
  const src = readFileSync(join(SETTINGS, "settings-client.tsx"), "utf8");
  assert.match(src, /<RemindersSection clinic=\{clinic\} rediseno \/>/, "Recordatorios sin bandera");
  const rem = readFileSync(join(SETTINGS, "reminders-section.tsx"), "utf8");
  assert.match(rem, /<RecallSection clinic=\{clinic\} rediseno \/>/, "Reactivación sin bandera");
  // Y el camino viejo los monta SIN bandera, igual que hoy.
  assert.match(src, /<RemindersSection clinic=\{clinic\} \/>/, "el camino viejo cambió cómo monta Recordatorios");
  assert.match(rem, /<RecallSection clinic=\{clinic\} \/>/, "el camino viejo cambió cómo monta Reactivación");
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos apartados, mismos destinos: el rediseño no inventa ni esconde nada
// ═══════════════════════════════════════════════════════════════════════════
test("los diez apartados de Configuración son los de siempre y salen de la MISMA lista TABS", () => {
  const src = readFileSync(join(SETTINGS, "settings-client.tsx"), "utf8");
  const ids = [...src.matchAll(/\{ id:"([a-z]+)",\s*label:t\("settings\.client\.tab/g)].map((m) => m[1]);
  assert.deepEqual(ids, [
    "clinica", "subscription", "servicios", "perfil", "facturacion", "ia", "integraciones", "recordatorios", "horarios", "seguridad",
  ]);
  assert.match(src, /const navItems = TABS\.map\(/, "el rediseño no lee TABS: podría inventar o perder apartados");
  // Cada apartado se pinta en los dos caminos.
  for (const id of ids) {
    assert.equal((src.match(new RegExp(`tab === "${id}"`, "g")) ?? []).length, 2, `el apartado «${id}» no está en los dos caminos`);
  }
});

test("el rediseño manda a los mismos sitios y pega a las mismas APIs que la pantalla de siempre", () => {
  const src = readFileSync(join(SETTINGS, "settings-client.tsx"), "utf8");
  const nuevo = src.slice(src.indexOf("if (rediseno) {"), src.indexOf("return (\n    <div style={{ padding: \"clamp(14px, 1.6vw, 28px)\", maxWidth: 1400"));
  const viejo = src.slice(src.indexOf("return (\n    <div style={{ padding: \"clamp(14px, 1.6vw, 28px)\", maxWidth: 1400"));
  assert.ok(nuevo.length > 1000 && viejo.length > 1000, "no se encontraron los dos caminos");
  for (const destino of ["/afiliados", "/afiliados/registro", "https://www.facturapi.io", "/api/google", "/dashboard/whatsapp"]) {
    assert.ok(viejo.includes(`"${destino}"`), `la pantalla de siempre ya no usa ${destino}: actualiza este candado`);
    assert.ok(nuevo.includes(`"${destino}"`), `el rediseño perdió el destino ${destino}`);
  }
  // Las mismas funciones de guardado, sin una nueva: todo lo que se guarda
  // pasa por las que ya existían.
  for (const fn of ["saveClinic", "saveSchedule", "saveLocale", "saveAutomation", "savePortalAutoApprove", "savePortalMinHours", "saveUser", "saveCfdi", "uploadCsd", "changePassword", "disconnectGcal", "addServiceToMember", "removeServiceFromMember", "uploadLogo", "removeLogo"]) {
    assert.ok(nuevo.includes(fn), `el rediseño no llama a ${fn}`);
  }
  // Ni un fetch nuevo dentro del rediseño: el motor no se toca.
  assert.ok(!/fetch\(/.test(nuevo), "el rediseño hace un fetch propio");
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa el rediseño existe en los dos diccionarios
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves t(\"…\") de los archivos tocados existen en es.json y en en.json", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
  const en = JSON.parse(leer("i18n/dictionaries/en.json")) as Record<string, unknown>;
  const existe = (dict: Record<string, unknown>, clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    // Una clave con plural es un objeto {one, other}, no una cadena.
    if (nodo && typeof nodo === "object") {
      const formas = nodo as Record<string, unknown>;
      return typeof formas.one === "string" && typeof formas.other === "string";
    }
    return typeof nodo === "string";
  };
  const claves = new Set<string>();
  for (const [rel] of CLIENTES) {
    const src = readFileSync(join(SETTINGS, rel), "utf8");
    for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  assert.ok(claves.size > 80, `se esperaban muchas claves, hay ${claves.size}`);
  const faltan = [...claves].filter((k) => !existe(es, k) || !existe(en, k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1024 px (ws1-t1): la navegación se decide por el HUECO, no por la ventana
// ═══════════════════════════════════════════════════════════════════════════
// Con el menú lateral abierto, a 1024 px de ventana quedan 732 px útiles: la
// fila se envolvía, pero la navegación seguía siendo una columna de 224 px con
// un hueco en blanco al lado, porque su paso a fila colgaba de un `@media` de
// 768 px de VENTANA. Estos candados impiden volver ahí.
test("la navegación pasa a fila midiendo su contenedor, nunca con un @media de ventana", () => {
  assert.match(css, /\.navCaja\s*\{[^}]*container-type:\s*inline-size/, ".navCaja es el contenedor que se mide");
  assert.match(css, /@container\s+navconfig\s*\(min-width:/, "el paso a fila es un @container sobre navconfig");
  const piezas = archivosNuevos.find((a) => a.nombre === "piezas.tsx")!.texto;
  assert.match(piezas, /className=\{s\.navCaja\}/, "Navegacion monta la caja que se mide");
  // Fuera del respaldo para navegadores sin @container, ningún @media de ancho toca .nav.
  const sinRespaldo = css.replace(/@supports not \(container-type: inline-size\) \{[\s\S]*?\n\}\n/, "");
  const mediaDeAncho = [...sinRespaldo.matchAll(/@media\s*\((?:max|min)-width:[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  for (const bloque of mediaDeAncho) {
    assert.ok(!/\.nav(Item|Caja)?\s*\{/.test(bloque), "un @media de ancho de VENTANA vuelve a decidir la navegación");
  }
});

test("el corte de la caja coincide con el punto en que la fila deja de caber (224 + 20 + 520)", () => {
  const nav = Number(/\.navCaja\s*\{[^}]*min-width:\s*(\d+)px/.exec(css)?.[1]);
  const corte = Number(/\.navCaja\s*\{[^}]*flex:\s*0 1 calc\(\((\d+)px - 100%\)/.exec(css)?.[1]);
  const gap = Number(/\.cuerpo\s*\{[^}]*gap:\s*(\d+)px/.exec(css)?.[1]);
  const contenido = Number(/\.contenido\s*\{[^}]*flex:\s*1 1 (\d+)px/.exec(css)?.[1]);
  assert.equal(corte, nav + gap + contenido, "si cambias un ancho, cambia el corte: si no, vuelve el hueco en blanco");
});

test("ni .raiz ni .cuerpo ni .contenido son contenedores: Suscripción abre ventanas position:fixed sin portal", () => {
  for (const clase of ["raiz", "cuerpo", "contenido"]) {
    const regla = new RegExp(`\\.${clase}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    assert.ok(!/container-type|contain\s*:/.test(regla), `.${clase} no puede contener layout: rompería los position:fixed de dentro`);
  }
});

test("la tabla ARCO no exige ancho fijo: la razón y el correo se envuelven", () => {
  const recorte = /\.tablaRecorte\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(!/white-space:\s*nowrap/.test(recorte), "con nowrap la tabla desborda y «Gestionar» queda detrás de un scroll lateral");
  assert.match(recorte, /line-clamp:\s*2/);
  assert.match(css, /\.tabla \.tablaCorreo\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
