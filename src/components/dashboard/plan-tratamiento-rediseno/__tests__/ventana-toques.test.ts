/**
 * La META de la ventana rápida (ws1-t5, fase 2 · P3), medida en un Chromium de verdad: un plan de
 * 5 procedimientos en ≤ 10 toques, guardado como FILAS del contrato; y a 390 px sin scroll
 * horizontal. Los toques los cuenta la página (cada `pointerdown`), no la prueba.
 *
 * Playwright no es dependencia del repo: se busca en ~/navegador (`empaquetar-para-chromium.ts`).
 * Sin él, la prueba se SALTA diciéndolo. Con CAPTURAS=<carpeta> deja las fotos a 1440 y 390 px.
 *
 * Run: npm run test:plan-ventana-toques
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
  ["Profilaxis (limpieza)", 600, 30], ["Extracción simple", 800, 30], ["Restauración resina 1 cara", 700, 30],
  ["Restauración resina 2 caras", 900, 45], ["Restauración resina 3 caras", 1200, 60], ["Corona metal-porcelana", 4500, 60],
  ["Endodoncia multirradicular", 4500, 120], ["Consulta general", 400, 30],
].map(([name, basePrice, duration], i) => ({ id: `proc${i + 1}`, name, basePrice, duration, category: "dental", code: null, isActive: true }));

const ODONTOGRAMA = {
  entries: [
    { toothNumber: 16, surface: "M", conditionId: "caries" }, { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 26, surface: "O", conditionId: "caries" }, { toothNumber: 36, surface: null, conditionId: "pulpitis" },
    { toothNumber: 18, surface: null, conditionId: "ext_indicated" }, { toothNumber: 31, surface: "L", conditionId: "calculus" },
    { toothNumber: 41, surface: "L", conditionId: "calculus" }, { toothNumber: 46, surface: null, conditionId: "crown" },
  ],
};

interface Escenario { presentar: boolean; conFilas: boolean; idioma?: "es" | "en"; precarga?: unknown; esperar?: string }

async function abrir(chromium: { launch(o?: any): Promise<any> }, paquete: string, esc: Escenario, viewport: { width: number; height: number }) {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport });
  const css = sinGlobal(readFileSync(join(CARPETA, "plan.module.css"), "utf8"))
    + sinGlobal(readFileSync("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css", "utf8"));
  const posts: { url: string; cuerpo: any }[] = [];
  const pedidas: string[] = [];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body{margin:0}body{font-family:system-ui,sans-serif}${css}</style></head>
    <body><div id="raiz"></div><script>window.__IDIOMA__=${JSON.stringify(esc.idioma ?? "es")};window.__PRECARGA__=${JSON.stringify(esc.precarga ?? null) === "null" ? "undefined" : JSON.stringify(esc.precarga)};window.__TOQUES__=0;
    document.addEventListener("pointerdown",()=>{window.__TOQUES__++},true);</script><script src="/paquete.js"></script></body></html>`;
  await pagina.route("**/*", async (ruta: any) => {
    const req = ruta.request();
    const url = new URL(req.url());
    const json = (status: number, cuerpo: unknown) => ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify(cuerpo) });
    pedidas.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/") return ruta.fulfill({ status: 200, contentType: "text/html", body: html });
    if (url.pathname === "/paquete.js") return ruta.fulfill({ status: 200, contentType: "text/javascript", body: paquete });
    if (url.pathname === "/api/procedures") return json(200, TARIFARIO);
    if (url.pathname === "/api/odontogram") return json(200, ODONTOGRAMA);
    if (url.pathname === "/api/clinical") return json(200, [{ id: "mr1", assessment: "Caries múltiple en sector posterior; pulpitis irreversible en 36.", visitDate: "2026-10-12T16:00:00.000Z" }]);
    if (url.pathname.endsWith("/presentar")) {
      if (!esc.presentar) return ruta.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
      if (req.method() === "OPTIONS") return ruta.fulfill({ status: 204, body: "" });
      posts.push({ url: url.pathname, cuerpo: null });
      return json(200, { quoteId: "q1", folio: "P-0031", enlaceFirma: "/presupuesto/abc" });
    }
    if (url.pathname === "/api/treatments" && req.method() === "POST") {
      const cuerpo = JSON.parse(req.postData() ?? "{}");
      posts.push({ url: url.pathname, cuerpo });
      return json(201, { id: "plan-nuevo", name: cuerpo.name, ...(esc.conFilas ? { items: cuerpo.items } : {}) });
    }
    return ruta.fulfill({ status: 404, body: "" });
  });
  await pagina.goto("http://plan.prueba/");
  // Esperar a que lleguen tarifario y odontograma: el último chip es la limpieza de toda la boca.
  await pagina.waitForSelector(esc.esperar ?? '[data-chip="g:limpieza"]');
  return { navegador, pagina, posts, pedidas };
}

const CHIPS = ["h:36:pulpitis", "h:16:caries", "h:18:ext_indicated", "h:26:caries", "g:limpieza"];

test("un plan de 5 procedimientos en ≤ 10 toques, guardado como filas, y «Pronto» sin P4", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const { navegador, pagina, posts } = await abrir(chromium, paquete, { presentar: false, conFilas: true }, { width: 1440, height: 1000 });
  try {
    // Lo que viene solo: doctor de la sesión y «Plan <fecha>».
    assert.equal(await pagina.inputValue("#plan-doctor"), "doc1");
    assert.match(await pagina.inputValue("#plan-nombre"), /^Plan \d{1,2} [a-z]{3} \d{4}$/);
    // Sin P4 el botón de presentar dice «Pronto» y no se puede tocar.
    await pagina.waitForSelector("[data-plan-presentar]:disabled");
    assert.match(await pagina.textContent("[data-plan-presentar]") ?? "", /Pronto/);
    // NO se piden sesiones, días entre sesiones ni costo.
    for (const id of ["#plan-sesiones", "#plan-intervalo", "#plan-costo"]) assert.equal(await pagina.$(id), null, `${id} no debería existir`);

    for (const c of CHIPS) await pagina.click(`[data-chip="${c}"]`);
    assert.equal(await pagina.locator("[data-renglon]").count(), 5);
    assert.equal(await pagina.textContent("[data-plan-total]"), "$7,500");
    if (process.env.CAPTURAS) {
      mkdirSync(process.env.CAPTURAS, { recursive: true });
      await pagina.screenshot({ path: join(process.env.CAPTURAS, "ventana-1440.png") });
    }
    await pagina.click("[data-plan-guardar]");
    await pagina.waitForFunction(() => (window as any).__GUARDADO__);

    const toques = await pagina.evaluate(() => (window as any).__TOQUES__);
    assert.ok(toques <= 10, `se necesitaron ${toques} toques`);
    assert.equal(toques, 6, "5 chips + Guardar");

    assert.equal(posts.length, 1);
    const cuerpo = posts[0].cuerpo;
    assert.deepEqual(
      { totalSessions: cuerpo.totalSessions, sessionIntervalDays: cuerpo.sessionIntervalDays, totalCost: cuerpo.totalCost, doctorId: cuerpo.doctorId },
      { totalSessions: 5, sessionIntervalDays: 30, totalCost: 7500, doctorId: "doc1" },
    );
    assert.match(cuerpo.description, /Endodoncia multirradicular — 36/, "el texto del plan sigue yendo (planes sin SQL)");
    const filas = leerFilas(cuerpo.items);
    assert.equal(filas.ok, true);
    assert.deepEqual(filas.filas!.map((f) => [f.fase, f.nombre, f.precioCentavos, f.procedureId]), [
      ["urgencia", "Endodoncia multirradicular", 450000, "proc7"],
      ["higienica", "Restauración resina 2 caras", 90000, "proc4"],
      ["higienica", "Extracción simple", 80000, "proc2"],
      ["higienica", "Restauración resina 1 cara", 70000, "proc3"],
      ["higienica", "Profilaxis (limpieza)", 60000, "proc1"],
    ]);
  } finally {
    await navegador.close();
  }
});

test("«Guardar y presentar» con P4: guarda, presenta y avisa el folio", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const { navegador, pagina, posts } = await abrir(chromium, paquete, { presentar: true, conFilas: false }, { width: 1440, height: 1000 });
  try {
    await pagina.waitForSelector("[data-plan-presentar]:not(:disabled)");
    await pagina.click('[data-chip="h:36:pulpitis"]');
    // La corona sugerida aparece al poner la endodoncia, en un toque más.
    await pagina.click('[data-chip="e:corona:36"]');
    await pagina.click("[data-plan-presentar]");
    await pagina.waitForFunction(() => (window as any).__GUARDADO__);
    assert.deepEqual(posts.map((p) => p.url), ["/api/treatments", "/api/treatments/plan-nuevo/presentar"]);
    assert.equal(posts[0].cuerpo.items.length, 2);
    await pagina.waitForSelector("text=P-0031");
  } finally {
    await navegador.close();
  }
});

test("a 390 px: sin scroll horizontal, con el plan armado y los detalles abiertos", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const { navegador, pagina } = await abrir(chromium, paquete, { presentar: false, conFilas: true }, { width: 390, height: 844 });
  try {
    for (const c of CHIPS) await pagina.click(`[data-chip="${c}"]`);
    const desborde = async () => pagina.evaluate(() => {
      const caja = document.querySelector("[data-plan-nuevo]") as HTMLElement;
      const cuerpo = caja.querySelector(":scope > div") as HTMLElement | null;
      // Por los DOS lados: un pie alineado a la derecha se sale por la izquierda.
      const marco = caja.getBoundingClientRect();
      const fuera = [...caja.querySelectorAll<HTMLElement>("*")]
        .filter((e) => {
          if (e.getClientRects().length === 0) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.right > marco.right + 0.5 || r.left < marco.left - 0.5);
        })
        .map((e) => `${e.tagName.toLowerCase()}.${e.className}`).slice(0, 5);
      return {
        documento: document.documentElement.scrollWidth - window.innerWidth,
        caja: caja.scrollWidth - caja.clientWidth,
        cuerpo: cuerpo ? cuerpo.scrollWidth - cuerpo.clientWidth : 0,
        fuera,
      };
    });
    if (process.env.CAPTURAS) await pagina.screenshot({ path: join(process.env.CAPTURAS, "ventana-390.png") });
    assert.deepEqual(await desborde(), { documento: 0, caja: 0, cuerpo: 0, fuera: [] });
    await pagina.click("[aria-controls='plan-detalles']");
    assert.match(await pagina.inputValue("#plan-diagnostico"), /pulpitis irreversible en 36/, "diagnóstico de la última consulta");
    await pagina.locator("#plan-diagnostico").scrollIntoViewIfNeeded();
    if (process.env.CAPTURAS) await pagina.screenshot({ path: join(process.env.CAPTURAS, "ventana-390-detalles.png") });
    assert.deepEqual(await desborde(), { documento: 0, caja: 0, cuerpo: 0, fuera: [] });
  } finally {
    await navegador.close();
  }
});

test("desde la Nueva consulta (P9): chips de ESA consulta, su diagnóstico y su pronóstico, sin releer nada", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-ventana.tsx`);
  const precarga = {
    // Lo que el doctor marcó en la consulta y aún NO guardó: 11 con caries incisal y mesial, 36 con pulpitis.
    entradas: [
      { toothNumber: 11, surface: "O", conditionId: "caries" }, { toothNumber: 11, surface: "M", conditionId: "caries" },
      { toothNumber: 36, surface: null, conditionId: "pulpitis" },
    ],
    diagnostico: "Pulpitis irreversible en 36; caries en 11.",
    pronostico: "bueno",
  };
  const { navegador, pagina, pedidas, posts } = await abrir(chromium, paquete, { presentar: false, conFilas: true, precarga, esperar: '[data-chip="h:36:pulpitis"]' }, { width: 1440, height: 1000 });
  try {
    // Los chips son los de la consulta (no los del odontograma guardado: ahí no hay 11).
    assert.deepEqual(await pagina.locator("[data-chip]").evaluateAll((els) => els.map((e) => e.getAttribute("data-chip"))), ["h:36:pulpitis", "h:11:caries"]);
    // No se releyó el odontograma ni la última consulta.
    assert.ok(!pedidas.some((p) => p.includes("/api/odontogram") || p.includes("/api/clinical")), pedidas.join(" | "));
    await pagina.click('[data-chip="h:36:pulpitis"]');
    await pagina.click('[data-chip="h:11:caries"]');
    await pagina.click("[aria-controls='plan-detalles']");
    assert.equal(await pagina.inputValue("#plan-diagnostico"), "Pulpitis irreversible en 36; caries en 11.");
    // Pronóstico una sola vez: se enseña el de la consulta y no hay selector.
    assert.equal(await pagina.$("#plan-pronostico"), null);
    assert.equal((await pagina.textContent("[data-plan-pronostico-de-consulta]"))?.trim(), "Bueno");
    if (process.env.CAPTURAS) {
      await pagina.locator("#plan-diagnostico").scrollIntoViewIfNeeded();
      await pagina.screenshot({ path: join(process.env.CAPTURAS, "consulta-armar-plan-1440.png") });
    }
    await pagina.click("[data-plan-guardar]");
    await pagina.waitForFunction(() => (window as any).__GUARDADO__);
    const cuerpo = posts[0].cuerpo;
    assert.match(cuerpo.description, /Pronóstico: Bueno/);
    assert.deepEqual(cuerpo.items.map((f: any) => [f.nombre, f.dientes.join(","), f.caras.join("")]), [
      ["Endodoncia multirradicular", "36", ""],
      ["Restauración resina 2 caras", "11", "MO"],
    ]);
  } finally {
    await navegador.close();
  }
});
