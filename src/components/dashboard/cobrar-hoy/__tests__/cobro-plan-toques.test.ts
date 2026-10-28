/**
 * «Que nada se cobre dos veces» EN PANTALLA (ws1-t12 · fase 2), con clics de verdad en Chromium:
 *
 *  · «Cobrar hoy» de un paciente con plan con nota → ABONO a esa nota (POST /api/invoices/<nota>);
 *    ninguna factura nueva (nunca POST /api/invoices);
 *  · plan sin nota → «crear la nota del plan y abonar» (la nota del plan, no una factura suelta);
 *  · «Otra cosa» con el motivo de la cita que ya es del plan → aviso y no deja cobrar sin confirmar;
 *  · «Hoy en el sillón» (Tratamientos detectados) → lo del plan se marca hecho (acción de B) y la
 *    factura de la cita lleva SOLO lo de fuera;
 *  · la tarjeta «Cuenta del plan» y todo lo anterior a 390 px sin scroll horizontal.
 *
 * Playwright no es dependencia del repo: se busca en ~/navegador. Sin él, la prueba se SALTA diciéndolo.
 * Con CAPTURAS=<carpeta> deja las fotos.
 *
 * Run: npm run test:plan-cobro-toques
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cargarChromium, empaquetar } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";

const sinGlobal = (css: string) => css.replace(/:global\(([^)]*)\)/g, "$1");
// En el arnés las clases de los CSS Modules NO llevan hash: la `.raiz` del menú (que se esconde bajo
// 1024 px) chocaría con la `.raiz` de la hoja de factura. Aquí el menú solo aporta sus tokens.
const soloTokensDelMenu = (css: string) => css.replace(/\.raiz\b/g, ".raizDelMenuNoUsada");
const CSS = [
  "src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css",
  "src/components/dashboard/factura-rediseno/factura-rediseno.module.css",
  "src/components/dashboard/cobrar-hoy/cobrar-hoy.module.css",
  "src/components/dashboard/patient-detail/patient-detail.module.css",
  "src/components/dashboard/expediente-rediseno/expediente.module.css",
].map((f) => sinGlobal(f.includes("menu-dos-niveles") ? soloTokensDelMenu(readFileSync(f, "utf8")) : readFileSync(f, "utf8"))).join("\n");

const NOTA = { invoiceId: "n1", invoiceNumber: "F-0101", status: "PENDING", total: 2050.5, paid: 0, createdAt: "2026-10-20T15:00:00.000Z" };
const FILAS = [
  { id: "f-resina", planId: "plan1", nombre: "Resina", procedureId: "proc-r", dientes: [16], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: "n1" },
  { id: "f-limpieza", planId: "plan1", nombre: "Limpieza", procedureId: "proc-l", dientes: [], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: "n1" },
];
const planConNota = () => ({
  planId: "plan1", nombre: "Plan Ana", estado: "ACTIVE", conFilas: true, total: 2050.5, facturado: 2050.5, pagado: 0, soloDelPlan: true,
  saldo: 2050.5, porFacturar: 0, notas: [NOTA], filas: FILAS,
});
const planSinNota = () => ({ ...planConNota(), facturado: 0, saldo: 0, porFacturar: 2050.5, notas: [], filas: FILAS.map((f) => ({ ...f, invoiceId: null })) });
const TARIFARIO = [{ id: "proc-r", name: "Resina", basePrice: 1250.5, isActive: true }, { id: "proc-b", name: "Blanqueamiento", basePrice: 3000, isActive: true }];

interface Pedida { metodo: string; ruta: string; cuerpo: any }

async function abrir(chromium: { launch(o?: any): Promise<any> }, paquete: string, escena: string, opciones: { cuentas: () => unknown[]; planesDeLaCita?: string[]; cuentasFallan?: boolean; altaDeNota?: (cuerpo: any) => { status: number; body: unknown }; viewport?: { width: number; height: number } }) {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: opciones.viewport ?? { width: 1280, height: 900 } });
  const pedidas: Pedida[] = [];
  let lecturasDeCuentas = 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>*,::before,::after{box-sizing:border-box}html,body{margin:0}body{font-family:system-ui,sans-serif}${CSS}</style></head>
    <body><div id="raiz"></div><script>window.__ESCENA__=${JSON.stringify(escena)};</script><script src="/paquete.js"></script></body></html>`;
  await pagina.route("**/*", async (ruta: any) => {
    const req = ruta.request();
    const url = new URL(req.url());
    const json = (status: number, cuerpo: unknown) => ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify(cuerpo) });
    const cuerpo = (() => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } })();
    pedidas.push({ metodo: req.method(), ruta: url.pathname + url.search, cuerpo });
    if (url.pathname === "/") return ruta.fulfill({ status: 200, contentType: "text/html", body: html });
    if (url.pathname === "/paquete.js") return ruta.fulfill({ status: 200, contentType: "text/javascript", body: paquete });
    if (url.pathname === "/api/treatments/cuentas") {
      lecturasDeCuentas++;
      if (opciones.cuentasFallan) return json(500, { error: "pooler" });
      return json(200, { planes: opciones.cuentas(), planesDeLaCita: opciones.planesDeLaCita ?? [] });
    }
    if (url.pathname === "/api/treatments" && req.method() === "GET") {
      return json(200, [{ id: "plan1", name: "Plan Ana", status: "ACTIVE", items: FILAS.map((f) => ({ ...f, importe: f.nombre === "Resina" ? 1250.5 : 800, precio: 0, precioCentavos: 0 })) }]);
    }
    if (url.pathname === "/api/treatments/plan1" && req.method() === "PATCH") return json(200, { success: true, items: (cuerpo?.itemIds ?? []).map((id: string) => ({ id, estado: "hecho" })) });
    if (url.pathname === "/api/treatments/plan1/nota-de-cobro") return json(201, { estado: "creada", nota: { id: "n1", invoiceNumber: "F-0101", total: 2050.5 } });
    if (url.pathname === "/api/treatments/plan1/cerrar") return json(200, { ok: true, estado: "cerrado", notas: [], filasCanceladas: 1, saldoAFavor: 0, sinAjustar: [] });
    if (url.pathname === "/api/procedures") return json(200, TARIFARIO);
    if (url.pathname === "/api/caja/para-cobrar") return json(200, { register: { esMia: true }, whatsappConectado: false });
    if (url.pathname === "/api/agenda/doctors") return json(200, { doctors: [] });
    if (url.pathname === "/api/invoices/doctor-sugerido") return json(200, { doctorId: null });
    if (url.pathname === "/api/quotes") return json(200, []);
    if (url.pathname === "/api/clinic/zona") return json(200, { timezone: "America/Mexico_City" });
    if (url.pathname === "/api/invoices/from-appointment") return json(201, { invoice: { id: "inv-cita", invoiceNumber: "F-0102", total: 3000, balance: 3000 }, anticipoAplicado: 0 });
    if (/^\/api\/invoices\/[^/]+$/.test(url.pathname) && req.method() === "POST") return json(200, { ok: true });
    if (url.pathname === "/api/invoices" && req.method() === "POST") {
      const r = opciones.altaDeNota?.(cuerpo);
      return r ? json(r.status, r.body) : json(201, { id: "nueva", invoiceNumber: "F-0199", balance: 1250.5 });
    }
    return ruta.fulfill({ status: 404, body: "" });
  });
  await pagina.goto("http://cobro.prueba/");
  return { navegador, pagina, pedidas, lecturas: () => lecturasDeCuentas };
}

async function sinScrollHorizontal(pagina: any) {
  const anchos = await pagina.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // Lo que vive dentro de una caja que se desliza sola (una tabla ancha) no mueve la pantalla.
    // (Sin funciones con nombre aquí dentro: tsx les pone `__name`, que el navegador no tiene.)
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

test("Cobrar hoy con nota del plan: abona a la nota (POST /api/invoices/n1) y NO crea factura nueva", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, "cobrar", { cuentas: () => [planConNota()] });
  try {
    await pagina.waitForSelector('[data-abono-plan="plan1"]');
    await foto(pagina, "cobrar-hoy-abono-1280.png");
    // Sin monto no se puede abonar.
    assert.equal(await pagina.isDisabled("[data-abono-guardar]"), true);
    await pagina.fill("[data-abono-monto]", "500");
    assert.match(await pagina.textContent("[data-abono-guardar]") ?? "", /Abonar \$500/);
    await pagina.click("[data-abono-guardar]");
    await pagina.waitForSelector("[data-abono-hecho]");
    const pagos = pedidas.filter((p) => p.metodo === "POST" && p.ruta.startsWith("/api/invoices"));
    assert.deepEqual(pagos.map((p) => [p.ruta, p.cuerpo?.amount]), [["/api/invoices/n1", 500]], "un abono a la nota del plan y nada más");
    assert.equal(await pagina.evaluate(() => (window as any).__LISTO__?.id), "n1");
  } finally {
    await navegador.close();
  }
});

test("Cobrar hoy con plan SIN nota: crea la nota del plan y abona ahí (no una factura suelta)", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  let conNota = false;
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, "cobrar", { cuentas: () => [conNota ? planConNota() : planSinNota()] });
  try {
    await pagina.waitForSelector('[data-abono-plan="plan1"]');
    assert.match(await pagina.textContent("[data-abono-guardar]") ?? "", /Crear la nota del plan/);
    await pagina.fill("[data-abono-monto]", "300");
    conNota = true; // lo que contestará la relectura tras crear la nota
    await pagina.click("[data-abono-guardar]");
    await pagina.waitForSelector("[data-abono-hecho]");
    const escrituras = pedidas.filter((p) => p.metodo === "POST" && !p.ruta.startsWith("/api/caja")).map((p) => [p.ruta, p.cuerpo?.amount ?? null]);
    assert.deepEqual(escrituras, [["/api/treatments/plan1/nota-de-cobro", null], ["/api/invoices/n1", 300]]);
  } finally {
    await navegador.close();
  }
});

test("Cobrar hoy «Otra cosa»: el motivo de la cita que ya es del plan se avisa y no se cobra aparte sin confirmar", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, "cobrar", { cuentas: () => [planConNota()] });
  try {
    await pagina.waitForSelector("[data-cobrar-hoy-otra]");
    await pagina.click("[data-cobrar-hoy-otra]");
    await pagina.waitForSelector("[data-cobrar-hoy-ya-del-plan]");
    assert.match(await pagina.textContent("[data-cobrar-hoy-ya-del-plan]") ?? "", /Resina ya está en el plan «Plan Ana»/);
    const boton = pagina.locator("button", { hasText: "Cobrar $" });
    assert.equal(await boton.isDisabled(), true, "sin confirmar que es OTRO procedimiento no se cobra");
    await foto(pagina, "cobrar-hoy-otra-cosa-1280.png");
    await pagina.check("[data-cobrar-hoy-confirma-fuera]");
    assert.equal(await boton.isDisabled(), false);
    // Volver al abono: un toque.
    await pagina.click('[data-cobrar-hoy-plan="plan1"]');
    await pagina.waitForSelector('[data-abono-plan="plan1"]');
    assert.equal(pedidas.filter((p) => p.metodo === "POST" && p.ruta === "/api/invoices").length, 0);
  } finally {
    await navegador.close();
  }
});

test("Hoy en el sillón: lo del plan se marca hecho (acción de B) y la factura de la cita lleva SOLO lo de fuera", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, "hoy", { cuentas: () => [planConNota()] });
  try {
    await pagina.waitForSelector("[data-hoy-plan]");
    // La resina del 16 se detectó y es del plan: nace marcada. La limpieza (no detectada), no.
    assert.equal(await pagina.isChecked('[data-hoy-fila="f-resina"]'), true);
    assert.equal(await pagina.isChecked('[data-hoy-fila="f-limpieza"]'), false);
    // En la tabla de factura solo queda el blanqueamiento.
    const tabla = await pagina.textContent("table");
    assert.match(tabla ?? "", /Blanqueamiento/);
    assert.doesNotMatch(tabla ?? "", /Resina/);
    await foto(pagina, "hoy-en-el-sillon-1280.png");
    await pagina.click("[data-hoy-marcar]");
    await pagina.waitForFunction(() => (window as any).__HECHOS__ === 1);
    const patch = pedidas.filter((p) => p.metodo === "PATCH");
    assert.deepEqual(patch.map((p) => [p.ruta, p.cuerpo?.action, p.cuerpo?.itemIds, p.cuerpo?.citaId]), [["/api/treatments/plan1", "marcar_hecho", ["f-resina"], "cita1"]]);
    await pagina.click("[data-hoy-factura]");
    await pagina.waitForFunction(() => !!(window as any).__LISTO__);
    const factura = pedidas.find((p) => p.ruta === "/api/invoices/from-appointment");
    assert.deepEqual(factura?.cuerpo?.lineItems.map((l: any) => l.name), ["Blanqueamiento"]);
  } finally {
    await navegador.close();
  }
});

test("a 390 px: Cobrar hoy (abono), Hoy en el sillón y la Cuenta del plan sin scroll horizontal", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  const movil = { width: 390, height: 844 };
  for (const [escena, espera, nombre] of [
    ["cobrar", '[data-abono-plan="plan1"]', "cobrar-hoy-abono-390.png"],
    ["hoy", "[data-hoy-plan]", "hoy-en-el-sillon-390.png"],
    ["cuenta", "[data-cuenta-plan]", "cuenta-del-plan-390.png"],
  ] as const) {
    // 26-oct: la resina está hecha ($1,250.50), la limpieza no ($800), y abonó $500.
    const cuentas = () => [{ ...planConNota(), pagado: 500, saldo: 1550.5, aceptado: 2050.5, hecho: 1250.5, debe: 750.5, saldoAFavor: 0, porHacer: 800, vencido: 0 }];
    const { navegador, pagina, pedidas } = await abrir(chromium, paquete, escena, { cuentas, viewport: movil });
    try {
      await pagina.waitForSelector(espera);
      if (escena === "cuenta") {
        const cifra = async (k: string) => (await pagina.textContent(`[data-cifra="${k}"]`)) ?? "";
        assert.match(await cifra("aceptado"), /Plan aceptado\s*\$2,050\.50/);
        assert.match(await cifra("hecho"), /Hecho\s*\$1,250\.50/);
        assert.match(await cifra("pagado"), /Pagado\s*\$500\.00/);
        assert.match(await cifra("debe"), /Debe\s*\$750\.50/);
        assert.match(await cifra("por-hacer"), /Por hacer\s*\$800\.00/);
        assert.match(await pagina.textContent("[data-cuenta-plan]") ?? "", /F-0101/);
        await pagina.click("[data-cuenta-plan-cobrar]");
        assert.equal(await pagina.evaluate(() => (window as any).__ABONAR__), true);
        // «Cerrar plan»: confirmación en la tarjeta, con lo que pasará y el motivo obligatorio.
        await pagina.click("[data-cuenta-plan-cerrar]");
        await pagina.waitForSelector("[data-cuenta-plan-cierre]");
        const aviso = (await pagina.textContent("[data-cuenta-plan-cierre]")) ?? "";
        assert.match(aviso, /Lo que no se hizo \(\$800\.00\) sale de la nota/);
        assert.match(aviso, /Sigue debiendo \$750\.50/);
        assert.equal(await pagina.isDisabled("[data-cuenta-plan-confirmar]"), true, "sin motivo no se cierra");
        await pagina.fill("[data-cuenta-plan-motivo]", "Ya no continuará");
        await sinScrollHorizontal(pagina);
        await foto(pagina, "cuenta-del-plan-cerrar-390.png");
        await pagina.click("[data-cuenta-plan-confirmar]");
        await pagina.waitForSelector("[data-cuenta-plan-cierre]", { state: "detached" });
        const cierre = pedidas.find((p) => p.ruta === "/api/treatments/plan1/cerrar");
        assert.equal(cierre?.metodo, "POST");
        // v15 (t5 de la v14, M3): la tarjeta pide la cuenta del plan cerrado en la respuesta.
        assert.deepEqual(cierre?.cuerpo, { motivo: "Ya no continuará", conCuenta: true });
      }
      await sinScrollHorizontal(pagina);
      await foto(pagina, nombre);
    } finally {
      await navegador.close();
    }
  }
});

// Al unir la fase 2 (REPORTE-ws1-t1 §6): la cita DESDE la que se cobra tiene procedimientos del plan
// agendados. Lo dicen las filas ligadas (servidor), no el motivo.
test("Cobrar hoy desde una cita del plan: abre en el abono de ESE plan, y «Otra cosa» solo confirmando (viaja fueraDelPlan)", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  // Otro plan que debe MÁS y va primero; el de la cita es plan1, y sus filas no se parecen al motivo
  // («Resina»): sin la liga de la cita, la hoja no sabría que esta cita es del plan.
  const otro = { ...planConNota(), planId: "plan-otro", nombre: "Plan ortodoncia", saldo: 9000, notas: [{ ...NOTA, invoiceId: "n-otro", invoiceNumber: "F-0050" }], filas: [] };
  const delaCita = { ...planConNota(), filas: FILAS.filter((f) => f.nombre === "Limpieza") };
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, "cobrar", { cuentas: () => [otro, delaCita], planesDeLaCita: ["plan1"] });
  try {
    await pagina.waitForSelector('[data-abono-plan="plan1"]');
    assert.ok(pedidas.some((p) => p.ruta.startsWith("/api/treatments/cuentas?") && p.ruta.includes("appointmentId=cita1")), "pregunta por la cita");
    await pagina.click("[data-cobrar-hoy-otra]");
    await pagina.waitForSelector("[data-cobrar-hoy-cita-del-plan]");
    assert.match(await pagina.textContent("[data-cobrar-hoy-cita-del-plan]") ?? "", /Esta cita es del plan «Plan Ana»/);
    assert.equal(await pagina.locator("[data-cobrar-hoy-ya-del-plan]").count(), 0, "el motivo no coincide con el plan: avisa la CITA");
    const boton = pagina.locator("button", { hasText: "Cobrar $" });
    assert.equal(await boton.isDisabled(), true, "sin confirmar que es OTRO procedimiento no se cobra aparte");
    await pagina.check("[data-cobrar-hoy-confirma-fuera]");
    await boton.click();
    const alta = await (async () => {
      for (let i = 0; i < 100; i++) {
        const p = pedidas.find((x) => x.metodo === "POST" && x.ruta === "/api/invoices");
        if (p) return p;
        await pagina.waitForTimeout(50);
      }
      return null;
    })();
    assert.ok(alta, "con la confirmación sí se crea la nota nueva");
    assert.equal(alta!.cuerpo.appointmentId, "cita1");
    assert.equal(alta!.cuerpo.fueraDelPlan, true, "y el servidor recibe la confirmación");
  } finally {
    await navegador.close();
  }
});

test("sin poder leer los planes: la casilla de «no se pudo comprobar» NO confirma la cita; el 409 del servidor enseña su aviso", async (t) => {
  const chromium = await cargarChromium();
  if (!chromium) { t.skip("Playwright no está en ~/navegador"); return; }
  const paquete = await empaquetar("src/components/dashboard/cobrar-hoy/__tests__/arnes-cobro-plan.tsx");
  // El servidor SÍ sabe que la cita es del plan: sin la confirmación sobre ESTA cita, 409.
  const altaDeNota = (cuerpo: any) =>
    cuerpo?.fueraDelPlan === true
      ? { status: 201, body: { id: "nueva", invoiceNumber: "F-0199", balance: 1250.5 } }
      : { status: 409, body: { code: "cita_del_plan", planIds: ["plan1"], error: "Esta cita es del plan de tratamiento: lo de hoy se abona a la nota del plan." } };
  const { navegador, pagina, pedidas } = await abrir(chromium, paquete, "cobrar", { cuentas: () => [], cuentasFallan: true, altaDeNota });
  try {
    await pagina.waitForSelector("[data-cobrar-hoy-plan-sin-leer]");
    await pagina.check("[data-cobrar-hoy-plan-sin-leer] input[type=checkbox]");
    const boton = pagina.locator("button", { hasText: "Cobrar $" });
    await boton.click();
    await pagina.waitForSelector("[data-cobrar-hoy-cita-del-plan]");
    const altas = () => pedidas.filter((p) => p.metodo === "POST" && p.ruta === "/api/invoices");
    assert.equal(altas().length, 1);
    assert.equal(altas()[0].cuerpo.fueraDelPlan, undefined, "la casilla de «no se pudo comprobar» no viaja como confirmación");
    assert.match(await pagina.textContent("[data-cobrar-hoy-cita-del-plan]") ?? "", /Esta cita es del plan de tratamiento/);
    assert.equal(await pagina.locator("[data-cobrar-hoy-plan-sin-leer]").count(), 0, "un solo aviso");
    assert.equal(await boton.isDisabled(), true, "hay que confirmar sobre ESTA cita");
    await pagina.check("[data-cobrar-hoy-cita-del-plan] input[type=checkbox]");
    await boton.click();
    for (let i = 0; i < 100 && altas().length < 2; i++) await pagina.waitForTimeout(50);
    assert.equal(altas().length, 2);
    assert.equal(altas()[1].cuerpo.fueraDelPlan, true, "ahora sí, confirmado viendo el aviso de la cita");
  } finally {
    await navegador.close();
  }
});
