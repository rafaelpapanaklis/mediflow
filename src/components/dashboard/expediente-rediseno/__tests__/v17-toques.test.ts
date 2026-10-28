/**
 * v17 EN PANTALLA (decisiones de Rafael del 28-oct), con clics de verdad en Chromium:
 *
 *  1. «Hecho» en la tarjeta pregunta en qué cita se hizo: la de hoy primero y ya elegida; una cita sin
 *     nota clínica se AVISA («Marcar y escribir la nota»), sin impedir marcar; «Se hizo sin cita» pide
 *     motivo; si las citas no se pueden leer, se puede marcar sin cita.
 *  2. «En esta cita: Resina $700.00 (hecho) · Debe hoy $700.00» en el detalle de la cita; nada si la cita
 *     no tiene nada del plan.
 *  3. «Convertir en presupuesto» junto a «Abonar al plan»; no sale si el plan ya tiene nota, ni al doctor
 *     en el plan de otro.
 *  · Todo a 390 px sin scroll horizontal.
 *
 * Playwright no es dependencia del repo: se busca en ~/navegador. Sin él, la prueba se SALTA diciéndolo.
 * Con CAPTURAS=<carpeta> deja las fotos.
 *
 * Run: npm run test:plan-v17-toques
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cargarChromium, empaquetar } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";

const sinGlobal = (css: string) => css.replace(/:global\(([^)]*)\)/g, "$1");
const soloTokensDelMenu = (css: string) => css.replace(/\.raiz\b/g, ".raizDelMenuNoUsada");
const CSS = [
  "src/app/globals.css",
  "src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css",
  "src/components/dashboard/expediente-rediseno/expediente.module.css",
  "src/components/dashboard/plan-tratamiento-rediseno/plan.module.css",
  "src/components/dashboard/plan-a-presupuesto/convertir.module.css",
  "src/components/dashboard/plan-a-agenda/agendar-lo-pendiente.module.css",
  "src/components/dashboard/plan-a-agenda/en-esta-cita.module.css",
]
  .map((f) => {
    const css = readFileSync(f, "utf8");
    // De globals.css solo hacen falta sus variables (las de `:root`); el resto es Tailwind sin compilar.
    if (f.endsWith("globals.css")) return (css.match(/:root\s*\{[^}]*\}/g) ?? []).join("\n");
    return sinGlobal(f.includes("menu-dos-niveles") ? soloTokensDelMenu(css) : css);
  })
  .join("\n");

const NOTA = { invoiceId: "n1", invoiceNumber: "F-0101", status: "PENDING", total: 2050.5, paid: 0, createdAt: "2026-10-20T15:00:00.000Z" };
const FILAS = [
  { id: "f-resina", planId: "plan1", nombre: "Resina", procedureId: "proc-r", dientes: [16], caras: ["M", "O"], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: "n1", citaId: null },
  { id: "f-limpieza", planId: "plan1", nombre: "Limpieza", procedureId: "proc-l", dientes: [], caras: [], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: "n1", citaId: null },
];
const planConNota = () => ({
  planId: "plan1", nombre: "Plan Ana", estado: "ACTIVE", conFilas: true, total: 2050.5, facturado: 2050.5, pagado: 0, soloDelPlan: true,
  saldo: 2050.5, porFacturar: 0, notas: [NOTA], filas: FILAS, aceptado: 2050.5, hecho: 0, debe: 0, saldoAFavor: 0, porHacer: 2050.5, vencido: 0,
});
const planSinNota = () => ({ ...planConNota(), facturado: 0, saldo: 0, porFacturar: 2050.5, notas: [], aceptado: 0, porHacer: 0, filas: FILAS.map((f) => ({ ...f, invoiceId: null })) });
const AHORA = Date.now();
const CITAS = [
  { id: "cita-hoy", startsAt: new Date(AHORA - 30 * 60_000).toISOString(), status: "IN_PROGRESS", doctor: "Ana Ruiz", motivo: "Resina", esHoy: true, tieneNota: false, notaLigable: true },
  { id: "cita-ayer", startsAt: new Date(AHORA - 86_400_000).toISOString(), status: "COMPLETED", doctor: "Ana Ruiz", motivo: "Valoración", esHoy: false, tieneNota: true, notaLigable: true },
];
// v18 (t5, m2): la cita de hoy de OTRO doctor, aún sin terminar: su nota la escribe su doctor.
const CITA_DE_OTRO = { ...CITAS[0], doctor: "Luis Mora", notaLigable: false };

interface Pedida { metodo: string; ruta: string; cuerpo: any }
interface Opciones {
  escena?: "tarjeta" | "cita";
  locale?: "es" | "en";
  cuentas?: () => unknown[];
  citasFallan?: boolean;
  citas?: unknown[];
  usuario?: { id: string; esDoctor: boolean };
  viewport?: { width: number; height: number };
}

async function abrir(chromium: { launch(o?: any): Promise<any> }, paquete: string, opciones: Opciones = {}) {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: opciones.viewport ?? { width: 1280, height: 900 } });
  const pedidas: Pedida[] = [];
  const previo = `window.__ESCENA__=${JSON.stringify(opciones.escena ?? "tarjeta")};window.__LOCALE__=${JSON.stringify(opciones.locale ?? "es")};` +
    (opciones.usuario ? `window.__USUARIO__=${JSON.stringify(opciones.usuario)};` : "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>*,::before,::after{box-sizing:border-box}html,body{margin:0}body{font-family:system-ui,sans-serif}${CSS}</style></head>
    <body><div id="raiz"></div><script>${previo}</script><script src="/paquete.js"></script></body></html>`;
  await pagina.route("**/*", async (ruta: any) => {
    const req = ruta.request();
    const url = new URL(req.url());
    const json = (status: number, cuerpo: unknown) => ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify(cuerpo) });
    const cuerpo = (() => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } })();
    pedidas.push({ metodo: req.method(), ruta: url.pathname + url.search, cuerpo });
    if (url.pathname === "/") return ruta.fulfill({ status: 200, contentType: "text/html", body: html });
    if (url.pathname === "/paquete.js") return ruta.fulfill({ status: 200, contentType: "text/javascript", body: paquete });
    if (url.pathname === "/api/clinic/zona") return json(200, { timezone: "America/Mexico_City" });
    if (url.pathname === "/api/treatments/cuentas") return json(200, { planes: (opciones.cuentas ?? (() => [planConNota()]))(), planesDeLaCita: [] });
    if (url.pathname === "/api/treatments" && req.method() === "GET") {
      return json(200, [{ id: "plan1", name: "Plan Ana", status: "ACTIVE", items: FILAS.map((f) => ({ ...f, importe: f.nombre === "Resina" ? 1250.5 : 800, precio: 0, precioCentavos: 0 })) }]);
    }
    if (url.pathname === "/api/treatments/plan1/citas-para-hecho") return opciones.citasFallan ? json(500, { error: "pooler" }) : json(200, { citas: opciones.citas ?? CITAS });
    if (url.pathname === "/api/treatments/plan1" && req.method() === "PATCH") {
      return json(200, { success: true, items: (cuerpo?.itemIds ?? []).map((id: string) => ({ id, estado: "hecho" })), ...(cuerpo?.citaId === "cita-hoy" && cuerpo?.avisarSinNota ? { citaSinNota: true } : {}) });
    }
    if (url.pathname === "/api/treatments/plan1/presupuesto" && req.method() === "GET") {
      return json(200, { existente: null, conceptos: [{ name: "Resina", toothFdi: "16", quantity: 1, unitPrice: 1250.5, origen: "plan", deTarifario: true }, { name: "Limpieza", toothFdi: null, quantity: 1, unitPrice: 800, origen: "plan", deTarifario: true }], total: 2050.5, sinDetalle: false, sinPrecio: 0, sinTarifario: 0, totalDifiere: false });
    }
    if (url.pathname === "/api/treatments/plan1/presupuesto" && req.method() === "POST") {
      return json(201, { quote: { id: "q1", folio: "P-0007", status: "DRAFT", total: 2050.5, title: "Plan Ana" } });
    }
    if (url.pathname === "/api/appointments/cita-hoy/plan-de-la-cita") {
      return json(200, { filas: [{ id: "f-resina", planId: "plan1", plan: "Plan Ana", nombre: "Resina 16 (MO)", importe: 700, estado: "hecho", agendada: true, hechaAqui: true }], debeHoy: 700 });
    }
    if (url.pathname === "/api/appointments/cita-sin-plan/plan-de-la-cita") return json(200, { filas: [], debeHoy: null });
    if (url.pathname === "/api/appointments/plan-pendiente") return json(200, { disponible: false });
    return ruta.fulfill({ status: 404, body: "" });
  });
  await pagina.goto("http://v17.prueba/");
  return { navegador, pagina, pedidas };
}

async function sinScrollHorizontal(pagina: any) {
  const anchos = await pagina.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const fuera = Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (!(r.width > 0 && (r.right > vw + 1 || r.left < -1))) return false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll") return false;
        }
        return true;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)}`);
    return { scroll: document.documentElement.scrollWidth, vw, fuera: fuera.slice(0, 5) };
  });
  assert.ok(anchos.scroll <= anchos.vw + 1, `scroll horizontal: ${anchos.scroll} > ${anchos.vw}`);
  assert.deepEqual(anchos.fuera, [], `elementos fuera de la pantalla: ${anchos.fuera.join(", ")}`);
}

const foto = async (pagina: any, nombre: string) => {
  if (!process.env.CAPTURAS) return;
  mkdirSync(process.env.CAPTURAS, { recursive: true });
  await pagina.screenshot({ path: join(process.env.CAPTURAS, nombre), fullPage: true });
};

const ARNES = "src/components/dashboard/expediente-rediseno/__tests__/arnes-v17.tsx";
const patches = (pedidas: Pedida[]) => pedidas.filter((p) => p.metodo === "PATCH").map((p) => p.cuerpo);

test("1 · «Hecho» pregunta la cita: la de hoy primero y elegida; sin nota → aviso y «Marcar y escribir la nota»; «Se hizo sin cita» pide motivo (1280 y 390 px)", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(ARNES);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const { navegador, pagina, pedidas } = await abrir(chromium, paquete, { viewport });
    try {
      await pagina.waitForSelector('[data-fila-hecho="f-resina"]');
      await pagina.click('[data-fila-hecho="f-resina"]');
      assert.deepEqual(patches(pedidas), [], "pulsar «Hecho» ya no marca: pregunta");
      await pagina.waitForSelector('[data-cita-opcion="cita-hoy"]');
      const opciones = await pagina.$$eval("[data-cita-opcion]", (els: Element[]) => els.map((e) => e.getAttribute("data-cita-opcion")));
      assert.deepEqual(opciones, ["cita-hoy", "cita-ayer", "sin-cita"], "la de hoy primero; «Se hizo sin cita» al final");
      assert.equal(await pagina.isChecked('[data-cita-opcion="cita-hoy"] input'), true, "la de hoy, ya elegida");
      assert.match((await pagina.textContent('[data-cita-opcion="cita-hoy"]')) ?? "", /Hoy, .*Sin nota.*Ana Ruiz · Resina/);
      assert.equal(await pagina.locator('[data-cita-opcion="cita-ayer"] [data-cita-sin-nota]').count(), 0);
      assert.equal(
        ((await pagina.textContent("[data-cita-hecho-aviso]")) ?? "").includes("Esta cita no tiene nota clínica. Escríbela para respaldar el procedimiento."),
        true,
      );
      assert.equal(await pagina.isDisabled("[data-cita-hecho-confirmar]"), false, "el aviso NO impide marcar");
      // La de ayer tiene nota: sin aviso.
      await pagina.check('[data-cita-opcion="cita-ayer"] input');
      assert.equal(await pagina.locator("[data-cita-hecho-aviso]").count(), 0);
      await pagina.check('[data-cita-opcion="cita-hoy"] input');
      await sinScrollHorizontal(pagina);
      await foto(pagina, `hecho-elegir-cita-${viewport.width}.png`);

      await pagina.click("[data-cita-hecho-escribir]");
      // v18 (t5, m2): la ficha recibe LA CITA elegida (y su etiqueta) para ligar la nota a ella.
      await pagina.waitForFunction(() => !!(window as any).__NOTA__);
      const nota = await pagina.evaluate(() => (window as any).__NOTA__);
      // v19 (t5 de la v18, m1): viaja la cita con su FECHA (no la etiqueta de la lista); el formulario arma la frase.
      assert.deepEqual(nota, { id: "cita-hoy", startsAt: CITAS[0].startsAt });
      assert.deepEqual(patches(pedidas), [{ action: "marcar_hecho", itemIds: ["f-resina"], citaId: "cita-hoy", avisarSinNota: true, conCuenta: true }]);
      await pagina.waitForSelector('[data-cita-hecho="f-resina"]', { state: "detached" });
      assert.equal(await pagina.getAttribute('[data-fila-plan="f-resina"]', "data-estado"), "hecho");

      // «Se hizo sin cita»: el motivo es obligatorio.
      await pagina.click('[data-fila-hecho="f-limpieza"]');
      await pagina.waitForSelector('[data-cita-opcion="sin-cita"]');
      await pagina.check('[data-cita-opcion="sin-cita"] input');
      assert.equal(await pagina.isDisabled("[data-cita-hecho-confirmar]"), true, "sin motivo no se marca");
      await pagina.fill("[data-cita-hecho-motivo]", "ok");
      assert.equal(await pagina.isDisabled("[data-cita-hecho-confirmar]"), true, "3 letras como mínimo");
      await pagina.fill("[data-cita-hecho-motivo]", "Urgencia en recepción");
      await sinScrollHorizontal(pagina);
      await foto(pagina, `hecho-sin-cita-${viewport.width}.png`);
      await pagina.click("[data-cita-hecho-confirmar]");
      await pagina.waitForSelector('[data-cita-hecho="f-limpieza"]', { state: "detached" });
      assert.deepEqual(patches(pedidas)[1], { action: "marcar_hecho", itemIds: ["f-limpieza"], sinCita: true, motivoSinCita: "Urgencia en recepción", conCuenta: true });
    } finally {
      await navegador.close();
    }
  }
});

test("1 · si las citas no se pueden leer, se marca sin cita (nada se bloquea); en inglés", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(ARNES);
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, { citasFallan: true, locale: "en" });
  try {
    await pagina.waitForSelector('[data-fila-hecho="f-resina"]');
    await pagina.click('[data-fila-hecho="f-resina"]');
    await pagina.waitForSelector("[data-cita-hecho-error]");
    assert.match((await pagina.textContent("[data-cita-hecho-error]")) ?? "", /Couldn't load the appointments\. You can mark it without an appointment\./);
    assert.equal(await pagina.isChecked('[data-cita-opcion="sin-cita"] input'), true);
    assert.match((await pagina.textContent('[data-cita-hecho="f-resina"]')) ?? "", /Which appointment was Resina 16 \(MO\) done in\?/);
    await pagina.fill("[data-cita-hecho-motivo]", "Emergency");
    await pagina.click("[data-cita-hecho-confirmar]");
    await pagina.waitForSelector('[data-cita-hecho="f-resina"]', { state: "detached" });
    assert.deepEqual(patches(pedidas), [{ action: "marcar_hecho", itemIds: ["f-resina"], sinCita: true, motivoSinCita: "Emergency", conCuenta: true }]);
  } finally {
    await navegador.close();
  }
});

test("2 · «En esta cita: Resina 16 (MO) $700.00 (hecho) · Debe hoy $700.00»; nada si la cita no tiene nada del plan (es/en, 390 px)", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(ARNES);
  for (const [locale, esperado] of [
    ["es", /En esta cita\s*Resina 16 \(MO\)\s*\$700\.00\s*\(hecho\)\s*Debe hoy\s*\$700\.00/],
    ["en", /In this appointment\s*Resina 16 \(MO\)\s*\$700\.00\s*\(done\)\s*Owes today\s*\$700\.00/],
  ] as const) {
    const { navegador, pagina } = await abrir(chromium, paquete, { escena: "cita", locale, viewport: { width: 390, height: 844 } });
    try {
      await pagina.waitForSelector('[data-en-esta-cita="cita-hoy"]');
      assert.match((await pagina.textContent('[data-en-esta-cita="cita-hoy"]')) ?? "", esperado);
      await pagina.waitForTimeout(150);
      assert.equal(await pagina.locator('[data-en-esta-cita="cita-sin-plan"]').count(), 0, "sin nada del plan, no sale");
      await sinScrollHorizontal(pagina);
      await foto(pagina, `en-esta-cita-${locale}-390.png`);
    } finally {
      await navegador.close();
    }
  }
});

test("3 · «Convertir en presupuesto» junto a «Abonar al plan» (mismo diálogo); no sale con nota ni al doctor en el plan de otro (390 px)", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(ARNES);
  // Plan sin nota (sin aceptar): «Abonar al plan» y, al lado, «Convertir en presupuesto».
  {
    const { navegador, pagina, pedidas } = await abrir(chromium, paquete, { cuentas: () => [planSinNota()], viewport: { width: 390, height: 844 } });
    try {
      await pagina.waitForSelector("[data-cuenta-plan] [data-convertir-presupuesto]");
      const botones = await pagina.$$eval("[data-cuenta-plan] button", (els: Element[]) => els.map((e) => (e.getAttribute("data-cuenta-plan-cobrar") !== null ? "abonar" : e.getAttribute("data-convertir-presupuesto") !== null ? "presupuesto" : e.textContent?.trim())));
      assert.deepEqual(botones.slice(0, 2), ["abonar", "presupuesto"], "junto a «Abonar al plan»");
      await sinScrollHorizontal(pagina);
      await foto(pagina, "presupuesto-en-la-tarjeta-390.png");
      await pagina.click("[data-convertir-presupuesto]");
      await pagina.waitForSelector('[role="dialog"]');
      await pagina.waitForSelector('[role="dialog"] [role="table"]');
      await sinScrollHorizontal(pagina);
      await foto(pagina, "presupuesto-dialogo-390.png");
      await pagina.locator('[role="dialog"] footer button').last().click();
      await pagina.waitForFunction(() => !!(window as any).__PRESUPUESTO__);
      assert.deepEqual(await pagina.evaluate(() => (window as any).__PRESUPUESTO__), { id: "q1", folio: "P-0007", status: "DRAFT", total: 2050.5, title: "Plan Ana" });
      assert.ok(pedidas.some((p) => p.metodo === "POST" && p.ruta === "/api/treatments/plan1/presupuesto"));
      assert.equal(await pagina.evaluate(() => (window as any).__ABONAR__ ?? false), false, "el clic no abre «Cobrar hoy»");
    } finally {
      await navegador.close();
    }
  }
  // Plan con nota (ya aceptado): no sale.
  {
    const { navegador, pagina } = await abrir(chromium, paquete, { cuentas: () => [planConNota()] });
    try {
      await pagina.waitForSelector("[data-cuenta-plan]");
      assert.equal(await pagina.locator("[data-convertir-presupuesto]").count(), 0);
    } finally {
      await navegador.close();
    }
  }
  // El doctor en el plan de otro doctor: el servidor no le encuentra el plan → sin botón.
  {
    const { navegador, pagina } = await abrir(chromium, paquete, { cuentas: () => [planSinNota()], usuario: { id: "doc-luis", esDoctor: true } });
    try {
      await pagina.waitForSelector("[data-cuenta-plan]");
      assert.equal(await pagina.locator("[data-convertir-presupuesto]").count(), 0);
    } finally {
      await navegador.close();
    }
  }
});

test("1 · v18: la cita de hoy de otro doctor sin terminar — «la escribe Luis Mora», sin botón; se puede marcar igual", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar(ARNES);
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, { citas: [CITA_DE_OTRO], viewport: { width: 390, height: 844 } });
  try {
    await pagina.waitForSelector('[data-fila-hecho="f-resina"]');
    await pagina.click('[data-fila-hecho="f-resina"]');
    await pagina.waitForSelector("[data-cita-hecho-aviso]");
    assert.match((await pagina.textContent("[data-cita-hecho-aviso]")) ?? "", /Esta cita no tiene nota clínica\. La escribe Luis Mora al atender la consulta\./);
    assert.equal(await pagina.locator("[data-cita-hecho-escribir]").count(), 0, "sin «Marcar y escribir la nota»");
    await sinScrollHorizontal(pagina);
    await foto(pagina, "hecho-cita-de-otro-390.png");
    await pagina.click("[data-cita-hecho-confirmar]");
    await pagina.waitForSelector('[data-cita-hecho="f-resina"]', { state: "detached" });
    assert.equal(patches(pedidas)[0].citaId, "cita-hoy");
    assert.equal(await pagina.evaluate(() => (window as any).__NOTA__ ?? null), null);
  } finally {
    await navegador.close();
  }
});

