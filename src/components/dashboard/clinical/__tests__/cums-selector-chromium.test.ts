/**
 * ws1-t10 · «Agregar medicamento que no está» con clics y teclas DE VERDAD en
 * Chromium (Playwright). El CumsSelector real se empaqueta con esbuild y se
 * monta en una página con los tokens de globals.css; las llamadas a
 * /api/catalogs/cums se interceptan (nada sale del navegador, nada toca una
 * base) y el 422 del candado lo decide el mismo `detectarControlado` que usa
 * el servidor.
 *
 * Run: npm run test:recetas-selector-clics
 *   (Playwright no es dependencia del repo: se busca en NAVEGADOR_DIR o
 *   ~/navegador. Sin él, la prueba se SALTA diciéndolo. Con RECETAS_CAPTURAS=<dir>
 *   deja capturas a 1440 y 390 px, claro y oscuro.)
 *
 * Lo que fija: buscar y elegir del catálogo; «Sin resultados» + el botón de
 * agregar; el alta (nombre precargado con lo buscado) mete el medicamento en la
 * receta con el chip «Propio de la clínica»; escribir un controlado (tramadol,
 * Rivotril) enseña el candado, deshabilita Guardar y «Buscar en el catálogo»
 * lleva al catálogo con el nombre; el 422 del servidor también cierra el paso;
 * sin `puedeAgregar` no hay botón; 390 px sin scroll horizontal; 0 errores de
 * consola.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { detectarControlado } from "@/lib/clinical/controlados";

const RAIZ = process.cwd();
const ORIGEN = "https://recetas.prueba";
const CAPTURAS = process.env.RECETAS_CAPTURAS ?? "";

const AQUI = join(RAIZ, "src/components/dashboard/clinical");
const DOBLES: Record<string, string> = {
  "@/i18n/i18n-provider": `
    import es from ${JSON.stringify(join(RAIZ, "src/i18n/dictionaries/es.json"))};
    const busca = (k) => k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), es);
    export const useT = () => (k, vars) => { let v = busca(k); if (typeof v !== "string") return k;
      for (const [a, b] of Object.entries(vars ?? {})) v = v.split("{" + a + "}").join(String(b)); return v; };
    export const useLocale = () => "es";`,
};

async function empaquetar(): Promise<string> {
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join(AQUI, "__tests__/arnes-cums.tsx")],
    bundle: true, write: false, outdir: "fuera", format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    tsconfig: join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
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
  return r.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
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

/** El catálogo del doble: dos globales y uno propio de la clínica. */
const CATALOGO = [
  { clave: "MX-0004", descripcion: "Ibuprofeno", presentacion: "400 mg, caja c/30 tabletas", formaFarmaceutica: "Tableta", grupoTerapeutico: "Analgésicos y antiinflamatorios", cofeprisGroup: "IV", propio: false },
  { clave: "MX-0506", descripcion: "Ibuprofeno", presentacion: "600 mg, caja c/20 tabletas", formaFarmaceutica: "Tableta", grupoTerapeutico: "Analgésicos y antiinflamatorios", cofeprisGroup: "IV", propio: false },
  { clave: "MX-0017", descripcion: "Tramadol", presentacion: "50 mg, caja c/10 cápsulas", formaFarmaceutica: "Cápsula", grupoTerapeutico: "Analgésicos y antiinflamatorios", cofeprisGroup: "III", propio: false },
  { clave: "CL-propio1", descripcion: "Ibuprofeno", presentacion: "800 mg, caja c/10 tabletas, vía oral", formaFarmaceutica: "Tableta", grupoTerapeutico: "Propio de la clínica", cofeprisGroup: null, propio: true },
];

let navegador: any = null;
let js = "";
let css = "";
let saltar: string | false = false;

before(async () => {
  const ch = await cargarChromium();
  if (!ch) { saltar = "sin Playwright en NAVEGADOR_DIR / ~/navegador"; return; }
  js = await empaquetar();
  // Los tokens reales del panel (claro y .dark): globals.css entero sin las líneas @tailwind.
  css = readFileSync(join(RAIZ, "src/app/globals.css"), "utf8").replace(/^\s*@tailwind[^\n]*\n/gm, "");
  navegador = await ch.launch();
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
});
after(async () => { await navegador?.close(); });

const HTML = (oscuro: boolean) => `<!doctype html><html lang="es"${oscuro ? ' class="dark"' : ""}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*,::before,::after{box-sizing:border-box}html,body{margin:0;font-family:system-ui,sans-serif}body{background:var(--bg-base,#f7f6fb);color:var(--text-1)}</style>
<style>${css}</style></head><body><div id="root"></div><script src="/arnes.js"></script></body></html>`;

interface Pestana { ctx: any; page: any; errores: string[]; altas: any[] }

async function abrir(opts: { ancho?: number; oscuro?: boolean; puedeAgregar?: boolean } = {}): Promise<Pestana> {
  const ctx = await navegador.newContext({ viewport: { width: opts.ancho ?? 1440, height: 900 }, ignoreHTTPSErrors: true });
  const altas: any[] = [];
  const puedeAgregar = opts.puedeAgregar ?? true;
  await ctx.route("**/*", async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin !== ORIGEN) return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: HTML(!!opts.oscuro) });
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: js });
    if (url.pathname === "/api/catalogs/cums/propios" && r.method() === "POST") {
      const cuerpo = JSON.parse(r.postData() ?? "{}");
      altas.push(cuerpo);
      const controlado = detectarControlado(cuerpo.nombre, cuerpo.concentracion, cuerpo.presentacion);
      if (controlado) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "medicamento_controlado", controlado }) });
      const medicamento = {
        clave: "CL-nuevo1", descripcion: cuerpo.nombre, presentacion: [cuerpo.concentracion, cuerpo.presentacion, `vía ${String(cuerpo.via).toLowerCase()}`].filter(Boolean).join(", "),
        formaFarmaceutica: cuerpo.forma, grupoTerapeutico: "Propio de la clínica", cofeprisGroup: null, propio: true,
      };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ medicamento, existia: false }) });
    }
    if (url.pathname === "/api/catalogs/cums") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = CATALOGO.filter((m) => m.descripcion.toLowerCase().includes(q) || m.clave.toLowerCase().includes(q));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items, count: items.length, puedeAgregar }) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  page.on("console", (m: any) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(ORIGEN + "/");
  await page.waitForSelector('input[type="text"]');
  return { ctx, page, errores, altas };
}

async function foto(page: any, nombre: string) {
  if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true });
}

const buscador = (page: any) => page.locator('input[type="text"]').first();

test("buscar y elegir del catálogo: el medicamento entra a la receta con sus datos", { skip: saltar }, async () => {
  const { ctx, page, errores } = await abrir();
  await buscador(page).click();
  await buscador(page).type("ibu");
  await page.waitForSelector('button:has-text("400 mg")');
  const resultados = await page.locator('button:has-text("Ibuprofeno")').count();
  assert.equal(resultados, 3, "dos globales y el propio");
  assert.equal(await page.locator('[data-testid="agregar-medicamento"]').count(), 1);
  await foto(page, "01-busqueda-1440");
  await page.locator('button:has-text("400 mg")').click();
  const items = await page.evaluate("window.__items");
  assert.equal(items.length, 1);
  assert.equal(items[0].cumsKey, "MX-0004");
  assert.equal(await buscador(page).inputValue(), "", "el buscador se vacía");
  assert.deepEqual(errores, []);
  await ctx.close();
});

test("sin resultados → «Agregar medicamento que no está» → el alta lo mete en la receta con el chip «Propio de la clínica»", { skip: saltar }, async () => {
  const { ctx, page, errores, altas } = await abrir();
  await buscador(page).click();
  await buscador(page).type("Clonixinato");
  await page.waitForSelector("text=Sin resultados.");
  await page.locator('[data-testid="agregar-medicamento"]').click();
  await page.waitForSelector('[data-testid="alta-medicamento"]');
  assert.equal(await page.locator('[data-testid="alta-medicamento"] input').first().inputValue(), "Clonixinato", "el nombre viene precargado");
  await page.locator('[data-testid="alta-medicamento"] input').first().fill("Clonixinato de lisina");
  await page.locator('[data-testid="alta-medicamento"] input').nth(1).fill("125 mg");
  await page.locator('[data-testid="alta-medicamento"] input').nth(2).fill("caja c/10 tabletas");
  await foto(page, "02-alta-1440");
  await page.locator('button:has-text("Guardar y agregar a la receta")').click();
  await page.waitForSelector("text=Propio de la clínica");
  assert.equal(altas.length, 1);
  assert.deepEqual(altas[0], { nombre: "Clonixinato de lisina", concentracion: "125 mg", forma: "Tableta", via: "Oral", presentacion: "caja c/10 tabletas" });
  const items = await page.evaluate("window.__items");
  assert.equal(items.length, 1);
  assert.equal(items[0].cumsKey, "CL-nuevo1");
  assert.equal(items[0].cums.presentacion, "125 mg, caja c/10 tabletas, vía oral");
  assert.equal(await page.locator('[data-testid="alta-medicamento"]').count(), 0, "el formulario se cierra");
  await foto(page, "03-propio-en-receta-1440");
  assert.deepEqual(errores, []);
  await ctx.close();
});

test("el candado: tramadol o Rivotril en el alta → aviso, Guardar deshabilitado y «Buscar en el catálogo» lleva al catálogo", { skip: saltar }, async () => {
  const { ctx, page, errores, altas } = await abrir();
  await buscador(page).click();
  await buscador(page).type("xx");
  await page.waitForSelector('[data-testid="agregar-medicamento"]');
  await page.locator('[data-testid="agregar-medicamento"]').click();
  const nombre = page.locator('[data-testid="alta-medicamento"] input').first();
  await nombre.fill("Tramadol clorhidrato");
  await page.waitForSelector('[data-testid="candado-controlado"]');
  const aviso = await page.locator('[data-testid="candado-controlado"]').innerText();
  assert.match(aviso, /«Tramadol» es un medicamento controlado \(grupo COFEPRIS III\)/);
  assert.equal(await page.locator('button:has-text("Guardar y agregar a la receta")').isDisabled(), true);
  await foto(page, "04-candado-1440");

  // Una marca comercial, y el controlado escondido en la concentración
  await nombre.fill("Rivotril");
  assert.match(await page.locator('[data-testid="candado-controlado"]').innerText(), /Clonazepam/);
  await nombre.fill("Gotas");
  await page.waitForSelector('[data-testid="candado-controlado"]', { state: "detached" });
  await page.locator('[data-testid="alta-medicamento"] input').nth(1).fill("clonazepam 2.5 mg/mL");
  await page.waitForSelector('[data-testid="candado-controlado"]');

  await nombre.fill("Tramadol");
  await page.locator('[data-testid="alta-medicamento"] input').nth(1).fill("50 mg");
  await page.locator('button:has-text("Buscar «Tramadol» en el catálogo")').click();
  await page.waitForSelector('[data-testid="alta-medicamento"]', { state: "detached" });
  assert.equal(await buscador(page).inputValue(), "Tramadol");
  await page.waitForSelector('button:has-text("COFEPRIS III")');
  await foto(page, "05-catalogo-tramadol-1440");
  assert.equal(altas.length, 0, "ningún POST: el candado de la pantalla paró antes");
  assert.deepEqual(errores, []);
  await ctx.close();
});

test("v2 · «Xanax» (la marca que el catálogo no encuentra y el botón precarga) cae en el candado; una letra cirílica no deja guardar", { skip: saltar }, async () => {
  const { ctx, page, errores, altas } = await abrir();
  await buscador(page).click();
  await buscador(page).type("Xanax");
  await page.waitForSelector("text=Sin resultados.");
  await page.locator('[data-testid="agregar-medicamento"]').click();
  await page.waitForSelector('[data-testid="candado-controlado"]');
  assert.match(await page.locator('[data-testid="candado-controlado"]').innerText(), /«Alprazolam» es un medicamento controlado \(grupo COFEPRIS III\)/);
  assert.equal(await page.locator('button:has-text("Guardar y agregar a la receta")').isDisabled(), true);

  const nombre = page.locator('[data-testid="alta-medicamento"] input').first();
  await nombre.fill("Tramad\u043El"); // «о» cirílica: se ve igual que la latina
  await page.waitForSelector('[data-testid="caracter-no-permitido"]');
  assert.match(await page.locator('[data-testid="caracter-no-permitido"]').innerText(), /Hay un carácter que no se permite: «\u043E»/);
  assert.equal(await page.locator('button:has-text("Guardar y agregar a la receta")').isDisabled(), true);
  await foto(page, "08-caracter-no-permitido-1440");
  await nombre.fill("Tramad0l"); // cero por o: lo caza el candado
  await page.waitForSelector('[data-testid="candado-controlado"]');
  assert.equal(altas.length, 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test("si la pantalla no lo ve pero el servidor sí (422), también se cierra el paso", { skip: saltar }, async () => {
  const { ctx, page, altas } = await abrir();
  await buscador(page).click();
  await buscador(page).type("xx");
  await page.waitForSelector('[data-testid="agregar-medicamento"]');
  await page.locator('[data-testid="agregar-medicamento"]').click();
  // La pantalla y el servidor usan la misma lista, así que para ejercitar la rama
  // del 422 el doble responde 422 a un nombre que la pantalla da por limpio (es lo
  // que pasaría si la lista del servidor fuera más nueva que la del navegador).
  await page.locator('[data-testid="alta-medicamento"] input').first().fill("Analgésico fuerte");
  await page.locator('[data-testid="alta-medicamento"] input').nth(1).fill("50 mg");
  await ctx.unroute("**/*");
  await ctx.route("**/*", (route: any) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/catalogs/cums/propios") {
      altas.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "medicamento_controlado", controlado: { nombre: "Tramadol", grupo: "III" } }) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.locator('button:has-text("Guardar y agregar a la receta")').click();
  await page.waitForSelector('[data-testid="candado-controlado"]');
  assert.equal(altas.length, 1);
  assert.equal(await page.locator('button:has-text("Guardar y agregar a la receta")').isDisabled(), true);
  assert.deepEqual(await page.evaluate("window.__items"), []);
  await ctx.close();
});

test("sin puedeAgregar (SQL sin pegar) no hay botón de agregar: todo como hoy", { skip: saltar }, async () => {
  const { ctx, page, errores } = await abrir({ puedeAgregar: false });
  await buscador(page).click();
  await buscador(page).type("ibu");
  await page.waitForSelector('button:has-text("400 mg")');
  assert.equal(await page.locator('[data-testid="agregar-medicamento"]').count(), 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test("390 px: el alta y la lista caben sin scroll horizontal, claro y oscuro", { skip: saltar }, async () => {
  for (const oscuro of [false, true]) {
    const { ctx, page, errores } = await abrir({ ancho: 390, oscuro });
    await buscador(page).click();
    await buscador(page).type("ibu");
    await page.waitForSelector('button:has-text("800 mg")');
    await page.locator('button:has-text("800 mg")').click();
    await buscador(page).type("xx");
    await page.waitForSelector('[data-testid="agregar-medicamento"]');
    await page.locator('[data-testid="agregar-medicamento"]').click();
    await page.locator('[data-testid="alta-medicamento"] input').first().fill("Tramadol");
    await page.waitForSelector('[data-testid="candado-controlado"]');
    const ancho = await page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)");
    assert.ok(ancho <= 390, `scroll horizontal: ${ancho}px`);
    const fuera = await page.evaluate(`(() => { const w = 390; let n = 0; for (const el of document.querySelectorAll("#root *")) { const r = el.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1)) n++; } return n; })()`);
    assert.equal(fuera, 0, "elementos que se salen por un lado");
    await foto(page, oscuro ? "07-390-oscuro" : "06-390-claro");
    assert.deepEqual(errores, []);
    await ctx.close();
  }
});
