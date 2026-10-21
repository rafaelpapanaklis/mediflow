/**
 * ws1-t11 · QA de Chrome F1 — «el odontograma no registra hallazgos».
 *
 * Run: npm run test:odontograma-clics
 *   (--experimental-test-module-mocks: GET/PUT/DELETE de /api/odontogram son
 *   las rutas REALES; se sustituyen Prisma —una tabla en memoria—, la sesión,
 *   la auditoría y la suplantación.)
 *
 * Qué pasaba (panel.108, 20-oct-2026): el icono de cada botón de la paleta es
 * un Surface2D en miniatura cuyas caras paran la propagación del clic. Un
 * clic en el icono —el centro del botón, lo que toca cualquiera con ratón o
 * con el dedo— nunca llegaba al botón: el hallazgo no se elegía y luego el
 * clic en el diente abría el panel en vez de marcar. Además, en el panel del
 * diente volver a tocar el hallazgo ya elegido lo APAGABA, y la cara
 * siguiente no marcaba nada. Ninguna petición de guardado.
 *
 * Aquí se ejecuta con clics de verdad (Playwright: ratón y pantalla táctil,
 * nada de dispatchEvent) sobre el componente real empaquetado con esbuild:
 * paleta → cara, y panel del diente en 3D y en 2D → el hallazgo aparece, se
 * guarda solo y sigue ahí tras recargar.
 *
 * Playwright no es dependencia del repo: se busca en NAVEGADOR_DIR (o
 * ~/navegador). Sin él, la prueba se SALTA diciéndolo.
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

interface Fila { id: string; patientId: string; toothNumber: number; surface: string | null; conditionId: string; notes: string | null }
let FILAS: Fila[] = [];
let seq = 0;
const coincide = (f: Fila, w: any): boolean => {
  if (typeof w?.patientId !== "string" || !w.patientId) throw new Error("consulta de odontograma SIN patientId");
  if (f.patientId !== w.patientId) return false;
  if (w.toothNumber !== undefined && f.toothNumber !== w.toothNumber) return false;
  if ("surface" in w && f.surface !== w.surface) return false;
  if (typeof w.conditionId === "string" && f.conditionId !== w.conditionId) return false;
  if (w.conditionId?.not && f.conditionId === w.conditionId.not) return false;
  return true;
};
const tabla: any = {
  findMany: async ({ where }: any) => FILAS.filter((f) => coincide(f, where)).map((f) => ({ ...f, updatedAt: new Date() })),
  findFirst: async ({ where }: any) => { const f = FILAS.find((x) => coincide(x, where)); return f ? { id: f.id } : null; },
  deleteMany: async ({ where }: any) => { const n = FILAS.length; FILAS = FILAS.filter((f) => !coincide(f, where)); return { count: n - FILAS.length }; },
  create: async ({ data }: any) => { const f = { id: `e${++seq}`, notes: null, ...data }; FILAS.push(f); return f; },
  update: async ({ where, data }: any) => { const f = FILAS.find((x) => x.id === where.id)!; Object.assign(f, data); return f; },
  upsert: async ({ where, create, update }: any) => {
    const f = FILAS.find((x) => coincide(x, where.patientId_toothNumber_surface_conditionId));
    if (f) { Object.assign(f, update); return f; }
    const n = { id: `e${++seq}`, notes: null, ...create }; FILAS.push(n); return n;
  },
};
const prismaFalso: any = {
  odontogramEntry: tabla,
  auditLog: { create: async ({ data }: any) => data },
  $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(prismaFalso),
  $executeRaw: async () => 1,
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

const estado = () => FILAS.map((f) => `${f.toothNumber}:${f.surface ?? "-"}:${f.conditionId}`).sort();

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
        // la hoja global del odontograma va entera en un <style> de la página
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
  // SwiftShader: WebGL sin GPU para la vista 3D
  navegador = await ch.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
});
after(async () => { await navegador?.close(); });
beforeEach(() => { FILAS = []; seq = 0; });

const HTML = (css: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body style="margin:0"><div id="root"></div><script src="/arnes.js"></script></body></html>`;

/** Una pestaña: la página, el paquete, los .glb de public/ y las rutas reales. */
async function abrir(opts: Record<string, unknown> = {}) {
  const { NextRequest } = await import("next/server");
  const raiz = await import("@/app/api/odontogram/route");
  const css = readFileSync(join(RAIZ, "src/components/dashboard/odontogram-v2/odontogram.css"), "utf8");
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, ...opts });
  const escrituras: string[] = [];
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
      const req = new NextRequest(url.href, {
        method: metodo, headers: r.headers(),
        body: metodo === "GET" || metodo === "HEAD" ? undefined : r.postDataBuffer(),
      } as any);
      const res: Response = await (raiz as any)[metodo](req);
      if (metodo !== "GET") escrituras.push(`${metodo} ${res.status}`);
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  await cargada(page);
  return { ctx, page, escrituras, errores };
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

const chipPaleta = (page: any, nombre: string) => page.locator(".odo-palette .odo-chip", { hasText: new RegExp(`^${nombre}$`) });
const chipPanel = (page: any, nombre: string) => page.locator(".odo-detail .odo-dt-pal .odo-chip", { hasText: new RegExp(`^${nombre}$`) });
const elegido = async (chip: any) => / on( |$)/.test(await chip.getAttribute("class"));
const listaPanel = (page: any) => page.locator(".odo-detail .odo-find-list").innerText();

/**
 * Toca el ICONO del botón donde lo toca una persona: en medio del dibujo,
 * que es una cara del Surface2D en miniatura (se comprueba). Con ratón o con
 * el dedo; nunca dispatchEvent.
 */
async function tocarIcono(page: any, chip: any, dedo = false) {
  await chip.scrollIntoViewIfNeeded();
  // la cara central (O) del dibujo: el primer <circle> del Surface2D
  const cara = await chip.locator(".odo-chip-ic svg > circle").first().boundingBox();
  const x = cara.x + cara.width / 2, y = cara.y + cara.height / 2;
  assert.ok(cara.width > 4, "el icono tiene su cara central");
  if (dedo) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

test("F1: clic en el ICONO del botón «Caries» lo elige; clic en la cara O del 16 → se ve, se guarda solo y sigue tras recargar", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, escrituras, errores } = await abrir();
  try {
    const caries = chipPaleta(page, "Caries");
    await tocarIcono(page, caries);
    assert.ok(await elegido(caries), "Caries queda elegida al tocar su icono");
    assert.match(await page.locator(".odo-hint").innerText(), /Caries/);

    const circulo = await page.locator('.odo-cell[data-fdi="16"] .odo-circle-wrap svg').boundingBox();
    await page.mouse.click(circulo.x + circulo.width / 2, circulo.y + circulo.height / 2);
    await esperar(() => estado().includes("16:O:caries"), "la caries del 16 O se guarda sola");
    assert.match(await page.locator(".odo-summary").innerText(), /1\s*dientes[\s\S]*1\s*hallazgos/);
    assert.deepEqual(escrituras, ["PUT 200"]);
    assert.equal(await page.locator(".odo-detail").count(), 0, "marca, no abre el panel");

    await cargada(page); // recargar
    assert.match(await page.locator(".odo-summary").innerText(), /1\s*dientes[\s\S]*1\s*hallazgos/);
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    assert.match(await listaPanel(page), /Caries\s*O/);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("F1: los pasos de Chrome en el panel del diente — 3D y 2D marcan, se guardan solos y siguen tras recargar", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, escrituras, errores } = await abrir();
  try {
    // el panel abre en 3D (escritorio) y pide el modelo del 16 al abrirse
    const glb = page.waitForResponse((r: any) => /\/16\.glb/.test(r.url()));
    // sin hallazgo elegido, el panel lo dice (tocar una cara no marca nada)
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    assert.match(await page.locator(".odo-detail").innerText(), /Elige un hallazgo abajo y luego toca la cara/);
    await page.locator(".odo-dt-close").click();

    // 1-3: «Caries» en la paleta y clic en el diente 16 → se abre el panel
    await tocarIcono(page, chipPaleta(page, "Caries"));
    assert.ok(await elegido(chipPaleta(page, "Caries")));
    await page.locator('.odo-cell[data-fdi="16"] .odo-glyph-wrap').click();
    await page.waitForSelector(".odo-detail");
    assert.equal(await page.locator(".odo-detail .odo-dt-pick").count(), 0, "con hallazgo elegido no sale el aviso");
    // 4: en el panel, «Caries» otra vez: sigue elegida (antes la apagaba)
    await tocarIcono(page, chipPanel(page, "Caries"));
    assert.ok(await elegido(chipPanel(page, "Caries")), "volver a tocar Caries en el panel no la apaga");

    // 3D: clic en el diente del lienzo
    await page.locator(".odo-viewtab", { hasText: "3D" }).click();
    const canvas = page.locator(".odo-detail .odo-3d-stage canvas");
    await canvas.waitFor();
    await glb;
    await page.waitForTimeout(1500); // el modelo se monta en la escena
    const cb = await canvas.boundingBox();
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await esperar(() => estado().some((e) => /^16:[MDVLO]:caries$/.test(e)), "el clic en 3D guarda una cara del 16");
    const cara3d = estado().find((e) => e.startsWith("16:"))!.split(":")[1];
    assert.match(await listaPanel(page), new RegExp(`Caries\\s*${cara3d}`));

    // 2D: una cara distinta (centro = O; si el 3D ya marcó O, la de arriba = V)
    await page.locator(".odo-viewtab", { hasText: "2D" }).click();
    const s2 = await page.locator(".odo-detail .odo-2d-stage svg").boundingBox();
    const cara2d = cara3d === "O" ? "V" : "O";
    await page.mouse.click(s2.x + s2.width / 2, s2.y + (cara2d === "O" ? s2.height / 2 : s2.height * 0.12));
    await esperar(() => estado().includes(`16:${cara2d}:caries`), "el clic en 2D se guarda");
    // y con los botones de caras, la M
    await page.locator(".odo-detail .odo-surf-btn", { hasText: /^M/ }).click();
    await esperar(() => estado().includes("16:M:caries") || cara3d === "M", "el botón de la cara M se guarda");
    const esperado = [...new Set([cara3d, cara2d, "M"])].map((c) => `16:${c}:caries`).sort();
    assert.deepEqual(estado(), esperado);
    assert.ok(escrituras.every((e) => e === "PUT 200"), escrituras.join(","));

    await cargada(page); // recargar: lo guardado sigue
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    const lista = await listaPanel(page);
    for (const c of new Set([cara3d, cara2d, "M"])) assert.match(lista, new RegExp(`Caries\\s*${c}`));
    assert.match(await page.locator(".odo-summary").innerText(), new RegExp(`${esperado.length}\\s*hallazgos`));
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("F1 en tableta (pantalla táctil): tocar el icono de «Caries» y luego la cara la marca y se guarda", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, errores } = await abrir({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
  try {
    const caries = chipPaleta(page, "Caries");
    await tocarIcono(page, caries, true);
    assert.ok(await elegido(caries), "el toque en el icono elige Caries");
    const c = page.locator('.odo-cell[data-fdi="26"] .odo-circle-wrap svg');
    await c.scrollIntoViewIfNeeded();
    const cb = await c.boundingBox();
    await page.touchscreen.tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await esperar(() => estado().includes("26:O:caries"), "la caries del 26 O se guarda");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});
