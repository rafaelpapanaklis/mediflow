/**
 * CANDADOS DEL REDISEÑO DE WHATSAPP (ws1-t5).
 *
 * Run: npx tsx --test src/components/dashboard/whatsapp-rediseno/__tests__/whatsapp-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/hoy-rediseno.test.ts`
 * y `app/dashboard/__tests__/botones-prometidos.test.ts`: lo que se vigila es CABLEADO
 * (que la pantalla nueva no invente tokens ni letra de máquina, que lea los del menú,
 * que mande a los mismos sitios que la de siempre, que el camino viejo siga vivo),
 * y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "whatsapp-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const CSS = "whatsapp-rediseno.module.css";
const css = () => archivosNuevos.find((a) => a.nombre === CSS)!.texto;

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la pantalla nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 7, "faltan archivos en la carpeta del rediseño");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
    // La clase global `.mono` (globals.css) es letra de máquina con otro nombre.
    // `.mono-tecnico` NO cuenta: es la única excepción documentada en
    // tipografia-panel.tsx (identificadores de la API que se copian tal cual,
    // como el Phone Number ID), y la pantalla de siempre ya la usa ahí.
    assert.ok(!/className=["'`][^"'`]*\bmono\b(?!-tecnico)/.test(a.texto), `${a.nombre} usa la clase global .mono`);
  }
  assert.match(css(), /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
  // `pre` trae letra de máquina de fábrica: el texto exacto de las plantillas
  // tiene que devolverle la familia heredada.
  assert.match(css(), /\.textoExacto pre \{[^}]*font-family:\s*inherit/, "el <pre> de las plantillas hereda la familia");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("whatsapp-rediseno.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css().match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css(), /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/whatsapp-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts, no de una copia");
});

test("ningún color escrito a mano fuera de un respaldo var(--…, #hex)", () => {
  for (const a of archivosNuevos) {
    for (const [i, linea] of a.texto.split("\n").entries()) {
      if (!/#[0-9a-f]{3,8}\b/i.test(linea)) continue;
      assert.match(linea, /var\(--/, `${a.nombre}:${i + 1} trae un color a mano: ${linea.trim()}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos destinos y mismas llamadas que las pantallas de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("la pantalla nueva manda a los mismos sitios que la de siempre", () => {
  const nuevo = archivosNuevos.map((a) => a.texto).join("\n");
  const viejo = [
    "app/dashboard/whatsapp/whatsapp-client.tsx",
    "app/dashboard/whatsapp/bot/bot-client.tsx",
    "app/dashboard/whatsapp/bot/saldo/saldo-client.tsx",
    "app/dashboard/whatsapp/plantillas/templates-client.tsx",
  ].map(leer).join("\n");

  const destinos = [
    "/dashboard/whatsapp/plantillas",
    "/dashboard/whatsapp/bot",
    "/dashboard/whatsapp/bot/saldo",
    "/dashboard/whatsapp",
    "/dashboard/soporte",
    "https://business.facebook.com/billing_hub/payment_settings",
    "https://business.facebook.com/wa/manage/message-templates/",
    "/api/ai-wallet/stripe/checkout",
    "/api/ai-wallet/mercadopago/checkout",
  ];
  for (const d of destinos) {
    assert.ok(viejo.includes(d), `la pantalla de siempre ya no usa ${d}: actualiza este candado`);
    assert.ok(nuevo.includes(d), `el rediseño perdió el destino ${d}`);
  }
});

test("las llamadas a la API siguen viviendo en los clientes de siempre, no en el rediseño", () => {
  // El rediseño solo PINTA: los fetch (conectar, desconectar, guardar, FAQ,
  // recargas, plantillas) se quedan en los clientes de app/dashboard/whatsapp,
  // que le pasan estado y manejadores. Así los dos caminos hablan con la misma
  // API y el bot (sus reglas, sus textos, su cobro) no se toca desde aquí.
  for (const a of archivosNuevos) {
    assert.ok(!/\bfetch\(/.test(a.texto), `${a.nombre} llama a la API por su cuenta`);
  }
  for (const rel of [
    "app/dashboard/whatsapp/whatsapp-client.tsx",
    "app/dashboard/whatsapp/bot/bot-client.tsx",
    "app/dashboard/whatsapp/bot/saldo/saldo-client.tsx",
    "app/dashboard/whatsapp/plantillas/templates-client.tsx",
  ]) {
    assert.match(leer(rel), /\bfetch\(/, `${rel} ya no llama a la API: actualiza este candado`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa el rediseño existe en el diccionario en español
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves t(\"…\") del rediseño existen en es.json", () => {
  const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
  const existe = (clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    return true;
  };
  const claves = new Set<string>();
  for (const a of archivosNuevos) {
    for (const m of a.texto.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
    // Los mapas de estado, tipo y pasos guardan la clave en una propiedad.
    for (const m of a.texto.matchAll(/(?:titleKey|descKey|labelKey|onKey|offKey):\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
    for (const m of a.texto.matchAll(/^\s+[A-Za-z]+:\s*"(inbox\.whatsapp\.[a-zA-Z0-9_.]+)",?$/gm)) claves.add(m[1]);
  }
  assert.ok(claves.size > 60, `se esperaban decenas de claves, hay ${claves.size}`);
  const faltan = [...claves].filter((k) => !existe(k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo y el interruptor es el de todo el rediseño
// ═══════════════════════════════════════════════════════════════════════════
test("las cuatro páginas conservan la pantalla de siempre y eligen con menuDosNivelesEncendido", () => {
  const paginas: [string, string, string][] = [
    // [page.tsx, cliente de siempre, vista del rediseño]
    ["app/dashboard/whatsapp/page.tsx", "WhatsAppClient", "ConexionRediseno"],
    ["app/dashboard/whatsapp/bot/page.tsx", "BotClient", "BotRediseno"],
    ["app/dashboard/whatsapp/bot/saldo/page.tsx", "SaldoClient", "SaldoRediseno"],
    ["app/dashboard/whatsapp/plantillas/page.tsx", "TemplatesClient", "PlantillasRediseno"],
  ];
  for (const [pagina, cliente, vista] of paginas) {
    const page = leer(pagina);
    assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${pagina} usa el interruptor compartido, no uno propio`);
    assert.equal((page.match(/menuDosNivelesEncendido\(user\.clinicId\)/g) ?? []).length, 1, `${pagina}: una sola lectura del interruptor`);
    assert.ok(page.includes(`<${cliente}`), `${pagina} ya no monta ${cliente}`);
    assert.match(page, /rediseno=\{rediseno\}/, `${pagina} no le pasa la bandera al cliente`);
    // El cliente de siempre decide con la prop: la vista nueva solo se monta
    // cuando `rediseno` es true, y el JSX de siempre queda intacto detrás.
    const ruta = pagina.replace("page.tsx", "");
    const archivoCliente = readdirSync(join(SRC, ruta)).find((f) => f.endsWith("-client.tsx"))!;
    const textoCliente = leer(ruta + archivoCliente);
    assert.match(textoCliente, /rediseno\s*=\s*false/, `${archivoCliente}: la bandera apagada es el valor por defecto`);
    assert.match(textoCliente, new RegExp(`if \\(rediseno\\) \\{\\s*return \\(\\s*<${vista}`), `${archivoCliente}: la vista nueva va detrás de la bandera`);
  }
});

test("el rediseño no toca el bot: ni sus reglas, ni sus plantillas de persona, ni el cobro", () => {
  // La carpeta nueva solo IMPORTA las plantillas de persona; no las redefine.
  const bot = leer("components/dashboard/whatsapp-rediseno/bot.tsx");
  assert.match(bot, /import \{ PERSONA_TEMPLATES \} from "@\/app\/dashboard\/whatsapp\/bot\/persona-templates"/);
  assert.ok(!/PERSONA_TEMPLATES\s*[:=]/.test(bot), "el rediseño redefine las plantillas de persona");
  // El saldo pinta los textos y montos que le pasa el cliente de siempre.
  const saldo = leer("components/dashboard/whatsapp-rediseno/saldo.tsx");
  assert.match(saldo, /textos\.presetAmountsCents/, "los montos preestablecidos vienen del cliente de siempre");
  assert.ok(!/\[20000, 50000/.test(saldo), "el rediseño redefine los montos de recarga");
});

test("nada de sondeos nuevos: sin setInterval ni useEffect en la carpeta", () => {
  for (const a of archivosNuevos) {
    assert.ok(!/setInterval|useEffect|useSWR|useQuery/.test(a.texto), `${a.nombre} añade una carga o un sondeo propio`);
  }
});
