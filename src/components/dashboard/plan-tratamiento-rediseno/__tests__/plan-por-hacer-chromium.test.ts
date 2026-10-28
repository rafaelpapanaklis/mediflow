/**
 * ws1-t6 · decisión 2 de Rafael (28-oct): lo marcado EN ROJO en el odontograma alimenta el plan nuevo.
 * Cada marca roja sale en la ventana «Nuevo plan» como «Resina · pieza 16 oclusal · $700», con el
 * precio del tarifario de la clínica, lista para agregar (una a una o «Agregar todo»). Medido en un
 * Chromium de verdad con la ventana real (`arnes-ventana.tsx`); cada fetch lo contesta la prueba.
 *
 * Playwright no es dependencia del repo: se busca en ~/navegador. Sin él, la prueba se SALTA.
 * Con CAPTURAS=<carpeta> deja las fotos a 1440 y 390 px.
 *
 * Run: npm run test:odontograma-rojo-azul
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cargarChromium, empaquetar } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";
import { leerFilas } from "@/lib/treatments/items";

const CARPETA = "src/components/dashboard/plan-tratamiento-rediseno";
const sinGlobal = (css: string) => css.replace(/:global\(([^)]*)\)/g, "$1");

const TARIFARIO = [
  ["Restauración resina 1 cara", 700, 30], ["Restauración resina 2 caras", 900, 45],
  ["Corona metal-porcelana", 4500, 60], ["Endodoncia multirradicular", 4500, 120],
].map(([name, basePrice, duration], i) => ({ id: `proc${i + 1}`, name, basePrice, duration, category: "dental", code: null, isActive: true }));

/** El odontograma del paciente: dos marcas ROJAS, una azul, una de antes y dos hallazgos. */
const ODONTOGRAMA = {
  conEstado: true,
  entries: [
    { toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" },
    { toothNumber: 16, surface: "O", conditionId: "caries" },                          // ya lo pide la resina roja
    { toothNumber: 26, surface: null, conditionId: "crown", estado: "por_hacer" },
    { toothNumber: 46, surface: null, conditionId: "crown", estado: "hecho" },         // azul: no
    { toothNumber: 47, surface: "O", conditionId: "restoration" },                     // de antes: no
    { toothNumber: 36, surface: null, conditionId: "pulpitis" },                       // hallazgo: chip de siempre
  ],
};

/** Planes del paciente que contesta `GET /api/treatments?patientId=` (v2, M1). */
let PLANES: unknown[] = [];

async function abrir(chromium: { launch(o?: any): Promise<any> }, paquete: string, viewport: { width: number; height: number }, idioma: "es" | "en" = "es") {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport });
  const css = sinGlobal(readFileSync(join(CARPETA, "plan.module.css"), "utf8"))
    + sinGlobal(readFileSync("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css", "utf8"));
  const posts: any[] = [];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body{margin:0}body{font-family:system-ui,sans-serif}:root{--danger:#dc2626;--danger-soft:rgba(220,38,38,.1)}${css}</style></head>
    <body><div id="raiz"></div><script>window.__IDIOMA__=${JSON.stringify(idioma)};</script><script src="/paquete.js"></script></body></html>`;
  await pagina.route("**/*", async (ruta: any) => {
    const req = ruta.request();
    const url = new URL(req.url());
    const json = (status: number, cuerpo: unknown) => ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify(cuerpo) });
    if (url.pathname === "/") return ruta.fulfill({ status: 200, contentType: "text/html", body: html });
    if (url.pathname === "/paquete.js") return ruta.fulfill({ status: 200, contentType: "text/javascript", body: paquete });
    if (url.pathname === "/api/procedures") return json(200, TARIFARIO);
    if (url.pathname === "/api/odontogram") return json(200, ODONTOGRAMA);
    if (url.pathname === "/api/clinical") return json(200, []);
    if (url.pathname.endsWith("/presentar")) return ruta.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
    if (url.pathname === "/api/treatments" && req.method() === "GET") return json(200, PLANES);
    if (url.pathname === "/api/treatments" && req.method() === "POST") {
      const cuerpo = JSON.parse(req.postData() ?? "{}");
      posts.push(cuerpo);
      return json(201, { id: "plan-nuevo", name: cuerpo.name, items: cuerpo.items });
    }
    return ruta.fulfill({ status: 404, body: "" });
  });
  await pagina.goto("http://plan.prueba/");
  // con tarifario: el chip rojo ya trae su precio (o, si ya está en otro plan, lo dice)
  try {
    await pagina.waitForFunction(() => /\$700|ya en el plan|already in plan/.test(document.querySelector('[data-chip="r:h:16:restoration"]')?.textContent ?? ""));
  } catch (e) {
    await navegador.close(); // sin esto el proceso de la prueba se queda colgado
    throw e;
  }
  return { navegador, pagina, posts };
}

const texto = async (pagina: any, sel: string) => ((await pagina.textContent(sel)) ?? "").replace(/\s+/g, " ").trim();
/** Lo que se lee en un chip: sus partes, separadas como se ven (el hueco lo pone el `gap`). */
const chip = async (pagina: any, clave: string) =>
  (await pagina.locator(`[data-chip="${clave}"] > span`).allTextContents()).map((x: string) => x.trim()).join(" ");

test("cada marca roja sale con su procedimiento, la pieza, la cara y el precio de la clínica; «Agregar todo» las pone", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const { navegador, pagina, posts } = await abrir(chromium, paquete, { width: 1440, height: 1000 });
  try {
    assert.equal(await chip(pagina, "r:h:16:restoration"), "Restauración resina 1 cara · pieza 16 oclusal · $700");
    assert.equal(await chip(pagina, "r:h:26:crown"), "Corona metal-porcelana · pieza 26 · $4,500");
    assert.equal(await pagina.locator("[data-plan-por-hacer] [data-chip]").count(), 2, "ni la azul ni la de antes");
    // la caries del 16 no propone otra resina; la pulpitis del 36 sí sale, como siempre
    assert.equal(await pagina.locator('[data-chip="h:16:caries"]').count(), 0);
    assert.equal(await pagina.locator('[data-chip="h:36:pulpitis"]').count(), 1);

    await pagina.click("[data-agregar-por-hacer]");
    assert.equal(await pagina.locator("[data-renglon]").count(), 2);
    assert.equal(await pagina.textContent("[data-plan-total]"), "$5,200");
    assert.equal(await pagina.locator("[data-agregar-por-hacer]").count(), 0, "ya no queda nada por agregar");
    assert.ok(await pagina.locator('[data-chip="r:h:16:restoration"]').isDisabled(), "el chip queda puesto");
    if (process.env.CAPTURAS) {
      mkdirSync(process.env.CAPTURAS, { recursive: true });
      await pagina.screenshot({ path: join(process.env.CAPTURAS, "plan-por-hacer-1440.png") });
    }

    await pagina.click("[data-plan-guardar]");
    await pagina.waitForFunction(() => (window as any).__GUARDADO__);
    const filas = leerFilas(posts[0].items);
    assert.equal(filas.ok, true);
    assert.deepEqual(filas.filas!.map((f) => [f.fase, f.nombre, f.dientes, f.caras, f.precioCentavos, f.motivo]), [
      ["higienica", "Restauración resina 1 cara", [16], ["O"], 70000, "Marcado por hacer en el odontograma"],
      ["restauradora", "Corona metal-porcelana", [26], [], 450000, "Marcado por hacer en el odontograma"],
    ]);
  } finally {
    await navegador.close();
  }
});

test("a 390 px y en inglés: sin scroll horizontal; «tooth 16 occlusal»", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const { navegador, pagina } = await abrir(chromium, paquete, { width: 390, height: 844 }, "en");
  try {
    assert.equal(await chip(pagina, "r:h:16:restoration"), "Restauración resina 1 cara · tooth 16 occlusal · $700");
    assert.match(await texto(pagina, "[data-plan-por-hacer] h4"), /Marked to do on the dental chart/);
    const desborde = await pagina.evaluate(() => {
      const caja = document.querySelector("[data-plan-nuevo]") as HTMLElement;
      return { documento: document.documentElement.scrollWidth - window.innerWidth, caja: caja.scrollWidth - caja.clientWidth };
    });
    if (process.env.CAPTURAS) await pagina.screenshot({ path: join(process.env.CAPTURAS, "plan-por-hacer-390.png") });
    assert.deepEqual(desborde, { documento: 0, caja: 0 });
  } finally {
    await navegador.close();
  }
});

test("v2 M1: lo rojo que ya está en otro plan activo sale «ya en el plan X», no se toca y «Agregar todo» lo salta", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const fila = (id: string, nombre: string, dientes: number[]) =>
    ({ id, planId: "plan-1", nombre, procedureId: "proc1", dientes, caras: ["O"], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: null });
  PLANES = [
    { id: "plan-1", name: "Plan 20 oct 2026", status: "ACTIVE", items: [fila("f1", "Restauración resina 1 cara", [16])] },
    // uno cerrado no cuenta
    { id: "plan-0", name: "Plan viejo", status: "ABANDONED", items: [fila("f0", "Corona metal-porcelana", [26])] },
  ];
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const { navegador, pagina } = await abrir(chromium, paquete, { width: 1440, height: 1000 });
  try {
    await pagina.waitForSelector('[data-chip="r:h:16:restoration"][data-en-otro-plan]');
    assert.equal(await chip(pagina, "r:h:16:restoration"), "Restauración resina 1 cara · pieza 16 oclusal · ya en el plan «Plan 20 oct 2026»");
    assert.ok(await pagina.locator('[data-chip="r:h:16:restoration"]').isDisabled());
    assert.equal(await pagina.locator('[data-chip="r:h:26:crown"][data-en-otro-plan]').count(), 0, "el plan cancelado no tapa la corona");
    await pagina.click("[data-agregar-por-hacer]");
    assert.equal(await pagina.locator("[data-renglon]").count(), 1, "solo la corona");
    assert.equal(await pagina.textContent("[data-plan-total]"), "$4,500");
    if (process.env.CAPTURAS) await pagina.screenshot({ path: join(process.env.CAPTURAS, "plan-por-hacer-ya-en-plan.png") });
  } finally {
    PLANES = [];
    await navegador.close();
  }
});
