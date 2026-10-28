/**
 * ws1-t6 · Rojo = por hacer, azul = realizado, con clics de verdad (decisión 1 de Rafael, 28-oct).
 *
 * Run: npm run test:odontograma-rojo-azul
 *   (--experimental-test-module-mocks: GET/PUT/DELETE de /api/odontogram son las rutas REALES; se
 *   sustituyen Prisma —una tabla en memoria con la columna `estado` o sin ella—, la sesión, la
 *   auditoría y la suplantación.)
 *
 * El componente real (OdontogramV2 en modo vivo) empaquetado con esbuild y abierto en Chromium:
 *  · con la columna: el selector «Por hacer / Realizado» arriba; con «Por hacer», elegir Restauración
 *    y tocar la cara la pinta en ROJO en un solo paso; con «Realizado», tocar la misma cara la pasa a
 *    AZUL (la misma marca, no otra); «De otra clínica» = previo; recargar lo conserva; desde el panel
 *    del diente se regresa a rojo; un hallazgo (caries) se marca como siempre, sin estado;
 *  · sin la columna (SQL sin pegar): no hay selector y todo es como hoy;
 *  · en un teléfono (390 px) la página no se desborda a lo ancho.
 *
 * Playwright no es dependencia del repo: se busca en NAVEGADOR_DIR (o ~/navegador). Sin él, la
 * prueba se SALTA diciéndolo.
 */
import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const CLINICA = "cli_1";
const PACIENTE = "pat_1";
const RAIZ = process.cwd();
const ORIGEN = "http://odo.prueba";

interface Fila { id: string; patientId: string; toothNumber: number; surface: string | null; conditionId: string; notes: string | null; estado?: string | null }
let FILAS: Fila[] = [];
let seq = 0;
/** ¿La base ya tiene `odontogram_entries."estado"` (sql/odontograma-estado-marca.sql)? */
let CON_COLUMNA = true;
const coincide = (f: Fila, w: any): boolean => {
  if (typeof w?.patientId !== "string" || !w.patientId) throw new Error("consulta de odontograma SIN patientId");
  if (f.patientId !== w.patientId) return false;
  if (w.toothNumber !== undefined && f.toothNumber !== w.toothNumber) return false;
  if ("surface" in w && f.surface !== w.surface) return false;
  if (typeof w.conditionId === "string" && f.conditionId !== w.conditionId) return false;
  if (w.conditionId?.not && f.conditionId === w.conditionId.not) return false;
  return true;
};
const sinEstado = ({ estado: _e, ...f }: Fila) => f;
const tabla: any = {
  findMany: async ({ where }: any) => FILAS.filter((f) => coincide(f, where)).map((f) => ({ ...sinEstado(f), updatedAt: new Date() })),
  findFirst: async ({ where }: any) => { const f = FILAS.find((x) => coincide(x, where)); return f ? { id: f.id } : null; },
  deleteMany: async ({ where }: any) => { const n = FILAS.length; FILAS = FILAS.filter((f) => !coincide(f, where)); return { count: n - FILAS.length }; },
  create: async ({ data }: any) => { const f = { id: `e${++seq}`, notes: null, ...data }; FILAS.push(f); return sinEstado(f); },
  update: async ({ where, data }: any) => { const f = FILAS.find((x) => x.id === where.id)!; Object.assign(f, data); return sinEstado(f); },
  upsert: async ({ where, create, update }: any) => {
    const f = FILAS.find((x) => coincide(x, where.patientId_toothNumber_surface_conditionId));
    if (f) { Object.assign(f, update); return sinEstado(f); }
    const n = { id: `e${++seq}`, notes: null, ...create }; FILAS.push(n); return sinEstado(n);
  },
};
/** El SQL crudo de estado-db.ts: la sonda, la lectura y la escritura del estado. */
const crudo = {
  $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => {
    const t = s.join("?");
    if (t.includes("information_schema.columns")) return [{ existe: CON_COLUMNA }];
    if (t.includes(`SELECT "id", "estado" FROM "odontogram_entries"`)) {
      if (!CON_COLUMNA) throw new Error('column "estado" does not exist');
      return FILAS.filter((f) => f.patientId === v[0] && f.estado).map((f) => ({ id: f.id, estado: f.estado }));
    }
    throw new Error(`$queryRaw no esperado: ${t}`);
  },
  $executeRaw: async (s: TemplateStringsArray, ...v: unknown[]) => {
    const t = s.join("?");
    if (t.includes(`SET "estado"`)) {
      if (!CON_COLUMNA) throw new Error('column "estado" does not exist');
      const f = FILAS.find((x) => x.id === v[1] && x.patientId === v[2]);
      if (f) f.estado = v[0] as string | null;
      return f ? 1 : 0;
    }
    return 1; // los candados
  },
};
const prismaFalso: any = {
  odontogramEntry: tabla,
  auditLog: { create: async ({ data }: any) => data },
  $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(prismaFalso),
  ...crudo,
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/odontogram/api-auth", {
  namedExports: {
    getDbUser: async () => ({ id: "u_dr", role: "DOCTOR", clinicId: CLINICA }),
    puedeEscribirOdontograma: () => true,
    puedeLeerOdontograma: () => true,
    ensurePatientInClinic: async (pid: string) => pid === PACIENTE,
    isMissingTableError: () => false,
  },
});
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/audit", { namedExports: { extractAuditMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }) } });
mock.module("@/lib/admin/suplantacion", {
  namedExports: { suplantacionDeEstaPeticion: async () => null, anotarAccionDeSuplantacion: async () => {} },
});

const estado = () => FILAS.map((f) => `${f.toothNumber}:${f.surface ?? "-"}:${f.conditionId}${f.estado ? `:${f.estado}` : ""}`).sort();

/* ---------------- el componente real, empaquetado para Chromium ---------------- */

const DOBLES: Record<string, string> = {
  "next/font/local": `export default () => ({ className: "", variable: "", style: {} });`,
  "@/i18n/i18n-provider": `export const useT = () => (k) => k;`,
};

async function empaquetar(): Promise<string> {
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join(RAIZ, "src/components/dashboard/odontogram-v2/__tests__/arnes-clics.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    tsconfig: join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    logLevel: "silent",
    plugins: [{
      name: "dobles",
      setup(b) {
        b.onResolve({ filter: /^(next\/font\/local|@\/i18n\/i18n-provider)$/ }, (a) => ({ path: a.path, namespace: "doble" }));
        b.onLoad({ filter: /.*/, namespace: "doble" }, (a) => ({ contents: DOBLES[a.path], loader: "js" }));
        b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: "css" }));
        b.onLoad({ filter: /.*/, namespace: "css" }, () => ({ contents: "", loader: "js" }));
      },
    }],
  });
  return r.outputFiles[0]!.text;
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
let paquete = "";
let saltar: string | false = false;

before(async () => {
  const ch = await cargarChromium();
  if (!ch) { saltar = "sin Playwright en NAVEGADOR_DIR / ~/navegador"; return; }
  paquete = await empaquetar();
  navegador = await ch.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
});
after(async () => { await navegador?.close(); });
beforeEach(async () => {
  FILAS = []; seq = 0; CON_COLUMNA = true;
  // la sonda recuerda un «sí» para siempre (la columna no se quita): cada prueba pregunta de nuevo
  (await import("@/lib/odontogram/estado-db"))._olvidarSondaEstado();
});

/** Los tokens del panel que usa el odontograma (los mismos valores de globals.css, modo claro). */
const TOKENS = ":root{--danger:#dc2626;--danger-soft:rgba(220,38,38,.10);--info:#2563eb;--info-soft:rgba(37,99,235,.10)}";
const ROJO = "rgb(220, 38, 38)";
const AZUL = "rgb(37, 99, 235)";
const RESTAURADORA = "rgb(42, 111, 219)"; // #2A6FDB: el color de siempre de la especialidad

const HTML = (css: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${TOKENS}${css}</style></head>
<body style="margin:0"><div id="root"></div><script src="/arnes.js"></script></body></html>`;

async function abrir(opts: Record<string, unknown> = {}) {
  const { NextRequest } = await import("next/server");
  const raiz = await import("@/app/api/odontogram/route");
  const css = readFileSync(join(RAIZ, "src/components/dashboard/odontogram-v2/odontogram.css"), "utf8");
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, ...opts });
  const puts: any[] = [];
  await ctx.route("**/*", async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin !== ORIGEN) return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: HTML(css) });
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    if (url.pathname.startsWith("/odontograma/")) {
      const f = normalize(join(RAIZ, "public", url.pathname));
      if (!f.startsWith(join(RAIZ, "public")) || !existsSync(f)) return route.fulfill({ status: 404, body: "" });
      const tipo = f.endsWith(".wasm") ? "application/wasm" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream";
      return route.fulfill({ contentType: tipo, body: readFileSync(f) });
    }
    if (url.pathname === "/api/odontogram") {
      const metodo = r.method();
      const cuerpo = metodo === "GET" || metodo === "HEAD" ? undefined : r.postDataBuffer();
      if (metodo === "PUT") puts.push(JSON.parse(cuerpo.toString("utf8")));
      const req = new NextRequest(url.href, { method: metodo, headers: r.headers(), body: cuerpo } as any);
      const res: Response = await (raiz as any)[metodo](req);
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  await cargada(page);
  return { ctx, page, puts, errores };
}

async function cargada(page: any) {
  if (page.url() === "about:blank") await page.goto(ORIGEN + "/");
  else await page.reload();
  await page.waitForSelector(".odo-summary");
  await page.waitForFunction(() => !document.querySelector(".odo-summary-loading"));
}

async function esperar(cond: () => boolean, que: string, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail(`no pasó: ${que} (base: ${JSON.stringify(estado())})`);
}

const chipPaleta = (page: any, nombre: string) =>
  page.locator(".odo-palette .odo-chip", { hasText: new RegExp(`^${nombre.replace(/[()/]/g, "\\$&")}$`) });
const modo = (page: any, m: "por_hacer" | "hecho") => page.locator(`.odo-chart-card .odo-modo-btn[data-modo="${m}"]`);
/** El color con que se ve pintada una cara (el `fill` ya resuelto por el navegador). */
const colorCara = (page: any, fdi: number, cara: string) =>
  page.locator(`.odo-cell[data-fdi="${fdi}"] .odo-circle-wrap [data-cara="${cara}"]`).evaluate((el: Element) => getComputedStyle(el).fill);

/** Toca el icono del chip (el centro del dibujo), como una persona. */
async function elegir(page: any, pestana: string, chip: string) {
  await page.locator(".odo-palette .odo-tab", { hasText: pestana }).click();
  const c = chipPaleta(page, chip);
  await c.scrollIntoViewIfNeeded();
  const b = await c.locator(".odo-chip-ic svg > circle").first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  assert.match(await c.getAttribute("class"), / on( |$)/, `${chip} queda elegido`);
}
/** Con CAPTURAS=<carpeta>, una foto de la pantalla (para mirarla; la prueba no la compara). */
async function foto(page: any, nombre: string) {
  if (process.env.CAPTURAS) await page.screenshot({ path: join(process.env.CAPTURAS, `rojo-azul-${nombre}.png`), fullPage: true });
}
async function tocarCentro(page: any, fdi: number, dedo = false) {
  const el = page.locator(`.odo-cell[data-fdi="${fdi}"] .odo-circle-wrap svg`);
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (dedo) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test("con la columna: «Por hacer» pinta en ROJO en un toque; «Realizado» la pasa a AZUL (misma marca); previo; recargar; regresar desde el panel", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, puts, errores } = await abrir();
  try {
    await page.waitForSelector(".odo-chart-card .odo-modo");
    assert.equal(await modo(page, "por_hacer").getAttribute("aria-checked"), "true", "arranca en «Por hacer»");

    await elegir(page, "Restauradora", "Restauración (resina/amalgama)");
    assert.match(await page.locator(".odo-hint").innerText(), /Restauración \(resina\/amalgama\) · Por hacer/);
    await tocarCentro(page, 16);
    await esperar(() => estado().join() === "16:O:restoration:por_hacer", "la resina del 16 O queda por hacer");
    assert.equal(await colorCara(page, 16, "O"), ROJO);

    // Realizado: el mismo toque la pasa a azul, sin otra fila
    await modo(page, "hecho").click();
    await tocarCentro(page, 16);
    await esperar(() => estado().join() === "16:O:restoration:hecho", "la misma resina pasa a realizado");
    assert.equal(FILAS.length, 1);
    assert.equal(await colorCara(page, 16, "O"), AZUL);

    // De otra clínica (previo), en otra pieza
    await page.locator(".odo-chart-card [data-modo-previo]").check();
    await tocarCentro(page, 26);
    await esperar(() => estado().includes("26:O:restoration:previo"), "la del 26 queda como previo");
    assert.equal(await colorCara(page, 26, "O"), AZUL);
    // tocar la del 26 otra vez en el mismo modo la quita (como siempre)
    await tocarCentro(page, 26);
    await esperar(() => !estado().some((e) => e.startsWith("26:")), "mismo modo: la marca se quita");

    // Un hallazgo no lleva estado: se marca como siempre
    await modo(page, "por_hacer").click();
    await elegir(page, "Diagnóstico", "Caries");
    assert.match(await page.locator(".odo-hint").innerText(), /Caries \(hallazgo\)/);
    await tocarCentro(page, 36);
    await esperar(() => estado().includes("36:O:caries"), "la caries del 36 se guarda sin estado");

    await cargada(page); // recargar: lo guardado sigue con su color
    assert.equal(await colorCara(page, 16, "O"), AZUL);
    assert.notEqual(await colorCara(page, 36, "O"), "none");
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    const fila = page.locator('.odo-detail .odo-find[data-marca="O:restoration"]');
    assert.match(await fila.innerText(), /Realizado/);
    await fila.locator(".odo-find-estado").click(); // «Marcar por hacer»
    await esperar(() => estado().includes("16:O:restoration:por_hacer"), "desde el panel vuelve a por hacer");
    assert.match(await fila.innerText(), /Por hacer/);
    await page.locator(".odo-dt-close").click();
    assert.equal(await colorCara(page, 16, "O"), ROJO);
    await foto(page, "escritorio");

    // lo que viajó: el estado en cada PUT de la resina, ninguno en el de la caries
    assert.deepEqual(puts.map((p) => `${p.toothNumber}:${p.conditionId}:${p.estado ?? "-"}`), [
      "16:restoration:por_hacer", "16:restoration:hecho", "26:restoration:previo", "36:caries:-", "16:restoration:por_hacer",
    ]);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("sin la columna (SQL sin pegar): no hay selector y todo es como hoy", async (t) => {
  if (saltar) return t.skip(saltar);
  CON_COLUMNA = false;
  const { ctx, page, puts, errores } = await abrir();
  try {
    assert.equal(await page.locator(".odo-modo").count(), 0);
    await elegir(page, "Restauradora", "Restauración (resina/amalgama)");
    assert.doesNotMatch(await page.locator(".odo-hint").innerText(), /Por hacer|hallazgo/);
    await tocarCentro(page, 16);
    await esperar(() => estado().join() === "16:O:restoration", "se guarda como hoy");
    assert.equal(await colorCara(page, 16, "O"), RESTAURADORA, "el color de siempre");
    assert.equal(puts.length, 1);
    assert.equal("estado" in puts[0], false, "el PUT no lleva estado");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("en un teléfono (390 px): el selector se toca con el dedo y la página no se desborda a lo ancho", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await page.waitForSelector(".odo-chart-card .odo-modo");
    const ancho = () => page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]");
    let [sw, cw] = await ancho();
    assert.ok(sw <= cw, `sin scroll horizontal de la página (${sw} > ${cw})`);
    const b = await modo(page, "hecho").boundingBox();
    assert.ok(b.height >= 44, `botón cómodo para el dedo (${b.height} px)`);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    assert.equal(await modo(page, "hecho").getAttribute("aria-checked"), "true");
    assert.equal(await page.locator(".odo-chart-card [data-modo-previo]").count(), 1);
    [sw, cw] = await ancho();
    assert.ok(sw <= cw, `con «De otra clínica» tampoco (${sw} > ${cw})`);
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').tap();
    await page.waitForSelector(".odo-detail .odo-modo");
    await foto(page, "telefono-panel");
    const panel = await page.locator(".odo-detail").evaluate((el: Element) => [el.scrollWidth, el.clientWidth]);
    assert.ok(panel[0] <= panel[1], `el panel del diente no se desborda (${panel[0]} > ${panel[1]})`);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("v2 m1: lo de antes (sin color) cuenta como realizado: en «Realizado» tocarlo lo quita; en «Por hacer» lo pasa a rojo", async (t) => {
  if (saltar) return t.skip(saltar);
  // dos resinas guardadas antes de esto, sin estado
  FILAS = [
    { id: "v1", patientId: PACIENTE, toothNumber: 46, surface: "O", conditionId: "restoration", notes: null },
    { id: "v2", patientId: PACIENTE, toothNumber: 47, surface: "O", conditionId: "restoration", notes: "importada" },
  ];
  seq = 10;
  const { ctx, page, errores } = await abrir();
  try {
    await page.waitForSelector(".odo-chart-card .odo-modo");
    assert.equal(await colorCara(page, 46, "O"), RESTAURADORA, "lo de antes se ve como hoy");
    await elegir(page, "Restauradora", "Restauración (resina/amalgama)");
    // «Por hacer» (el de arranque): la del 47 pasa a rojo en un toque, con su nota
    await tocarCentro(page, 47);
    await esperar(() => estado().includes("47:O:restoration:por_hacer"), "la vieja del 47 pasa a por hacer");
    assert.equal(FILAS.find((f) => f.id === "v2")?.notes, "importada", "la nota no se pierde");
    assert.equal(await colorCara(page, 47, "O"), ROJO);
    // «Realizado»: tocar la vieja del 46 la quita, como siempre
    await modo(page, "hecho").click();
    await tocarCentro(page, 46);
    await esperar(() => !estado().some((e) => e.startsWith("46:")), "la vieja del 46 se quita");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});
