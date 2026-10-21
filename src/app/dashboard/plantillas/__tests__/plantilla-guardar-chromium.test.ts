/**
 * Plantillas de punta a punta, con clics DE VERDAD en Chromium (la ola 1 del
 * editor de documentos unida: P1 editor + P2 saneador + P4 imágenes).
 *
 * Run: npm run test:plantillas-guardar-clics
 *   (Playwright se busca en NAVEGADOR_DIR o ~/navegador; sin él la prueba se
 *   SALTA diciéndolo, como `test:editor-documento-clics`.)
 *
 * El modal REAL de Plantillas se monta con el arnés del editor
 * (`editor-documento/__tests__/arnes-clics.tsx`). Lo que cambia aquí es el
 * otro lado de la red:
 *   · POST/PATCH /api/document-templates los contesta el SERVICIO real
 *     (`createTemplate` / `editarPlantillaConPrevias`, con el saneador nuevo y
 *     la clínica de la sesión) sobre una base en memoria, igual que la ruta;
 *   · la foto la sube `subirImagenDocumento` REAL (P4), que la comprime en el
 *     navegador; solo la ruta del servidor va doblada (no hay bucket aquí): se
 *     comprueba que lo que llega es una imagen ya comprimida y se contesta con
 *     una clave de la clínica de la sesión.
 * Nada sale del navegador ni toca ninguna base.
 *
 * Lo que fija: abrir, escribir, negrita, tabla, imagen (foto de cámara de
 * 3 MP) → Guardar → lo guardado es lo que dice el contrato (sin src, sin
 * style, clave de la clínica) → volver a abrir → el editor enseña lo mismo,
 * con la imagen pintada por su ruta, y guardar sin tocar no manda el texto.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTemplate, type TemplateDb } from "@/lib/document-templates/service";
import { editarPlantillaConPrevias, restaurableDe } from "@/lib/plantillas-fabrica/consentimiento";
import { rutaDeImagen } from "@/lib/documentos/imagenes";

const RAIZ = process.cwd();
const ORIGEN = "https://plantillas.prueba";
const CLINICA = "clinica_qa_prueba";
const CLAVE = `documentos/${CLINICA}/0123456789abcdef0123456789abcdef.webp`;

/* ─── la base en memoria (lo que usa el servicio, nada más) ───────────── */

type Fila = Record<string, any>;
let filas: Fila[] = [];
const db = {
  documentTemplate: {
    async findMany({ where }: any) {
      return filas.filter((f) => f.clinicId === where.clinicId && f.kind === where.kind && f.deletedAt === null).map((f) => ({ ...f }));
    },
    async findFirst({ where }: any) {
      const f = filas.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.deletedAt === null);
      return f ? { ...f } : null;
    },
    async create({ data }: any) {
      const f = { id: `tpl_${filas.length + 1}`, isActive: true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data };
      filas.push(f);
      return { ...f };
    },
    async update({ where, data }: any) {
      const f = filas.find((x) => x.id === where.id)!;
      Object.assign(f, data, { updatedAt: new Date() });
      return { ...f };
    },
    async updateMany({ where, data }: any) {
      const f = filas.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.body === where.body);
      if (!f) return { count: 0 };
      Object.assign(f, data, { updatedAt: new Date() });
      return { count: 1 };
    },
  },
} as unknown as TemplateDb;
const sinVersiones = { disponible: async () => false } as any;

/** Lo que contesta la ruta real: la fila, o `{ error, code }` con su estado. */
async function servidor(metodo: string, ruta: string, cuerpo: any): Promise<{ status: number; body: any }> {
  const r = metodo === "POST"
    ? await createTemplate(db, CLINICA, "u_qa", { kind: cuerpo.kind, name: cuerpo.name, body: cuerpo.body })
    : await editarPlantillaConPrevias(db, sinVersiones, CLINICA, ruta.split("/").pop()!, { name: cuerpo.name, body: cuerpo.body, baseBody: cuerpo.baseBody }, "u_qa");
  if (r.ok === false) return { status: r.status, body: { error: r.error, code: r.code } };
  return { status: metodo === "POST" ? 201 : 200, body: { ...r.template, restaurable: restaurableDe(r.template) } };
}

/* ─── el modal real, empaquetado para Chromium (como test:editor-documento-clics) ─ */

const AQUI = join(RAIZ, "src/components/dashboard/editor-documento");
const DOBLES: Record<string, string> = {
  "next/font/local": `export default () => ({ className: "", variable: "", style: {} });`,
  "@/i18n/i18n-provider": `
    import es from ${JSON.stringify(join(RAIZ, "src/i18n/dictionaries/es.json"))};
    const busca = (k) => k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), es);
    export const useT = () => (k, vars) => { let v = busca(k); if (typeof v !== "string") return k;
      for (const [a, b] of Object.entries(vars ?? {})) v = v.split("{" + a + "}").join(String(b)); return v; };
    export const useLocale = () => "es";`,
  "@/components/ui/confirm-dialog": `export const useConfirm = () => async () => true;`,
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
  return {
    js: r.outputFiles.find((f) => f.path.endsWith(".js"))!.text,
    css: r.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n"),
  };
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
/** Una foto «de cámara»: 2000 × 1500 de ruido, en JPEG (no se comprime casi nada por sí sola). */
let foto: Buffer = Buffer.alloc(0);

before(async () => {
  const ch = await cargarChromium();
  if (!ch) { saltar = "sin Playwright en NAVEGADOR_DIR / ~/navegador"; return; }
  const sharp = (await import("sharp")).default;
  const ancho = 2000, alto = 1500;
  const crudo = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < crudo.length; i++) crudo[i] = (i * 2654435761) >>> 24;
  foto = await sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  paquete = await empaquetar();
  navegador = await ch.launch();
});
after(async () => { await navegador?.close(); });

const HTML = (css: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}html,body{margin:0;background:#f7f6fb;font-family:system-ui,sans-serif}h1,h2,h3,p,ul,ol{margin:0;padding:0}ul,ol{list-style:none}
${css}</style></head><body><div id="root"></div><script src="/arnes.js"></script></body></html>`;

interface Red { guardados: { metodo: string; cuerpo: any }[]; subidas: { bytes: number; tipo: string }[]; imagenesPedidas: string[] }

async function abrir(editing: Fila | null) {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const red: Red = { guardados: [], subidas: [], imagenesPedidas: [] };
  const png = await (await import("sharp")).default({ create: { width: 640, height: 360, channels: 3, background: "#556" } }).png().toBuffer();
  await ctx.route("**/*", async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin !== ORIGEN) return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: HTML(paquete.css) });
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete.js });
    if (url.pathname.startsWith("/api/document-templates")) {
      const cuerpo = JSON.parse(r.postData() ?? "{}");
      red.guardados.push({ metodo: r.method(), cuerpo });
      const res = await servidor(r.method(), url.pathname, cuerpo);
      return route.fulfill({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
    }
    if (url.pathname === "/api/documentos/imagenes" && r.method() === "POST") {
      const cuerpo = r.postDataBuffer() as Buffer;
      const tipo = /Content-Type: (image\/[a-z]+)/.exec(cuerpo.toString("latin1"))?.[1] ?? "";
      red.subidas.push({ bytes: cuerpo.length, tipo });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ clave: CLAVE, ancho: 1600, alto: 1200 }) });
    }
    if (url.pathname.startsWith("/api/documentos/imagenes/")) {
      red.imagenesPedidas.push(url.pathname);
      return route.fulfill({ contentType: "image/png", body: png });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  page.on("console", (m: any) => { if (m.type() === "error") errores.push(m.text()); });
  const q = new URLSearchParams({ e: "modal", kind: "NOTA_EVOLUCION", ...(editing ? { editing: JSON.stringify(editing) } : {}) });
  await page.goto(`${ORIGEN}/?${q}`);
  await page.waitForSelector(".ProseMirror");
  return { ctx, page, errores, red };
}

async function esperar(cond: () => Promise<boolean>, que: string, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail(`no pasó: ${que}`);
}
const boton = (page: any, etiqueta: string) => page.locator(`[role="toolbar"] button[aria-label^="${etiqueta}"]`).first();

test("Plantillas: escribir, negrita, tabla y una foto de cámara → guardar con el saneador nuevo → volver a abrir igual", async (t) => {
  if (saltar) return t.skip(saltar);
  filas = [];
  const { ctx, page, errores, red } = await abrir(null);
  let guardada: Fila;
  try {
    await page.locator('input[aria-label="Nombre de la plantilla"]').fill("Control con radiografía");
    await page.locator(".ProseMirror").click();
    await page.keyboard.type("Control de resina en ");
    await page.keyboard.press("Control+b");
    await page.keyboard.type("16 MO");
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Enter");
    // tabla 2 × 2 desde la rejilla, con texto en la primera celda
    await boton(page, "Tabla").click();
    await page.waitForTimeout(60);
    await page.locator('[role="grid"] button[aria-label="2 × 2"]').click();
    await page.waitForTimeout(60);
    await page.keyboard.type("Pieza");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Plan");
    // la foto: el botón de imagen está porque el modal pasa la subida REAL de P4
    await page.locator(".ProseMirror p").first().click();
    await page.keyboard.press("End");
    const [selector] = await Promise.all([page.waitForEvent("filechooser"), boton(page, "Insertar imagen").click()]);
    await selector.setFiles({ name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: foto });
    await esperar(async () => (await page.locator(".ProseMirror img").count()) === 1, "la foto entró en la hoja");
    assert.equal(red.subidas.length, 1, "una sola subida");
    assert.ok(red.subidas[0].bytes < foto.length, `se subió comprimida (${red.subidas[0].bytes} < ${foto.length} bytes)`);
    assert.match(red.subidas[0].tipo, /^image\/(webp|jpeg)$/);
    assert.equal(await page.locator(".ProseMirror img").getAttribute("src"), rutaDeImagen(CLAVE));

    await page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await page.waitForSelector("#cerrado");
    assert.equal(red.guardados.length, 1);
    assert.equal(red.guardados[0].metodo, "POST");
    // Lo que el editor mandó ya va normalizado; lo que se GUARDÓ es lo que dejó el saneador del servidor.
    assert.equal(filas.length, 1);
    guardada = filas[0];
    assert.equal(guardada.clinicId, CLINICA);
    assert.equal(
      guardada.body,
      `<p>Control de resina en <strong>16 MO</strong></p><img data-archivo="${CLAVE}" data-ancho="medio" data-alineacion="centro" alt="">` +
        "<table><tbody><tr><th><p>Pieza</p></th><th><p>Plan</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><p></p>",
    );
    assert.ok(!/src=|style=|class=/.test(guardada.body), "sin src, style ni class en lo guardado");
    assert.equal((await page.evaluate(() => (window as any).__guardado))?.body, guardada.body, "la pantalla enseña lo que devolvió el servidor");
    assert.deepEqual(errores, []);
  } finally { await ctx.close(); }

  // Volver a abrir: el editor enseña exactamente lo guardado, con la foto pintada por su ruta.
  const editing = { ...guardada!, createdAt: String(guardada!.createdAt), updatedAt: String(guardada!.updatedAt), precargada: false, restaurable: false };
  const otra = await abrir(editing);
  try {
    await esperar(async () => (await otra.page.locator(".ProseMirror img").count()) === 1, "la foto vuelve");
    await esperar(async () => (await otra.page.locator(".ProseMirror img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)), "la foto se pinta");
    assert.equal(await otra.page.locator(".ProseMirror img").getAttribute("src"), rutaDeImagen(CLAVE));
    assert.ok(otra.red.imagenesPedidas.includes(rutaDeImagen(CLAVE)), "la pidió a la ruta de P4");
    assert.equal(await otra.page.locator(".ProseMirror table").count(), 1);
    assert.equal(await otra.page.locator(".ProseMirror strong").innerText(), "16 MO");
    // Guardar sin tocar el texto: solo viaja el nombre (Salamanca), y lo guardado no cambia.
    await otra.page.locator('input[aria-label="Nombre de la plantilla"]').fill("Control con Rx");
    await otra.page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await otra.page.waitForSelector("#cerrado");
    assert.equal(otra.red.guardados.length, 1);
    assert.equal(otra.red.guardados[0].metodo, "PATCH");
    assert.equal(otra.red.guardados[0].cuerpo.body, undefined, "sin tocar el texto no se manda el cuerpo");
    assert.equal(filas[0].name, "Control con Rx");
    assert.equal(filas[0].body, guardada!.body);
    assert.deepEqual(otra.errores, []);
  } finally { await otra.ctx.close(); }
});

test("Plantillas: una imagen de OTRA clínica pegada en el HTML no se guarda y el modal dice por qué", async (t) => {
  if (saltar) return t.skip(saltar);
  filas = [];
  const ajena = "documentos/otra_clinica/fedcba9876543210fedcba9876543210.webp";
  const fila = {
    id: "tpl_1", clinicId: CLINICA, kind: "NOTA_EVOLUCION", name: "Con foto ajena", isActive: true, createdById: "u_qa",
    body: `<p>Rx</p><img data-archivo="${ajena}" alt="">`, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
  filas.push({ ...fila, body: "<p>Rx</p>" });
  const { ctx, page, red } = await abrir({ ...fila, createdAt: String(fila.createdAt), updatedAt: String(fila.updatedAt), precargada: false, restaurable: false } as any);
  try {
    await page.locator(".ProseMirror p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" de control");
    await page.locator('button[type="submit"]', { hasText: "Guardar plantilla" }).click();
    await esperar(async () => red.guardados.length === 1, "se intentó guardar");
    await page.waitForSelector('[role="alert"]');
    // El arnés pinta `error:<json>`: el código es el que Plantillas traduce («…imagen de otra clínica…»).
    assert.match(await page.locator('[role="alert"]').innerText(), /IMAGEN_AJENA/);
    assert.equal(filas[0].body, "<p>Rx</p>", "lo guardado no cambió");
  } finally { await ctx.close(); }
});
