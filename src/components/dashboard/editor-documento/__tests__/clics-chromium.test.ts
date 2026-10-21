/**
 * ws1-t10 · P1/P3/P6 — el editor de documentos con clics y teclas DE VERDAD en
 * Chromium (Playwright: ratón y teclado, nada de dispatchEvent salvo donde el
 * navegador sin ventana no deja otra —el portapapeles—, y se dice).
 *
 * Run: npm run test:editor-documento-clics
 *   (Playwright no es dependencia del repo: se busca en NAVEGADOR_DIR o
 *   ~/navegador. Sin él, la prueba se SALTA diciéndolo. Con EDITOR_CAPTURAS=<dir>
 *   deja capturas a 1440 y 390 px, claro y oscuro.)
 *
 * El componente real (EditorDocumento y el modal de Plantillas) se empaqueta con
 * esbuild —CSS Modules incluidos— y se monta en una página vacía. Las llamadas
 * del modal a /api/document-templates se interceptan: NADA sale del navegador y
 * nada se guarda en ninguna base.
 *
 * Lo que fija: una plantilla vieja abre idéntica; escribir, negrita, tabla (con
 * su barra y Tab entre celdas), columnas, salto de página (Ctrl Enter, y la hoja
 * 2 con su membrete), marcador por teclado y por menú, pegar de Word, Tab y
 * Shift+Tab, imagen por archivo (tope y tipo), 390 px sin scroll horizontal,
 * modo oscuro, 0 errores de consola; y en el modal: `body` + `baseBody` solo si
 * cambió, nombre vacío y cuerpo vacío no mandan nada.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const ORIGEN = "https://editor.prueba";
const CAPTURAS = process.env.EDITOR_CAPTURAS ?? "";

/* ---------------- el componente real, empaquetado para Chromium ---------------- */

const AQUI = join(RAIZ, "src/components/dashboard/editor-documento");
const DOBLES: Record<string, string> = {
  "next/font/local": `export default () => ({ className: "", variable: "", style: {} });`,
  // Los textos de verdad: el diccionario en español, con sus {variables}.
  "@/i18n/i18n-provider": `
    import es from ${JSON.stringify(join(RAIZ, "src/i18n/dictionaries/es.json"))};
    const busca = (k) => k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), es);
    export const useT = () => (k, vars) => { let v = busca(k); if (typeof v !== "string") return k;
      for (const [a, b] of Object.entries(vars ?? {})) v = v.split("{" + a + "}").join(String(b)); return v; };
    export const useLocale = () => "es";`,
  "@/components/ui/confirm-dialog": `export const useConfirm = () => async () => true;`,
  // El modal importa la puerta con next/dynamic; aquí el componente va directo.
  "@/components/dashboard/editor-documento": `
    export { EditorDocumentoInterno as EditorDocumento } from ${JSON.stringify(join(AQUI, "editor-documento.tsx"))};
    export { EsqueletoEditor } from ${JSON.stringify(join(AQUI, "esqueleto.tsx"))};`,
};

async function empaquetar(): Promise<{ js: string; css: string }> {
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join(AQUI, "__tests__/arnes-clics.tsx")],
    bundle: true, write: false, outdir: "fuera", format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    tsconfig: join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    loader: { ".css": "local-css" },
    logLevel: "silent",
    plugins: [{
      name: "dobles",
      setup(b) {
        const filtro = new RegExp(`^(${Object.keys(DOBLES).map((k) => k.replace(/[/.]/g, "\\$&")).join("|")})$`);
        b.onResolve({ filter: filtro }, (a) => ({ path: a.path, namespace: "doble" }));
        b.onLoad({ filter: /.*/, namespace: "doble" }, (a) => ({ contents: DOBLES[a.path], loader: "js", resolveDir: RAIZ }));
      },
    }],
  });
  const js = r.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = r.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  return { js, css };
}

async function cargarChromium(): Promise<null | { launch(o?: any): Promise<any> }> {
  const dir = process.env.NAVEGADOR_DIR ?? join(homedir(), "navegador");
  const ruta = join(dir, "node_modules/playwright/index.mjs");
  if (!existsSync(ruta)) return null;
  const { chromium } = await import(pathToFileURL(ruta).href);
  const libs = process.env.NAVEGADOR_LIBS ?? join(homedir(), ".cache/pw-syslibs");
  const l = join(libs, "usr/lib/x86_64-linux-gnu");
  const env = existsSync(l)
    ? { ...process.env, LD_LIBRARY_PATH: [l, join(l, "nss"), join(l, "pulseaudio"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"), FONTCONFIG_PATH: join(libs, "etc/fonts") }
    : { ...process.env };
  return { launch: (o: any = {}) => chromium.launch({ ...o, env }) };
}

let navegador: any = null;
let paquete = { js: "", css: "" };
let saltar: string | false = false;

before(async () => {
  const ch = await cargarChromium();
  if (!ch) { saltar = "sin Playwright en NAVEGADOR_DIR / ~/navegador"; return; }
  paquete = await empaquetar();
  navegador = await ch.launch();
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
});
after(async () => { await navegador?.close(); });

const HTML = (css: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}html,body{margin:0;background:#f7f6fb;font-family:system-ui,sans-serif}h1,h2,h3,p,ul,ol{margin:0;padding:0}ul,ol{list-style:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
${css}</style></head><body><div id="root"></div><script src="/arnes.js"></script></body></html>`;

interface Pestana { ctx: any; page: any; errores: string[]; peticiones: { metodo: string; cuerpo: any }[] }

/** Una pestaña con el arnés montado. Todo lo que no sea nuestro origen se corta. */
async function abrir(ruta: string, opts: Record<string, unknown> = {}, respuesta?: (metodo: string, cuerpo: any) => any): Promise<Pestana> {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true, permissions: ["clipboard-read", "clipboard-write"], ...opts });
  const peticiones: { metodo: string; cuerpo: any }[] = [];
  await ctx.route("**/*", async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin !== ORIGEN) return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: HTML(paquete.css) });
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete.js });
    if (url.pathname.startsWith("/api/document-templates")) {
      const cuerpo = r.postData() ? JSON.parse(r.postData()) : null;
      peticiones.push({ metodo: r.method(), cuerpo });
      const res = respuesta ? respuesta(r.method(), cuerpo) : { status: 500, body: {} };
      return route.fulfill({ status: res.status ?? 200, contentType: "application/json", body: JSON.stringify(res.body ?? {}) });
    }
    if (url.pathname.startsWith("/api/documentos/imagenes/")) {
      // un píxel: la imagen «servida» por P4
      return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  page.on("console", (m: any) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(ORIGEN + "/" + ruta);
  await page.waitForSelector(".ProseMirror");
  return { ctx, page, errores, peticiones };
}

const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
const estado = (page: any) => page.evaluate(() => (window as any).__estado?.html ?? "");
const paginas = (page: any) => page.evaluate(() => (window as any).__paginas);
const boton = (page: any, etiqueta: string) => page.locator(`[role="toolbar"] button[aria-label^="${etiqueta}"]`).first();
/**
 * Clic en un botón de la barra y un respiro de 60 ms: Playwright teclea más rápido
 * que lo que tarda el navegador en procesar el clic y avisar del cambio de
 * selección (selectionchange), y una persona nunca llega a eso.
 */
async function pulsar(page: any, etiqueta: string) {
  await boton(page, etiqueta).click();
  await page.waitForTimeout(60);
}
async function capturar(page: any, nombre: string) {
  if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: false });
}
async function esperar(cond: () => Promise<boolean>, que: string, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail(`no pasó: ${que}`);
}

/** Pegar HTML como lo haría Word: portapapeles real si el navegador lo permite; si no, el evento con su DataTransfer. */
async function pegarHtml(page: any, html: string, texto: string) {
  const real = await page.evaluate(async ([h, t]: string[]) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]);
      return true;
    } catch { return false; }
  }, [html, texto]);
  if (real) { await page.keyboard.press("Control+v"); return "portapapeles"; }
  await page.evaluate(([h, t]: string[]) => {
    const dt = new DataTransfer();
    dt.setData("text/html", h);
    dt.setData("text/plain", t);
    document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html, texto]);
  return "evento";
}

const VIEJA =
  "<h1>Control de resina</h1><p>Paciente: [NOMBRE_PACIENTE] (expediente [EXPEDIENTE_PACIENTE]).</p>" +
  "<p>Motivo: <b>control</b> de <i>restauración</i> con <u>resina</u>.</p><ul><li>Evitar alimentos duros.</li><li>Cepillado suave.</li></ul>" +
  "<h2>Plan</h2><ol><li>Control en 6 meses.</li></ol><p>Atendió: [NOMBRE_DOCTOR] · [FECHA]</p>";
const VIEJA_NORMALIZADA = VIEJA.replace("<b>control</b>", "<strong>control</strong>").replace("<i>restauración</i>", "<em>restauración</em>");

test("una plantilla vieja abre idéntica: fichas, negritas, listas; la hoja con membrete, pie y 1 página", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: VIEJA }));
  try {
    assert.equal(await estado(page), VIEJA_NORMALIZADA, "lo que se guardaría es lo mismo que entró");
    assert.equal(await page.locator(".ProseMirror [data-marcador]").count(), 4, "cuatro fichas de marcador");
    assert.equal(await page.locator(".ProseMirror [data-marcador='NOMBRE_PACIENTE']").evaluate((e: Element) => getComputedStyle(e, "::before").content), '"Nombre del paciente"');
    assert.equal(await page.locator(".ProseMirror strong").innerText(), "control");
    assert.equal(await page.locator(".ProseMirror ul li").count(), 2);
    assert.match(await page.locator("[data-paginas]").first().innerText(), /Clínica de Prueba QA · Nota de evolución[\s\S]*Página 1 de 1/);
    assert.equal(await paginas(page), 1);
    // «Ver con datos»: la ficha enseña el ejemplo
    await boton(page, "Ver con datos").click();
    assert.equal(await page.locator(".ProseMirror [data-marcador='NOMBRE_PACIENTE']").evaluate((e: Element) => getComputedStyle(e, "::before").content), '"María Fernanda López Ruiz"');
    assert.equal(await estado(page), VIEJA_NORMALIZADA, "ver con datos no cambia lo que se guarda");
    await boton(page, "Ver marcadores").click();
    await capturar(page, "01-plantilla-vieja-1440");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("escribir, negrita con Ctrl B y con el botón, deshacer; Tab y Shift+Tab dan y quitan sangría", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "<p>Hola</p>" }));
  try {
    const hoja = page.locator(".ProseMirror");
    await hoja.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" mundo");
    assert.equal(await estado(page), "<p>Hola mundo</p>");
    // negrita por teclado sobre la palabra seleccionada
    await page.keyboard.press("Shift+Control+ArrowLeft");
    await page.keyboard.press("Control+b");
    assert.equal(await estado(page), "<p>Hola <strong>mundo</strong></p>");
    assert.equal(await boton(page, "Negrita").getAttribute("aria-pressed"), "true");
    // y por el botón, la quita
    await pulsar(page, "Negrita");
    assert.equal(await estado(page), "<p>Hola mundo</p>");
    // deshacer
    await pulsar(page, "Deshacer");
    assert.equal(await estado(page), "<p>Hola <strong>mundo</strong></p>");
    // sangría
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    assert.equal(await estado(page), '<p data-sangria="1">Hola <strong>mundo</strong></p>');
    await page.keyboard.press("Tab");
    assert.equal(await estado(page), '<p data-sangria="2">Hola <strong>mundo</strong></p>');
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await estado(page), "<p>Hola <strong>mundo</strong></p>");
    assert.ok(await hoja.evaluate((e: Element) => e === document.activeElement), "Tab nunca saca el foco de la hoja");
    // alineación y tamaño
    await pulsar(page, "Centrar");
    await page.locator('select[aria-label="Tamaño de letra"]').selectOption("14");
    await page.waitForTimeout(60);
    await page.keyboard.type("!");
    // Teclear pegado a una negrita sigue en negrita (como en Word); el tamaño nuevo entra en lo tecleado.
    assert.equal(await estado(page), '<p data-alineacion="centro">Hola <strong>mundo<span data-tamano="14">!</span></strong></p>');
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("tabla desde la rejilla (2 × 3), barra contextual, Tab entre celdas, fila nueva y quitar", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "<p>Antes</p>" }));
  try {
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("End");
    await pulsar(page, "Tabla");
    await page.locator('[role="grid"] button[aria-label="2 × 3"]').click();
    await page.waitForTimeout(60);
    assert.equal(
      await estado(page),
      "<p>Antes</p><table><tbody><tr><th><p></p></th><th><p></p></th><th><p></p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><p></p>",
    );
    await page.waitForSelector('[role="toolbar"][aria-label="Tabla"]');
    await page.keyboard.type("A");
    await page.keyboard.press("Tab");
    await page.keyboard.type("B");
    assert.match(await estado(page), /<th><p>A<\/p><\/th><th><p>B<\/p><\/th>/);
    await boton(page, "Fila abajo").click();
    assert.equal(await page.locator(".ProseMirror tr").count(), 3);
    await boton(page, "Quitar tabla").click();
    assert.ok(!(await estado(page)).includes("<table"), "la tabla se quitó");
    assert.equal(await page.locator('[role="toolbar"][aria-label="Tabla"]').count(), 0, "la barra contextual se va con la tabla");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("columnas 2 y 3, escribir en la primera y quitarlas; línea de firma con su lado", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "" }));
  try {
    await page.locator(".ProseMirror").click();
    await pulsar(page, "Columnas");
    await page.locator('[role="menuitem"]', { hasText: "Dos columnas" }).click();
    await page.waitForTimeout(60);
    await page.keyboard.type("izq");
    assert.equal(await estado(page), '<div data-n="2" data-tipo="columnas"><div data-tipo="columna"><p>izq</p></div><div data-tipo="columna"><p></p></div></div><p></p>');
    await boton(page, "Columnas").click();
    await page.locator('[role="menuitem"]', { hasText: "Quitar columnas" }).click();
    assert.equal(await estado(page), "<p>izq</p><p></p><p></p>");
    // firma
    await page.keyboard.press("Control+End");
    await pulsar(page, "Línea de firma");
    // (el párrafo vacío final lo pone el editor para poder seguir escribiendo después de la firma)
    assert.match(await estado(page), /<div data-lado="izquierda" data-tipo="linea-firma">Nombre y firma<\/div><p><\/p>$/);
    await page.waitForSelector('[role="toolbar"][aria-label="Línea de firma"]');
    await pulsar(page, "Derecha");
    assert.match(await estado(page), /data-lado="derecha"/);
    await page.keyboard.type(" del doctor");
    assert.match(await estado(page), /Nombre y firma del doctor<\/div><p><\/p>$/);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("salto de página con Ctrl Enter: la hoja 2 aparece con su membrete y el pie dice «Página 1 de 2»", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "<p>Primera</p>" }));
  try {
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+Enter");
    await page.keyboard.type("Segunda");
    assert.equal(await estado(page), '<p>Primera</p><div data-tipo="salto-pagina"></div><p>Segunda</p>');
    await esperar(async () => (await paginas(page)) === 2, "dos páginas");
    const salto = page.locator(".ProseMirror [data-tipo='salto-pagina']");
    assert.equal(await salto.evaluate((e: Element) => e.textContent), "Nueva página");
    // la decoración del salto: pie de la hoja 1 + mesa + membrete de la hoja 2
    const auto = page.locator(".ProseMirror [contenteditable='false'][aria-hidden='true']").first();
    assert.match(await auto.innerText(), /Clínica de Prueba QA · Nota de evolución[\s\S]*Página 1 de 2[\s\S]*Clínica de Prueba QA[\s\S]*Av\. Reforma/);
    assert.match(await page.locator("[data-paginas='2']").innerText(), /Página 2 de 2/);
    await capturar(page, "02-salto-de-pagina-1440");
    // el salto se deshace con Retroceso
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await esperar(async () => (await paginas(page)) === 1, "vuelve a una página");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("texto largo: la hoja se parte sola entre bloques y cuenta las páginas", async (t) => {
  if (saltar) return t.skip(saltar);
  const parrafo = "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>";
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: parrafo.repeat(30) }));
  try {
    await esperar(async () => ((await paginas(page)) ?? 0) >= 3, "al menos tres páginas");
    const n = await paginas(page);
    const saltos = await page.locator(".ProseMirror [contenteditable='false'][aria-hidden='true']").count();
    assert.equal(saltos, n - 1, "un salto de hoja por cada página menos una");
    // ningún salto corta un párrafo: cada salto va justo antes de un <p>
    const ok = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".ProseMirror [contenteditable='false'][aria-hidden='true']")).every((e) => e.nextElementSibling?.tagName === "P"),
    );
    assert.ok(ok, "los saltos van entre párrafos");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("marcador escribiendo [FECHA] y desde el menú; la ficha no se rompe al escribir pegado a ella", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "<p>Hoy</p>" }));
  try {
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" [FECHA]");
    assert.equal(await estado(page), "<p>Hoy [FECHA]</p>");
    assert.equal(await page.locator(".ProseMirror [data-marcador='FECHA']").count(), 1, "se volvió ficha");
    await page.keyboard.type(" para ");
    await pulsar(page, "Insertar un dato");
    await page.locator('[role="menuitem"][data-marcador="NOMBRE_PACIENTE"]').click();
    await page.waitForTimeout(60);
    assert.equal(await estado(page), "<p>Hoy [FECHA] para [NOMBRE_PACIENTE] </p>");
    // una clave que no existe se queda escrita
    await page.keyboard.type("[NADA]");
    assert.equal(await estado(page), "<p>Hoy [FECHA] para [NOMBRE_PACIENTE] [NADA]</p>");
    // Con las flechas, la ficha se SELECCIONA entera al llegar a ella (se ve qué se va a borrar) y Retroceso la quita entera, no una letra
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(40);
    }
    await esperar(async () => (await page.locator(".ProseMirror [data-marcador='FECHA'].ProseMirror-selectednode").count()) === 1, "la ficha queda seleccionada");
    await page.keyboard.press("Backspace");
    await esperar(async () => (await estado(page)) === "<p>Hoy  para [NOMBRE_PACIENTE] [NADA]</p>", "la ficha se fue entera");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("pegar de Word: negrita, lista, tabla y alineación entran limpias; nada de mso ni style", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "" }));
  try {
    await page.locator(".ProseMirror").click();
    const word =
      '<html><head><style>p.MsoNormal{margin:0}</style></head><body><!--[if gte mso 9]><xml>x</xml><![endif]-->' +
      '<p class="MsoNormal" style="text-align:center"><b><span style="font-size:14.0pt;mso-bidi-font-size:11.0pt">Indicaciones</span></b><o:p></o:p></p>' +
      '<ul><li class="MsoNormal">Reposo</li><li class="MsoNormal">Hielo</li></ul>' +
      '<table class="MsoTableGrid" border="1" style="border-collapse:collapse"><tr><td style="width:100pt"><p class="MsoNormal">Pieza</p></td><td><p class="MsoNormal">1.6</p></td></tr></table></body></html>';
    const como = await pegarHtml(page, word, "Indicaciones\nReposo\nHielo\nPieza 1.6");
    await esperar(async () => (await estado(page)).includes("<table"), `el pegado (${como}) entró`);
    assert.equal(
      await estado(page),
      '<p data-alineacion="centro"><strong><span data-tamano="14">Indicaciones</span></strong></p><ul><li>Reposo</li><li>Hielo</li></ul>' +
        "<table><tbody><tr><td><p>Pieza</p></td><td><p>1.6</p></td></tr></tbody></table><p></p>",
    );
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("imagen: sin onSubirImagen no hay botón; con él, el archivo sube, se inserta con su clave y se pinta por la ruta", async (t) => {
  if (saltar) return t.skip(saltar);
  const sin = await abrir(q({ e: "editor", html: "" }));
  try {
    assert.equal(await sin.page.locator('[role="toolbar"] button[aria-label^="Insertar imagen"]').count(), 0);
  } finally { await sin.ctx.close(); }
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: "<p>Rx</p>", imagen: "1" }));
  try {
    await page.locator(".ProseMirror").click();
    const [selector] = await Promise.all([page.waitForEvent("filechooser"), boton(page, "Insertar imagen").click()]);
    await selector.setFiles({ name: "rx.png", mimeType: "image/png", buffer: Buffer.alloc(1024, 1) });
    await esperar(async () => (await estado(page)).includes("<img"), "la imagen se insertó");
    assert.equal(await estado(page), '<p>Rx</p><img data-archivo="documentos/cl_qa/subida-1.webp" data-ancho="medio" data-alineacion="centro" alt=""><p></p>');
    assert.deepEqual(await page.evaluate(() => (window as any).__subidas), ["rx.png:image/png:1024"]);
    const img = page.locator(".ProseMirror img");
    assert.equal(await img.getAttribute("src"), "/api/documentos/imagenes/documentos%2Fcl_qa%2Fsubida-1.webp");
    // barra contextual de imagen: tamaño y lado
    await page.waitForSelector('[role="toolbar"][aria-label="Imagen"]');
    await page.locator('[role="toolbar"][aria-label="Imagen"] button', { hasText: "Chica" }).click();
    await page.locator('[role="toolbar"][aria-label="Imagen"] button[aria-label="A la derecha"]').click();
    assert.match(await estado(page), /data-ancho="chico" data-alineacion="derecha"/);
    // un archivo que no es imagen no sube
    const [sel2] = await Promise.all([page.waitForEvent("filechooser"), boton(page, "Insertar imagen").click()]);
    await sel2.setFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10) });
    await page.waitForSelector("text=Solo se aceptan imágenes");
    assert.equal((await page.evaluate(() => (window as any).__subidas)).length, 1, "el PDF no se subió");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("390 px: hoja fluida, barra desplazable, sin scroll horizontal, sin saltos de hoja; y modo oscuro", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir(q({ e: "editor", html: VIEJA + '<div data-tipo="salto-pagina"></div><p>Dos</p>' }), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await esperar(async () => (await paginas(page)) === 0, "en angosto no se pagina");
    // (el código va como texto: tsx le pondría a las funciones con nombre un ayudante `__name` que no existe en la página)
    const medidas = await page.evaluate((c: string) => new Function(c)(), `
      const b = document.querySelector('[role="toolbar"]');
      return {
        ancho: document.documentElement.scrollWidth,
        barraScroll: b.scrollWidth > b.clientWidth && getComputedStyle(b).overflowX === "auto",
        saltosVisibles: Array.from(document.querySelectorAll(".ProseMirror [contenteditable='false'][aria-hidden='true']")).filter((e) => e.offsetParent !== null).length,
      };`);
    assert.ok(medidas.ancho <= 390, `sin scroll horizontal (scrollWidth=${medidas.ancho})`);
    assert.ok(medidas.barraScroll, "la barra se desplaza a lo ancho");
    assert.equal(medidas.saltosVisibles, 0, "sin saltos de hoja en angosto");
    assert.ok(await page.locator("text=En pantalla angosta la hoja es fluida").isVisible());
    await capturar(page, "03-plantilla-390");
    // oscuro: la hoja sigue siendo «papel» (más clara que la mesa) y el texto se lee
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const oscuro = await page.evaluate((c: string) => new Function(c)(), `
      const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number); return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000; };
      const hoja = document.querySelector("[data-paginas]") || document.querySelector(".ProseMirror").parentElement.parentElement;
      return { papel: lum(getComputedStyle(hoja).backgroundColor), texto: lum(getComputedStyle(document.querySelector(".ProseMirror")).color) };`);
    assert.ok(oscuro.papel < 128 && oscuro.texto > 128, `oscuro: papel ${oscuro.papel}, texto ${oscuro.texto}`);
    await capturar(page, "04-plantilla-390-oscuro");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

const FILA = {
  id: "tpl_1", kind: "NOTA_EVOLUCION", name: "Control de resina", body: VIEJA, isActive: true,
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", precargada: false, restaurable: false,
};
const respondeGuardado = (metodo: string, cuerpo: any) => ({
  status: 200,
  body: { ...FILA, ...(metodo === "POST" ? { id: "tpl_nueva", kind: cuerpo.kind } : {}), name: cuerpo.name, body: cuerpo.body ?? FILA.body, createdById: "u1", restaurable: false },
});

test("modal de Plantillas: editar sin tocar el texto manda solo el nombre; tocarlo manda body + baseBody", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores, peticiones } = await abrir(q({ e: "modal", editing: JSON.stringify(FILA) }), {}, respondeGuardado);
  try {
    assert.ok(await page.locator('[role="dialog"]').isVisible());
    assert.equal(await page.locator('input[aria-label="Nombre de la plantilla"]').inputValue(), "Control de resina");
    assert.equal(await page.locator(".ProseMirror [data-marcador]").count(), 4);
    await capturar(page, "05-modal-plantilla-1440");
    // el raíl: una ficha inserta el marcador en el cursor
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+End");
    await page.locator('aside button[data-marcador="EDAD_PACIENTE"]').click();
    await page.locator('input[aria-label="Nombre de la plantilla"]').fill("Control de resina v2");
    await page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await esperar(async () => peticiones.length === 1, "una petición");
    assert.equal(peticiones[0].metodo, "PATCH");
    assert.equal(peticiones[0].cuerpo.name, "Control de resina v2");
    assert.equal(peticiones[0].cuerpo.baseBody, VIEJA, "baseBody = lo que se cargó");
    assert.equal(peticiones[0].cuerpo.body, VIEJA_NORMALIZADA.replace("[FECHA]</p>", "[FECHA][EDAD_PACIENTE] </p>"));
    await page.waitForSelector("#cerrado");
    assert.equal((await page.evaluate(() => (window as any).__guardado))?.name, "Control de resina v2");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }

  const sinTocar = await abrir(q({ e: "modal", editing: JSON.stringify(FILA) }), {}, respondeGuardado);
  try {
    await sinTocar.page.locator('input[aria-label="Nombre de la plantilla"]').fill("Otro nombre");
    await sinTocar.page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await esperar(async () => sinTocar.peticiones.length === 1, "una petición");
    assert.deepEqual(sinTocar.peticiones[0].cuerpo, { name: "Otro nombre" }, "sin tocar el texto no viaja body ni baseBody");
    assert.deepEqual(sinTocar.errores, []);
  } finally { await sinTocar.ctx.close(); }
});

test("modal de Plantillas: nueva — sin nombre o sin texto no manda nada; con los dos manda POST con kind", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores, peticiones } = await abrir(q({ e: "modal", kind: "CONSENTIMIENTO" }), {}, respondeGuardado);
  try {
    await page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await page.waitForSelector('[role="alert"]:has-text("Ponle un nombre")');
    await page.locator('input[aria-label="Nombre de la plantilla"]').fill("Extracción");
    await page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await page.waitForSelector('[role="alert"]:has-text("Escribe el texto")');
    assert.equal(peticiones.length, 0, "nada viajó");
    // el consentimiento ofrece los tres marcadores propios
    assert.equal(await page.locator('aside button[data-marcador="LUGAR"]').count(), 1);
    await page.locator(".ProseMirror").click();
    await page.keyboard.type("Autorizo el procedimiento a ");
    await page.locator('aside button[data-marcador="NOMBRE_REPRESENTANTE"]').click();
    await page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await esperar(async () => peticiones.length === 1, "una petición");
    assert.deepEqual(peticiones[0], { metodo: "POST", cuerpo: { kind: "CONSENTIMIENTO", name: "Extracción", body: "<p>Autorizo el procedimiento a [NOMBRE_REPRESENTANTE] </p>" } });
    await page.waitForSelector("#cerrado");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});
