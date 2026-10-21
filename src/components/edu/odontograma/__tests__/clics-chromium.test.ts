/**
 * ws1-t11 · F1 en el Instituto — «el odontograma no registra hallazgos».
 *
 * Run: npm run test:odontograma-edu-clics
 *   (--experimental-test-module-mocks: GET/PUT de
 *   /api/instituto/pacientes/[id]/odontograma son las rutas REALES; se
 *   sustituyen Prisma —una tabla en memoria—, la sesión del instituto y la
 *   puerta del expediente clínico.)
 *
 * Es el mismo fallo que el dental arregló en 359026243, en la copia del
 * Instituto (src/components/edu/odontograma/). Reproducido el 21-oct-2026 en
 * el instituto de QA de panel.108 con clics reales: el icono de cada botón de
 * la paleta es un Surface2D en miniatura cuyas caras paran la propagación del
 * clic, así que un clic en el icono —el centro del botón— nunca llegaba al
 * botón: el hallazgo no se elegía y el clic en el diente abría el panel en vez
 * de marcar. En el panel, volver a tocar el hallazgo elegido lo APAGABA y la
 * cara siguiente no marcaba nada. Ninguna petición de guardado.
 *
 * Aquí se ejecuta con clics de verdad (Playwright: ratón y pantalla táctil,
 * nada de dispatchEvent) sobre la pantalla real empaquetada con esbuild.
 *
 * Playwright no es dependencia del repo: se busca en NAVEGADOR_DIR (o
 * ~/navegador). Sin él, la prueba se SALTA diciéndolo. `npm run test:edu`
 * también la descubre, pero corre sin --experimental-test-module-mocks:
 * ahí se salta y dice con qué script se corre.
 */
import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INSTITUTO = "inst_1";
const PACIENTE = "pat_1";
const RAIZ = process.cwd();
const ORIGEN = "http://edu-odo.prueba";
const RUTA = `/api/instituto/pacientes/${PACIENTE}/odontograma`;

interface Fila {
  id: string; institutionId: string; patientId: string; tooth: number; surface: string; condition: string;
  notes: string | null; recordedById: string; recordedAt: Date; firstRecordedAt: Date | null; createdAt: Date;
  updatedAt: Date; deletedAt: Date | null; deletedById: string | null;
}
let FILAS: Fila[] = [];
let seq = 0;
const PERSONA = { firstName: "Dra.", lastName: "Docente", email: "docente@prueba.test" };
/** Cada consulta lleva su tenant y su paciente; sin ellos, la prueba revienta. */
const coincide = (f: Fila, w: any): boolean => {
  if (w?.institutionId !== INSTITUTO || typeof w?.patientId !== "string") throw new Error("consulta de odontograma SIN institutionId/patientId");
  return Object.entries(w).every(([k, v]) => (v === null ? (f as any)[k] === null : (f as any)[k] === v));
};
const conRelaciones = (f: Fila) => ({ ...f, recordedBy: PERSONA, deletedBy: f.deletedById ? PERSONA : null });
const tabla: any = {
  findMany: async ({ where }: any) => FILAS.filter((f) => coincide(f, where)).map(conRelaciones),
  findUnique: async ({ where }: any) => FILAS.find((f) => coincide(f, where.institutionId_patientId_tooth_surface_condition)) ?? null,
  upsert: async ({ where, create, update }: any) => {
    const f = FILAS.find((x) => coincide(x, where.institutionId_patientId_tooth_surface_condition));
    if (f) { Object.assign(f, update, { updatedAt: new Date() }); return f; }
    const n: Fila = { id: `e${++seq}`, notes: null, createdAt: new Date(), updatedAt: new Date(), deletedById: null, ...create };
    FILAS.push(n);
    return n;
  },
  updateMany: async ({ where, data }: any) => {
    const fs = FILAS.filter((f) => coincide(f, where));
    fs.forEach((f) => Object.assign(f, data, { updatedAt: new Date() }));
    return { count: fs.length };
  },
};
const prismaFalso: any = {
  eduOdontogramEntry: tabla,
  eduOdontogramEvent: { create: async ({ data }: any) => data, findMany: async () => [] },
  $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(prismaFalso),
};
const ctx = {
  eduUserId: "u_doc", institutionId: INSTITUTO, role: "DOCENTE",
  institution: { id: INSTITUTO, timezone: "America/Mexico_City" },
  user: { id: "u_doc", ...PERSONA, mustChangePassword: false, permissionsOverride: null },
};

// `npm run test:edu` corre sin el flag de mocks: ahí no hay `mock.module`.
const sinMocks = typeof (mock as any).module !== "function";
if (!sinMocks) {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
  mock.module("@/lib/edu-auth", { namedExports: { getEduContext: async () => ctx } });
  mock.module("@/lib/edu/expediente", {
    namedExports: { getEduClinicalPatient: async (_c: unknown, pid: string) => (pid === PACIENTE ? { id: PACIENTE, isChild: false } : null) },
  });
}

const estado = () => FILAS.filter((f) => !f.deletedAt).map((f) => `${f.tooth}:${f.surface || "-"}:${f.condition}`).sort();

/* ---------------- la pantalla real, empaquetada para Chromium ---------------- */

const DOBLES: Record<string, string> = {
  "next/navigation": `export const useRouter = () => ({ refresh() {}, push() {}, replace() {} });
export const usePathname = () => "/instituto/pacientes/pat_1/odontograma";
export const useSearchParams = () => new URLSearchParams();`,
  // el panel del diente se carga con next/dynamic({ ssr: false }): aquí, React.lazy
  "next/dynamic": `import { lazy, Suspense, createElement } from "react";
export default function dynamic(cargar) {
  const L = lazy(() => cargar().then((m) => ({ default: m.default ?? m })));
  return (p) => createElement(Suspense, { fallback: null }, createElement(L, p));
}`,
};

async function empaquetar(): Promise<string> {
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [join(RAIZ, "src/components/edu/odontograma/__tests__/arnes-clics.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    tsconfig: join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    logLevel: "silent",
    plugins: [{
      name: "dobles",
      setup(b) {
        b.onResolve({ filter: /^next\/(navigation|dynamic)$/ }, (a) => ({ path: a.path, namespace: "doble" }));
        b.onLoad({ filter: /.*/, namespace: "doble" }, (a) => ({ contents: DOBLES[a.path], loader: "js", resolveDir: RAIZ }));
        // las hojas globales van enteras en un <style> de la página
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
  if (sinMocks) { saltar = "necesita --experimental-test-module-mocks: npm run test:odontograma-edu-clics"; return; }
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

/** Una pestaña: la página, el paquete y la ruta real del odontograma del Instituto. */
async function abrir(opts: Record<string, unknown> = {}, query = "") {
  const ruta = await import("@/app/api/instituto/pacientes/[id]/odontograma/route");
  const css = ["src/app/instituto/edu-theme.css", "src/components/edu/odontograma/odontogram.css"]
    .map((f) => readFileSync(join(RAIZ, f), "utf8")).join("\n");
  const ctxNav = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, ...opts });
  const escrituras: string[] = [];
  await ctxNav.route("**/*", async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin !== ORIGEN) return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: HTML(css) });
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    if (url.pathname === RUTA) {
      const metodo = r.method();
      const req = new Request(url.href, {
        method: metodo, headers: r.headers(),
        body: metodo === "GET" || metodo === "HEAD" ? undefined : r.postDataBuffer(),
      });
      const res: Response = await (ruta as any)[metodo](req, { params: Promise.resolve({ id: PACIENTE }) });
      if (metodo !== "GET") escrituras.push(`${metodo} ${res.status}`);
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctxNav.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  await page.goto(`${ORIGEN}/${query}`);
  await page.waitForSelector(".edu-odo .odo-cell");
  return { ctx: ctxNav, page, escrituras, errores };
}

async function recargar(page: any) {
  await page.reload();
  await page.waitForSelector(".edu-odo .odo-cell");
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
const marcado = (page: any) => page.locator(".edu-toolbar").innerText();

/**
 * Toca el ICONO del botón donde lo toca una persona: en medio del dibujo,
 * que es una cara del Surface2D en miniatura. Con ratón o con el dedo;
 * nunca dispatchEvent.
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

async function tocarCentro(page: any, sel: string, dedo = false) {
  const el = page.locator(sel);
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (dedo) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test("F1 Instituto: clic en el ICONO de «Caries» lo elige; clic en la cara O del 16 → se ve, se guarda solo y sigue tras recargar", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, escrituras, errores } = await abrir();
  try {
    const caries = chipPaleta(page, "Caries");
    await tocarIcono(page, caries);
    assert.ok(await elegido(caries), "Caries queda elegida al tocar su icono");
    assert.match(await page.locator(".edu-odo__saving").innerText(), /Caries — toca la cara o el diente/);

    await tocarCentro(page, '.odo-cell[data-fdi="16"] .odo-circle-wrap svg');
    await esperar(() => estado().includes("16:O:caries"), "la caries del 16 O se guarda sola");
    await esperar(() => escrituras.length === 1, "una escritura");
    assert.deepEqual(escrituras, ["PUT 200"]);
    assert.match(await marcado(page), /1 diente · 1 hallazgo/);
    assert.equal(await page.locator(".odo-detail").count(), 0, "marca, no abre el panel");

    await recargar(page);
    assert.match(await marcado(page), /1 diente · 1 hallazgo/);
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    await page.waitForSelector(".odo-detail");
    assert.match(await listaPanel(page), /Caries\s*O/);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("F1 Instituto: los pasos de Chrome en el panel del diente — 3D y 2D marcan, se guardan solos y siguen tras recargar", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, escrituras, errores } = await abrir();
  try {
    // sin hallazgo elegido, el panel lo dice (tocar una cara no marca nada)
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    await page.waitForSelector(".odo-detail");
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
    await tocarIcono(page, chipPanel(page, "Caries"));
    assert.ok(await elegido(chipPanel(page, "Caries")), "ni a la tercera");

    // 3D (escritorio abre en 3D): clic en una cara del diente del lienzo. El
    // del Instituto es el procedural de 5 parches; se busca uno pasando el
    // ratón, como una persona: encima de una cara el cursor es la mano.
    await page.locator(".odo-viewtab", { hasText: "3D" }).click();
    const canvas = page.locator(".odo-detail .odo-3d-stage canvas");
    await canvas.waitFor();
    await page.waitForTimeout(800); // primer cuadro de la escena
    const cb = await canvas.boundingBox();
    let punto: [number, number] | null = null;
    for (let fy = 0.3; fy <= 0.75 && !punto; fy += 0.05) {
      for (let fx = 0.3; fx <= 0.7 && !punto; fx += 0.05) {
        await page.mouse.move(cb.x + cb.width * fx, cb.y + cb.height * fy);
        if ((await canvas.evaluate((c: HTMLCanvasElement) => c.style.cursor)) === "pointer") punto = [cb.x + cb.width * fx, cb.y + cb.height * fy];
      }
    }
    assert.ok(punto, "el diente 3D tiene alguna cara bajo el ratón");
    await page.mouse.click(punto[0], punto[1]);
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
    if (cara3d !== "M") {
      await page.locator(".odo-detail .odo-surf-btn", { hasText: /^M/ }).click();
      await esperar(() => estado().includes("16:M:caries"), "el botón de la cara M se guarda");
    }
    const esperado = [...new Set([cara3d, cara2d, "M"])].map((c) => `16:${c}:caries`).sort();
    assert.deepEqual(estado(), esperado);
    assert.ok(escrituras.length === esperado.length && escrituras.every((e) => e === "PUT 200"), escrituras.join(","));

    await recargar(page); // lo guardado sigue
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    await page.waitForSelector(".odo-detail");
    const lista = await listaPanel(page);
    for (const c of new Set([cara3d, cara2d, "M"])) assert.match(lista, new RegExp(`Caries\\s*${c}`));
    assert.match(await marcado(page), new RegExp(`1 diente · ${esperado.length} hallazgos`));
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("F1 Instituto en tableta (pantalla táctil): tocar el icono de «Caries» y luego la cara la marca y se guarda", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, escrituras, errores } = await abrir({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
  try {
    const caries = chipPaleta(page, "Caries");
    await tocarIcono(page, caries, true);
    assert.ok(await elegido(caries), "el toque en el icono elige Caries");
    await tocarCentro(page, '.odo-cell[data-fdi="26"] .odo-circle-wrap svg', true);
    await esperar(() => estado().includes("26:O:caries"), "la caries del 26 O se guarda");
    assert.deepEqual(escrituras, ["PUT 200"]);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});

test("Instituto en solo lectura: el panel no pide elegir un hallazgo (manda el motivo) y no se escribe nada", async (t) => {
  if (saltar) return t.skip(saltar);
  const { ctx, page, escrituras, errores } = await abrir({}, "?lectura");
  try {
    assert.equal(await page.locator(".odo-palette").count(), 0, "sin permiso no hay paleta");
    await page.locator('.odo-cell[data-fdi="16"] .odo-num').click();
    await page.waitForSelector(".odo-detail");
    assert.equal(await page.locator(".odo-detail .odo-dt-pick").count(), 0, "en solo lectura no sale el aviso de elegir");
    assert.match(await page.locator(".odo-detail .odo-dt-locked").innerText(), /odontograma\.edit/);
    assert.ok(await chipPanel(page, "Caries").isDisabled(), "los hallazgos del panel siguen apagados");
    assert.deepEqual(escrituras, []);
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }
});
