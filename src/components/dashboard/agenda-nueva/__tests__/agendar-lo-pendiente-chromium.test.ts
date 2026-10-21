/**
 * «AGENDAR LO PENDIENTE» EN CHROMIUM — ws1-t1 (plan de tratamiento, fase 2 · P8).
 *
 * Run: npm run test:plan-citas-pantalla
 *
 * Los componentes de VERDAD (hoja del plan, modo «agendando del plan» de la agenda y la ventana
 * Nueva cita de siempre), empaquetados con esbuild y con clics de ratón en Chromium. Fija:
 *  · la hoja enseña lo pendiente, lo ya agendado sale marcado y no se elige, el total cambia al
 *    quitar una casilla, y «Elegir hora en la agenda» manda a la agenda con las filas elegidas;
 *  · en la agenda: el aviso dice de quién es el plan y qué se agenda, la Nueva cita se abre sola con
 *    el paciente, el motivo, la nota «Del plan…» y la duración del tarifario; el clic en un hueco
 *    también; y el POST lleva `planItemIds` (y al guardar se sale del modo y se resalta la cita);
 *  · un 409 de las filas se dice con su frase (no como choque de horario);
 *  · a 390 px no hay scroll horizontal (fotos en ~/capturas/plan-citas/).
 * Sin Playwright (NAVEGADOR_DIR) la prueba se SALTA diciéndolo.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cargarChromium } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";

const RAIZ = process.cwd();
const TZ = "America/Mexico_City";
const DIA = "2026-11-10";
const HUECO = new Date(Date.UTC(2026, 10, 10, 17, 0)).toISOString(); // 11:00 en CDMX
const CAPTURAS = join(homedir(), "capturas/plan-citas");

/** esbuild con `next/navigation` que lee la URL de la página y apunta cada navegación en `window.__nav`. */
async function empaquetar(entrada: string): Promise<string> {
  const esbuild = await import("esbuild");
  const nav = `
    const anota = (tipo, u) => { (window.__nav ??= []).push([tipo, u]); };
    export const useRouter = () => ({ push: (u) => anota("push", u), replace: (u) => anota("replace", u), refresh() {}, prefetch() {}, back() {} });
    export const usePathname = () => location.pathname;
    export const useSearchParams = () => new URLSearchParams(location.search);
    export const redirect = () => {};
    export const notFound = () => {};`;
  const r = await esbuild.build({
    entryPoints: [join(RAIZ, entrada)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(RAIZ, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    logLevel: "silent",
    plugins: [
      {
        name: "dobles",
        setup(b) {
          b.onResolve({ filter: /^next\// }, (a) => ({ path: a.path, namespace: "next-doblado" }));
          b.onLoad({ filter: /.*/, namespace: "next-doblado" }, (a) => ({
            contents: a.path === "next/navigation" ? nav : `const f = () => ({ className: "", variable: "", style: {} }); export default f;`,
            loader: "js",
            resolveDir: RAIZ,
          }));
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "css-doblado" }));
          b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: "css-doblado" }));
          b.onLoad({ filter: /.*/, namespace: "css-doblado" }, () => ({
            contents: `export default new Proxy({}, { get: (_t, k) => String(k) });`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return r.outputFiles[0]!.text;
}

/**
 * El CSS de verdad, crudo (clase = llave): la hoja del plan con los `--m2-*` del menú (`.tokens`), o el
 * aviso de la agenda con los `--ag-*`. Uno u otro: en el arnés no hay hash de CSS Modules y las dos
 * hojas comparten nombres con la ventana Nueva cita (`.velo`, `.cabecera`…).
 */
function css(modo: "plan" | "agenda" | "ventana" | "tarjeta"): string {
  const bloque = (archivo: string, inicio: string) => {
    const t = readFileSync(join(RAIZ, archivo), "utf8");
    const i = t.indexOf(inicio);
    return t.slice(i, t.indexOf("}", i) + 1);
  };
  const base = "*,::before,::after{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif;background:#f4f3f8}";
  if (modo === "plan") {
    return `${base} ${bloque("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css", ".tokens {")} ${readFileSync(join(RAIZ, "src/components/dashboard/plan-a-agenda/agendar-lo-pendiente.module.css"), "utf8")}`;
  }
  return `${base} ${bloque("src/components/dashboard/agenda-nueva/agenda-nueva.module.css", ".raiz,\n.tokensAgenda {")} ${readFileSync(join(RAIZ, "src/components/dashboard/agenda-nueva/agendar-plan.module.css"), "utf8")}`;
}

const DATOS = {
  disponible: true,
  puedeAgendar: true,
  minutosDelHueco: 15,
  minutosSugeridos: 75,
  plan: { id: "plan1", nombre: "Plan 20 oct", status: "ACTIVE", doctorId: "d1", paciente: { id: "p1", nombre: "Ana García" } },
  filas: [
    { id: "f1", nombre: "Restauración resina 2 caras", dientes: [16], caras: ["M", "O"], estado: "pendiente", cantidad: 1, minutos: 45, agenda: "por_agendar", cita: null },
    { id: "f2", nombre: "Endodoncia multirradicular", dientes: [26], caras: [], estado: "pendiente", cantidad: 1, minutos: 90, agenda: "agendada", cita: { id: "a-vieja", startsAt: "2026-10-24T16:00:00Z", status: "SCHEDULED" } },
    { id: "f3", nombre: "Limpieza", dientes: [], caras: [], estado: "en_curso", cantidad: 1, minutos: null, agenda: "por_agendar", cita: null },
    { id: "f4", nombre: "Extracción", dientes: [38], caras: [], estado: "hecho", cantidad: 1, minutos: 30, agenda: "no_aplica", cita: null },
  ],
};

const PAYLOAD = {
  range: { from: `${DIA}T06:00:00.000Z`, to: `2026-11-11T06:00:00.000Z` },
  timezone: TZ,
  slotMinutes: 15,
  dayStart: 8,
  dayEnd: 20,
  schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, enabled: true, openTime: "08:00", closeTime: "20:00" })),
  appointments: [],
  doctors: [{ id: "d1", displayName: "Dr. Luis Ruiz", shortName: "Dr. Ruiz", color: "#2563eb", activeInAgenda: true }],
  resources: [],
  pendingValidation: [],
  waitlistCount: 0,
  bloqueos: [],
};

let navegador: any = null;
let paquete: string | null = null;
after(async () => {
  await navegador?.close();
});

async function abrir(t: { skip(m: string): void }, modo: "plan" | "agenda" | "ventana" | "tarjeta", opciones: { ancho?: number; respuestaPost?: { status: number; body: unknown } } = {}) {
  const chromium = await cargarChromium();
  if (!chromium) {
    t.skip("Playwright no está (NAVEGADOR_DIR): la pantalla NO se ejecutó");
    return null;
  }
  paquete ??= await empaquetar("src/components/dashboard/agenda-nueva/__tests__/arnes-agendar-plan.tsx");
  navegador ??= await chromium.launch({ args: ["--no-sandbox"] });
  const page = await navegador.newPage({ viewport: { width: opciones.ancho ?? 1440, height: 900 } });
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  const posts: any[] = [];
  await page.route("**/*", async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/" || url.pathname === "/dashboard/agenda") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css(modo)}</style></head><body><div id="raiz"></div><script>window.__PAYLOAD__=${JSON.stringify(PAYLOAD)};window.__DIA__=${JSON.stringify(DIA)};window.__MODO__=${JSON.stringify(modo)};window.__HUECO__=${JSON.stringify(HUECO)};</script><script src="/arnes.js"></script></body></html>`,
      });
    }
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    if (url.pathname === "/api/appointments/plan-pendiente") return route.fulfill({ contentType: "application/json", body: JSON.stringify(DATOS) });
    if (url.pathname === "/api/appointments" && req.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify(PAYLOAD) });
    if (url.pathname === "/api/appointments" && req.method() === "POST") {
      posts.push(JSON.parse(req.postData() ?? "{}"));
      const r = opciones.respuestaPost ?? { status: 201, body: { appointment: { id: "nueva", startsAt: HUECO }, whatsapp: null, planItemIds: ["f1", "f3"] } };
      return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
    }
    if (url.pathname === "/api/clinic/me") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ clinic: { waConnected: false } }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  const ruta = modo === "agenda" ? `/dashboard/agenda?date=${DIA}&agendarPlan=plan1&filas=f1,f3` : "/";
  await page.goto(`http://panel.prueba${ruta}`);
  return { page, errores, posts };
}

async function sinScrollHorizontal(page: any) {
  return page.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    const fuera = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && (r.right > ancho + 0.5 || r.left < -0.5);
    });
    return { scroll: document.documentElement.scrollWidth > ancho, fuera: fuera.map((el) => (el as HTMLElement).className || el.tagName).slice(0, 5) };
  });
}

test("hoja: lo pendiente con su duración; lo agendado marcado y sin elegir; el total cambia; manda a la agenda", async (t) => {
  const a = await abrir(t, "plan");
  if (!a) return;
  const boton = a.page.locator("[data-agendar-lo-pendiente]");
  await boton.waitFor({ timeout: 15_000 }).catch((e: Error) => { throw new Error(`no se pintó: ${a.errores.join(" | ") || e.message}`); });
  assert.equal(await boton.innerText(), "Agendar lo pendiente (2)");
  await boton.click();
  const hoja = a.page.getByRole("dialog");
  await hoja.waitFor();
  const texto = await hoja.innerText();
  assert.match(texto, /Restauración resina 2 caras 16/);
  assert.match(texto, /45 min/);
  assert.match(texto, /30 min \(sin duración en el tarifario\)/);
  assert.match(texto, /Agendado · /, "la endodoncia ya tiene cita");
  assert.doesNotMatch(texto, /Extracción/, "lo hecho no sale");
  const casillas = hoja.locator("input[type=checkbox]");
  assert.equal(await casillas.count(), 3);
  assert.equal(await casillas.nth(1).isDisabled(), true, "la agendada no se elige");
  assert.match(await hoja.locator("footer").innerText(), /2 procedimientos · 75 min/);
  mkdirSync(CAPTURAS, { recursive: true });
  await a.page.screenshot({ path: join(CAPTURAS, "hoja-1440.png") });
  await hoja.getByText("Limpieza").click();
  assert.match(await hoja.locator("footer").innerText(), /1 procedimiento · 45 min/);
  await hoja.getByRole("button", { name: "Elegir hora en la agenda" }).click();
  const nav = await a.page.evaluate(() => (window as any).__nav);
  assert.deepEqual(nav, [["push", "/dashboard/agenda?agendarPlan=plan1&filas=f1"]]);
  assert.equal(await a.page.evaluate(() => (window as any).__abrioAgenda), true, "se avisa a la ventana del plan para que se cierre");
  assert.deepEqual(a.errores, []);
});

test("hoja a 390 px: sube desde abajo y nada se sale por los lados", async (t) => {
  const a = await abrir(t, "plan", { ancho: 390 });
  if (!a) return;
  await a.page.locator("[data-agendar-lo-pendiente]").click({ timeout: 15_000 });
  await a.page.getByRole("dialog").waitFor();
  const m = await sinScrollHorizontal(a.page);
  assert.deepEqual(m, { scroll: false, fuera: [] });
  // Ningún botón recorta su texto (un `nowrap` en un botón angosto lo cortaba sin salirse de la caja).
  const recortados = await a.page.evaluate(() =>
    Array.from(document.querySelectorAll("[role=dialog] button")).filter((b) => (b as HTMLElement).scrollWidth > (b as HTMLElement).clientWidth + 1).map((b) => (b as HTMLElement).innerText),
  );
  assert.deepEqual(recortados, []);
  const caja = await a.page.locator(".hoja").boundingBox();
  assert.ok(caja && Math.round(caja.x) === 0 && Math.round(caja.width) === 390, `la hoja ocupa el ancho: ${JSON.stringify(caja)}`);
  await a.page.screenshot({ path: join(CAPTURAS, "hoja-390.png") });
});

test("agenda: aviso + Nueva cita prellenada (paciente, motivo, «Del plan», 75 min); el hueco también; el POST lleva planItemIds", async (t) => {
  const a = await abrir(t, "agenda");
  if (!a) return;
  const aviso = a.page.locator("[data-agendando-del-plan]");
  await aviso.waitFor({ timeout: 15_000 }).catch((e: Error) => { throw new Error(`sin aviso: ${a.errores.join(" | ") || e.message}`); });
  assert.match(await aviso.innerText(), /Agendando del plan de Ana García/);
  assert.match(await aviso.innerText(), /Restauración resina 2 caras 16 · Limpieza · 75 min/);
  // La Nueva cita se abrió sola.
  const nota = a.page.locator("[data-cita-del-plan]");
  await nota.waitFor({ timeout: 10_000 });
  assert.match(await nota.innerText(), /Del plan de tratamiento: Restauración resina 2 caras 16 · Limpieza/);
  const dialogo = a.page.getByRole("dialog");
  assert.match(await dialogo.innerText(), /Ana García/);
  assert.equal(await dialogo.locator("textarea, input").evaluateAll((els: any[]) => els.some((e) => e.value === "Plan: Restauración resina 2 caras 16 · Limpieza")), true, "motivo, con «Plan: » delante");
  assert.equal(await dialogo.locator("input").evaluateAll((els: any[]) => els.some((e) => e.value === "75")), true, "duración del tarifario (75 no es un preset)");
  await a.page.screenshot({ path: join(CAPTURAS, "agenda-dialogo-1440.png") });

  // Se cierra y se vuelve a abrir desde un hueco de la cuadrícula: con el hueco y lo del plan.
  await dialogo.getByRole("button", { name: "Cancelar" }).first().click();
  await nota.waitFor({ state: "detached" });
  await a.page.locator("#hueco").click();
  await nota.waitFor();
  await a.page.getByRole("button", { name: "Crear cita" }).click();
  await a.page.waitForFunction(() => ((window as any).__nav ?? []).some((n: any) => n[0] === "replace"), null, { timeout: 10_000 });
  assert.equal(a.posts.length, 1);
  const cuerpo = a.posts[0];
  assert.deepEqual(cuerpo.planItemIds, ["f1", "f3"]);
  assert.equal(cuerpo.patientId, "p1");
  assert.equal(cuerpo.doctorId, "d1");
  assert.equal(cuerpo.startsAt, HUECO);
  assert.equal(new Date(cuerpo.endsAt).getTime() - new Date(cuerpo.startsAt).getTime(), 75 * 60_000);
  const nav = await a.page.evaluate(() => (window as any).__nav);
  assert.ok(
    nav.some((n: any) => n[0] === "replace" && n[1] === `/dashboard/agenda?date=${DIA}&highlight=nueva`),
    `sale del modo y resalta la cita: ${JSON.stringify(nav)}`,
  );
  assert.deepEqual(a.errores, []);
});

test("agenda: un 409 de las filas se dice con su frase y no como choque de horario", async (t) => {
  const a = await abrir(t, "agenda", { respuestaPost: { status: 409, body: { error: "plan_fila_ya_agendada" } } });
  if (!a) return;
  await a.page.locator("[data-cita-del-plan]").waitFor({ timeout: 15_000 });
  await a.page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).first().click();
  await a.page.locator("#hueco").click();
  await a.page.getByRole("button", { name: "Crear cita" }).click();
  await a.page.getByText("Uno de los procedimientos ya tiene una cita por delante. La cita no se guardó.").waitFor({ timeout: 5_000 });
  assert.equal(await a.page.locator("[data-cita-del-plan]").count(), 1, "la ventana sigue abierta");
  assert.deepEqual(a.errores, []);
});

test("agenda a 390 px: el aviso cabe (dos renglones) y nada se sale por los lados", async (t) => {
  const a = await abrir(t, "agenda", { ancho: 390 });
  if (!a) return;
  await a.page.locator("[data-cita-del-plan]").waitFor({ timeout: 15_000 });
  await a.page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).first().click();
  await a.page.locator("[data-cita-del-plan]").waitFor({ state: "detached" });
  const m = await sinScrollHorizontal(a.page);
  assert.deepEqual(m, { scroll: false, fuera: [] });
  const recortados = await a.page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-agendando-del-plan] button")).filter((b) => (b as HTMLElement).scrollWidth > (b as HTMLElement).clientWidth + 1).map((b) => (b as HTMLElement).innerText),
  );
  assert.deepEqual(recortados, []);
  await a.page.screenshot({ path: join(CAPTURAS, "agenda-aviso-390.png") });
});

/* ── el botón montado donde vive (al unir la fase 2: ventana del plan y tarjeta de la ficha) ── */

test("en el pie de la ventana del plan: sale, abre la hoja, y al ir a la agenda cierra la ventana", async (t) => {
  const a = await abrir(t, "ventana");
  if (!a) return;
  const boton = a.page.locator("footer [data-agendar-lo-pendiente]");
  await boton.waitFor({ timeout: 15_000 }).catch((e: Error) => { throw new Error(`no se pintó en el pie: ${a.errores.join(" | ") || e.message}`); });
  assert.equal(await boton.innerText(), "Agendar lo pendiente (2)");
  await boton.click();
  const hoja = a.page.getByRole("dialog", { name: /Agendar/ });
  await hoja.getByRole("button", { name: "Elegir hora en la agenda" }).click();
  assert.deepEqual(await a.page.evaluate(() => (window as any).__nav), [["push", "/dashboard/agenda?agendarPlan=plan1&filas=f1%2Cf3"]]);
  assert.equal(await a.page.evaluate(() => (window as any).__cerroVentana), true, "la ventana del plan se cierra al ir a la agenda");
  assert.deepEqual(a.errores, []);
});

test("en la tarjeta del plan de la ficha: sale, y tocarlo NO abre el plan (la tarjeta entera es un botón)", async (t) => {
  const a = await abrir(t, "tarjeta");
  if (!a) return;
  const boton = a.page.locator("[data-agendar-lo-pendiente]");
  await boton.waitFor({ timeout: 15_000 }).catch((e: Error) => { throw new Error(`no se pintó en la tarjeta: ${a.errores.join(" | ") || e.message}`); });
  await boton.click();
  await a.page.getByRole("dialog").waitFor();
  await boton.press("Enter").catch(() => {});
  assert.equal(await a.page.evaluate(() => (window as any).__abrioPlan ?? 0), 0, "ni el clic ni Enter abren la ventana del plan");
  await a.page.getByRole("dialog").getByRole("button", { name: "Elegir hora en la agenda" }).click();
  assert.deepEqual(await a.page.evaluate(() => (window as any).__nav), [["push", "/dashboard/agenda?agendarPlan=plan1&filas=f1%2Cf3"]]);
  assert.equal(await a.page.evaluate(() => (window as any).__abrioPlan ?? 0), 0);
  // y tocar la tarjeta fuera del botón sí abre el plan, como siempre
  await a.page.getByText("Plan 20 oct").click();
  assert.equal(await a.page.evaluate(() => (window as any).__abrioPlan ?? 0), 1);
  assert.deepEqual(a.errores, []);
});
