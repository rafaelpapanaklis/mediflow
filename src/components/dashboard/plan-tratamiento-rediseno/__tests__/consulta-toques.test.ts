/**
 * P9 en un Chromium de verdad (ws1-t5, fase 2): la Nueva consulta dental (`DentalForm` real) con
 * «Armar el plan». Comprueba que la ventana sale con lo de ESA consulta, fuera del <form> (un Enter
 * en ella no guarda la consulta), que el texto libre del plan futuro se queda como está y que sin
 * permiso no hay botón.
 *
 * Playwright se busca en ~/navegador; sin él, se SALTA diciéndolo. CAPTURAS=<carpeta> deja fotos.
 *
 * Run: npm run test:plan-consulta-toques
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cargarChromium, empaquetar } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";
import es from "@/i18n/dictionaries/es.json";

const CARPETA = "src/components/dashboard/plan-tratamiento-rediseno";
const sinGlobal = (css: string) => css.replace(/:global\(([^)]*)\)/g, "$1");
const OBSERVACIONES = (es as any).clinical.dentalForm.clinicalObservationsPlaceholder as string;
const PLAN_FUTURO = (es as any).clinical.dentalForm.futurePlanPlaceholder as string;

const TARIFARIO = [
  ["Restauración resina 1 cara", 700, 30], ["Endodoncia multirradicular", 4500, 120], ["Extracción simple", 800, 30],
].map(([name, basePrice, duration], i) => ({ id: `proc${i + 1}`, name, basePrice, duration, category: "dental", code: null, isActive: true }));

/** El odontograma VIVO del paciente: la consulta lo precarga y de ahí salen los chips. */
const VIVO = { entries: [{ toothNumber: 26, surface: "O", conditionId: "caries" }, { toothNumber: 36, surface: null, conditionId: "pulpitis" }] };

async function abrir(chromium: { launch(o?: any): Promise<any> }, conPlan: boolean, viewport = { width: 1440, height: 1000 }) {
  const paquete = await empaquetar(`${CARPETA}/__tests__/arnes-consulta.tsx`);
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport });
  const css = sinGlobal(readFileSync(join(CARPETA, "plan.module.css"), "utf8"))
    + sinGlobal(readFileSync("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css", "utf8"));
  const pedidas: string[] = [];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body{margin:0}body{font-family:system-ui,sans-serif;padding:16px}textarea,input,select{display:block;width:100%;box-sizing:border-box}${css}</style></head>
    <body><div id="raiz"></div><script>window.__CON_PLAN__=${conPlan};</script><script src="/paquete.js"></script></body></html>`;
  await pagina.route("**/*", async (ruta: any) => {
    const req = ruta.request();
    const url = new URL(req.url());
    const json = (status: number, cuerpo: unknown) => ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify(cuerpo) });
    if (url.pathname === "/") return ruta.fulfill({ status: 200, contentType: "text/html", body: html });
    if (url.pathname === "/paquete.js") return ruta.fulfill({ status: 200, contentType: "text/javascript", body: paquete });
    pedidas.push(`${req.method()} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/procedures") return json(200, TARIFARIO);
    if (url.pathname === "/api/odontogram" && url.searchParams.get("patientId")) return json(200, VIVO);
    if (url.pathname.endsWith("/presentar")) return ruta.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" });
    if (url.pathname === "/api/treatments" && req.method() === "POST") {
      const cuerpo = JSON.parse(req.postData() ?? "{}");
      return json(201, { id: "plan-consulta", name: cuerpo.name, items: cuerpo.items, _cuerpo: cuerpo });
    }
    // Lo demás que el formulario pide al montar (borrador, IA…): vacío.
    return json(200, req.method() === "GET" ? {} : { ok: true });
  });
  await pagina.goto("http://consulta.prueba/");
  await pagina.waitForSelector(`textarea[placeholder="${OBSERVACIONES}"]`);
  return { navegador, pagina, pedidas };
}

test("«Armar el plan» desde la consulta: lo de ESA consulta, fuera del <form>, sin tocar el plan futuro", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const { navegador, pagina, pedidas } = await abrir(chromium, true);
  try {
    await pagina.fill(`textarea[placeholder="${OBSERVACIONES}"]`, "Pulpitis irreversible en 36.");
    await pagina.fill(`textarea[placeholder="${PLAN_FUTURO}"]`, "Endodoncia y corona en 36; revisar 26.");
    await pagina.selectOption("#dental-pronostico", "reservado");
    // Esperar a que la consulta tenga su odontograma (la precarga del vivo).
    await pagina.waitForFunction(() => document.body.innerText.length > 0);
    await pagina.waitForTimeout(300);
    const antesOdontograma = pedidas.filter((p) => p.startsWith("GET /api/odontogram?patientId")).length;

    if (process.env.CAPTURAS) {
      await pagina.locator("[data-armar-plan]").scrollIntoViewIfNeeded();
      await pagina.screenshot({ path: join(process.env.CAPTURAS, "consulta-boton-1440.png") });
    }
    await pagina.click("[data-armar-plan]");
    await pagina.waitForSelector("[data-plan-nuevo]");
    // En un portal: fuera del <form> de la consulta.
    assert.equal(await pagina.evaluate(() => !!document.querySelector("form [data-plan-nuevo]")), false);
    // Lo de la consulta: chips de su odontograma, su diagnóstico y su pronóstico, sin releer nada.
    await pagina.waitForSelector('[data-chip="h:36:pulpitis"]');
    await pagina.click("[aria-controls='plan-detalles']");
    assert.equal(await pagina.inputValue("#plan-diagnostico"), "Pulpitis irreversible en 36.");
    assert.equal((await pagina.textContent("[data-plan-pronostico-de-consulta]"))?.trim(), "Reservado");
    assert.equal(pedidas.filter((p) => p.startsWith("GET /api/odontogram?patientId")).length, antesOdontograma, "la ventana no relee el odontograma");
    assert.ok(!pedidas.some((p) => p.startsWith("GET /api/clinical")), "la ventana no lee la última consulta");

    // Un Enter dentro de la ventana NO guarda la consulta.
    await pagina.press("#plan-nombre", "Enter");
    await pagina.waitForTimeout(300);
    assert.ok(!pedidas.some((p) => p.startsWith("POST /api/clinical")), "el Enter guardó la consulta");

    await pagina.click('[data-chip="h:36:pulpitis"]');
    await pagina.click("[data-plan-guardar]");
    await pagina.waitForFunction(() => (window as any).__GUARDADO__);
    const plan = await pagina.evaluate(() => (window as any).__GUARDADO__);
    assert.match(plan._cuerpo.description, /Pronóstico: Reservado/);
    assert.equal(plan._cuerpo.items[0].nombre, "Endodoncia multirradicular");
    // La ventana se cierra, la consulta avisa del plan y su texto libre sigue igual.
    await pagina.waitForSelector("[data-plan-nuevo]", { state: "detached" });
    assert.match(await pagina.textContent("[data-plan-creado]") ?? "", /Plan .*creado/);
    assert.equal(await pagina.inputValue(`textarea[placeholder="${PLAN_FUTURO}"]`), "Endodoncia y corona en 36; revisar 26.");
    assert.ok(!pedidas.some((p) => p.startsWith("POST /api/clinical")), "armar el plan no guarda la consulta");
  } finally {
    await navegador.close();
  }
});

test("sin permiso de crear planes (la ficha no pasa `armarPlan`), la consulta es la de siempre", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const { navegador, pagina } = await abrir(chromium, false);
  try {
    assert.equal(await pagina.$("[data-armar-plan]"), null);
    assert.ok(await pagina.$(`textarea[placeholder="${PLAN_FUTURO}"]`));
  } finally {
    await navegador.close();
  }
});
