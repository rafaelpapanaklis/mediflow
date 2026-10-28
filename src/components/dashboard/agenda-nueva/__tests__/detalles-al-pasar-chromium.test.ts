/**
 * LA TARJETA DE DETALLES AL PASAR EL MOUSE, EN CHROMIUM (decisión de Rafael, 28-oct-2026).
 *
 * Run: npm run test:agenda-detalles-al-pasar
 *
 * La Agenda nueva ENTERA (proveedores de verdad, la tarjeta de cita de verdad, el filtro de verdad),
 * empaquetada con esbuild y con el CSS de verdad, con el mouse de Playwright. Fija:
 *  · sale tras ~300 ms quieto, con alergias arriba y en rojo, estado, «En esta cita», «Debe hoy» y avisos;
 *  · pasar por encima sin detenerse NO pide nada; la segunda vez sale de la caché (una sola petición);
 *  · si el mouse se va antes de que llegue la respuesta, la petición se CANCELA y no sale nada;
 *  · un clic la esconde y abre el panel; apagada desde el filtro no sale y la cita recupera su `title`;
 *  · en táctil (390 px) no sale al tocar: tocar abre el panel, y no se pide nada;
 *  · modo oscuro y en inglés. Fotos en ~/capturas/agenda-hover/.
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
const CAPTURAS = join(homedir(), "capturas/agenda-hover");
const hora = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h + 6, m)).toISOString(); // CDMX = UTC−6

/** Las clases de la hoja de la tarjeta van con prefijo: comparte nombres (`.tarjeta`…) con la de la agenda. */
const PREFIJO = "dap-";

async function empaquetar(entrada: string): Promise<string> {
  const esbuild = await import("esbuild");
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
            contents:
              a.path === "next/navigation"
                ? `export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {} });
                   export const usePathname = () => "/dashboard/agenda";
                   export const useSearchParams = () => new URLSearchParams();
                   export const redirect = () => {}; export const notFound = () => {};`
                : a.path === "next/link"
                  ? `import { createElement } from "react"; export default function Link({ href, prefetch, replace, scroll, ...r }) { return createElement("a", { ...r, href: typeof href === "string" ? href : "#" }); }`
                  : `const f = () => ({ className: "", variable: "", style: {} }); export default f;`,
            loader: "js",
            resolveDir: RAIZ,
          }));
          // Acciones de servidor (`"use server"`): Next las cambia por una llamada RPC; aquí, por funciones que lanzan.
          b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (a) => {
            const texto = readFileSync(a.path, "utf8");
            if (!/^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(texto)) return undefined;
            const nombres = [...texto.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
            return {
              contents: nombres.map((n) => `export async function ${n}() { throw new Error("acción de servidor ${n}"); }`).join("\n"),
              loader: "js",
            };
          });
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "css-doblado" }));
          b.onResolve({ filter: /\.css$/ }, (a) => ({ path: join(a.resolveDir, a.path), namespace: "css-doblado" }));
          b.onLoad({ filter: /.*/, namespace: "css-doblado" }, (a) => ({
            contents: a.path.endsWith("detalles-al-pasar.module.css")
              ? `export default new Proxy({}, { get: (_t, k) => ${JSON.stringify(PREFIJO)} + String(k) });`
              : `export default new Proxy({}, { get: (_t, k) => String(k) });`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return r.outputFiles[0]!.text;
}

/** El CSS de verdad, crudo (clase = llave): tokens del menú, la agenda nueva y la tarjeta (con prefijo). */
function css(): string {
  const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bloque = (t: string, inicio: string) => {
    const i = t.indexOf(inicio);
    return t.slice(i, t.indexOf("}", i) + 1);
  };
  const menu = leer("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css");
  const agenda = leer("src/components/dashboard/agenda-nueva/agenda-nueva.module.css").replace(/:global\(\.dark\)/g, ".dark");
  const tarjeta = leer("src/components/dashboard/agenda-nueva/detalles-al-pasar.module.css")
    .replace(/(?<![\w\d-])\.([a-zA-Z_][\w-]*)/g, `.${PREFIJO}$1`);
  const base = "*,::before,::after{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif} html.dark body{background:#14131b}";
  return `${base} ${bloque(menu, ".tokens {")} ${bloque(menu, ":global(.dark) .tokens {").replace(":global(.dark)", ".dark")} ${agenda} ${tarjeta}`;
}

function cita(id: string, nombre: string, desde: string, hasta: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    startsAt: desde,
    endsAt: hasta,
    status,
    patient: { id: id === "a-rest" ? "" : `p-${id}`, name: nombre },
    doctor: { id: "d1", shortName: "Dra. Ruiz" },
    reason: "Resina",
    resourceId: "r1",
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
    ...extra,
  };
}

function payload() {
  return {
    range: { from: `${DIA}T06:00:00.000Z`, to: `2026-11-11T06:00:00.000Z` },
    timezone: TZ,
    slotMinutes: 15,
    dayStart: 8,
    dayEnd: 16,
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, enabled: true, openTime: "08:00", closeTime: "16:00" })),
    appointments: [
      cita("a-ana", "Ana García", hora(9), hora(10), "CONFIRMED", { depositoPagado: true }),
      cita("a-luis", "Luis Pérez", hora(10, 30), hora(11, 30), "CHECKED_IN", { checkedInAt: new Date(Date.now() - 12 * 60_000).toISOString(), reason: "Limpieza" }),
      cita("a-sofi", "Sofía Torres", hora(12), hora(13), "SCHEDULED", { anticipoPedido: 300, ortoMensualidadVencida: true, reason: "Control de ortodoncia" }),
      cita("a-rest", "Paciente restringido", hora(14), hora(15), "SCHEDULED"),
    ],
    doctors: [{ id: "d1", displayName: "Dra. Laura Ruiz", shortName: "Dra. Ruiz", color: "#0d9488", activeInAgenda: true }],
    resources: [{ id: "r1", name: "Sillón 1", kind: "SILLA_DENTAL", color: null, orderIndex: 0, isActive: true }],
    pendingValidation: [],
    waitlistCount: 0,
    bloqueos: [],
  };
}

const PESADO: Record<string, unknown> = {
  "a-ana": {
    paciente: { edad: 34, primeraVez: false, telefono: "55 1234 5678" },
    alergias: ["Penicilina", "Látex"],
    confirmadaPorWhatsapp: true,
    enEstaCita: [{ id: "f1", nombre: "Resina 16 (MO)", importe: 700, estado: "pendiente" }],
    debeHoy: 700,
  },
  "a-luis": { paciente: { edad: 52, primeraVez: true, telefono: null }, alergias: [], confirmadaPorWhatsapp: false, enEstaCita: [], debeHoy: 0 },
  "a-sofi": { paciente: { edad: 15, primeraVez: false, telefono: "55 0000 1111" }, alergias: [], confirmadaPorWhatsapp: false, enEstaCita: [], debeHoy: 1200 },
};

let navegador: any = null;
let paquete: string | null = null;
after(async () => {
  await navegador?.close();
});

interface Opciones {
  ancho?: number;
  lang?: "es" | "en";
  oscuro?: boolean;
  tactil?: boolean;
  /** Milisegundos que tarda la respuesta de lo pesado. */
  demora?: number;
  preferencia?: boolean;
}

async function abrir(t: { skip(m: string): void }, o: Opciones = {}) {
  const chromium = await cargarChromium();
  if (!chromium) {
    t.skip("Playwright no está (NAVEGADOR_DIR): la pantalla NO se ejecutó");
    return null;
  }
  paquete ??= await empaquetar("src/components/dashboard/agenda-nueva/__tests__/arnes-detalles-al-pasar.tsx");
  navegador ??= await chromium.launch({ args: ["--no-sandbox"] });
  const contexto = await navegador.newContext({
    viewport: { width: o.ancho ?? 1440, height: 900 },
    ...(o.tactil ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await contexto.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  const pedidos: string[] = [];
  const cancelados: string[] = [];
  const puts: unknown[] = [];
  page.on("requestfailed", (r: any) => {
    if (r.url().includes("/detalles-al-pasar")) cancelados.push(new URL(r.url()).pathname);
  });
  const lang = o.lang ?? "es";
  await page.route("**/*", async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/dashboard/agenda") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="${lang}" class="${o.oscuro ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css()}</style></head><body><div id="raiz"></div><script>window.__PAYLOAD__=${JSON.stringify(payload())};window.__DIA__=${JSON.stringify(DIA)};window.__LANG__=${JSON.stringify(lang)};</script><script src="/arnes.js"></script></body></html>`,
      });
    }
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    if (url.pathname === "/api/agenda/range") return route.fulfill({ contentType: "application/json", body: JSON.stringify(payload()) });
    if (url.pathname === "/api/agenda/detalles-al-pasar") {
      if (req.method() === "PUT") {
        puts.push(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ contentType: "application/json", body: req.postData() });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ encendida: o.preferencia ?? true }) });
    }
    const m = url.pathname.match(/^\/api\/appointments\/([^/]+)\/detalles-al-pasar$/);
    if (m) {
      pedidos.push(m[1]);
      if (o.demora) await new Promise((r) => setTimeout(r, o.demora));
      return route
        .fulfill({ contentType: "application/json", body: JSON.stringify(PESADO[m[1]] ?? {}) })
        .catch(() => {});
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto(`http://panel.prueba/dashboard/agenda`);
  await page
    .locator('[data-cita="a-ana"]')
    .waitFor({ timeout: 20_000 })
    .catch((e: Error) => {
      throw new Error(`la agenda no se pintó: ${errores.join(" | ") || e.message}`);
    });
  return { page, contexto, errores, pedidos, cancelados, puts };
}

const TARJETA = "[data-detalles-al-pasar]";

/** El color calculado de un nodo, en RGB (Chromium devuelve `oklch(...)` tal cual): se pinta en un canvas. */
async function rgbDe(page: any, selector: string, propiedad: "color" | "backgroundColor"): Promise<[number, number, number]> {
  return page.locator(selector).first().evaluate((el: HTMLElement, prop: string) => {
    const c = document.createElement("canvas").getContext("2d")!;
    c.fillStyle = (getComputedStyle(el) as any)[prop];
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, propiedad);
}

async function centro(page: any, id: string) {
  await page.locator(`[data-cita="${id}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(50);
  const c = await page.locator(`[data-cita="${id}"]`).boundingBox();
  return { x: c.x + Math.min(40, c.width / 2), y: c.y + c.height / 2 };
}

test("sale a los ~300 ms con todo: alergias arriba en rojo, estado por WhatsApp, «En esta cita», «Debe hoy», avisos", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  const { page } = a;
  assert.equal(await page.locator('[data-cita="a-ana"]').getAttribute("title"), null, "con la tarjeta, sin title nativo");
  const p = await centro(page, "a-ana");
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  assert.equal(await page.locator(TARJETA).count(), 0, "antes del retardo no sale");
  assert.deepEqual(a.pedidos, [], "ni se pide nada");
  const tarjeta = page.locator(TARJETA);
  await tarjeta.waitFor({ timeout: 3_000 });
  await page.locator(`${TARJETA} [data-dinero]`).waitFor({ timeout: 3_000 });
  const texto = await tarjeta.innerText();
  assert.match(texto, /Alergias:\s*Penicilina, Látex/);
  assert.match(texto, /Ana García/);
  assert.match(texto, /Confirmada por WhatsApp/);
  assert.match(texto, /34 años · Recurrente/);
  assert.match(texto, /55 1234 5678/);
  assert.match(texto, /09:00–10:00/);
  assert.match(texto, /Dra\. Laura Ruiz/);
  assert.match(texto, /Sillón 1/);
  assert.match(texto, /Resina/);
  assert.match(texto, /En esta cita[\s\S]*Resina 16 \(MO\)[\s\S]*\$700\.00[\s\S]*por hacer/i);
  assert.match(texto, /Debe hoy\s*\$700\.00/);
  assert.match(texto, /Anticipo pagado/);
  // Las alergias son lo PRIMERO y van en rojo (el token rojo de la agenda, no un hex).
  const primero = await tarjeta.evaluate((el: HTMLElement) => (el.firstElementChild as HTMLElement).hasAttribute("data-alergias"));
  assert.equal(primero, true, "las alergias van arriba");
  const [r, g, b] = await rgbDe(page, `${TARJETA} [data-alergias]`, "color");
  assert.ok(r > g + 40 && r > b + 40, `las alergias en rojo: ${[r, g, b]}`);
  // La tarjeta no se sale de la ventana y no tapa la cita.
  const caja = await tarjeta.boundingBox();
  const deCita = await page.locator('[data-cita="a-ana"]').boundingBox();
  assert.ok(caja.x >= 0 && caja.x + caja.width <= 1440 && caja.y >= 0 && caja.y + caja.height <= 900, JSON.stringify(caja));
  // En Día con un solo doctor la cita ocupa casi todo el ancho: la tarjeta va junto al cursor, sin taparlo.
  const tapaCursor = p.x >= caja.x && p.x <= caja.x + caja.width && p.y >= caja.y && p.y <= caja.y + caja.height;
  assert.equal(tapaCursor, false, `no tapa el cursor: ${JSON.stringify({ caja, p, deCita })}`);
  assert.equal(await page.locator('[data-cita="a-ana"]').getAttribute("aria-describedby"), "detalles-cita-a-ana");
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, "claro-1440.png") });
  await tarjeta.screenshot({ path: join(CAPTURAS, "tarjeta-claro.png") });
  assert.deepEqual(a.pedidos, ["a-ana"], "una sola petición");

  // Se va el mouse: se esconde. Vuelve: sale de la caché, sin otra petición.
  await page.mouse.move(5, 5);
  await tarjeta.waitFor({ state: "detached" });
  await page.mouse.move(p.x, p.y);
  await tarjeta.waitFor();
  assert.match(await tarjeta.innerText(), /Debe hoy\s*\$700\.00/);
  assert.deepEqual(a.pedidos, ["a-ana"], "la segunda vez, de la caché");

  // Sala de espera con sus minutos; «Primera vez» como marca; sin dinero ni alergias, esas partes no salen.
  await page.mouse.move(5, 5);
  const l = await centro(page, "a-luis");
  await page.mouse.move(l.x, l.y);
  await page.locator(`${TARJETA}[data-detalles-al-pasar="a-luis"]`).waitFor();
  await page.waitForFunction(() => /Primera vez/.test(document.querySelector("[data-detalles-al-pasar]")?.textContent ?? ""));
  const luis = await page.locator(TARJETA).innerText();
  assert.match(luis, /En sala de espera · 1[12] min/);
  assert.match(luis, /52 años/);
  assert.equal(await page.locator(`${TARJETA} [data-alergias]`).count(), 0);
  assert.equal(await page.locator(`${TARJETA} [data-dinero]`).count(), 0, "debe 0 y nada en la cita: sin bloque de dinero");

  // Avisos: anticipo pedido y mensualidad de ortodoncia vencida; «Debe hoy» aunque no haya nada del plan en la cita.
  await page.mouse.move(5, 5);
  const so = await centro(page, "a-sofi");
  await page.mouse.move(so.x, so.y);
  await page.locator(`${TARJETA}[data-detalles-al-pasar="a-sofi"] [data-dinero]`).waitFor();
  const sofi = await page.locator(TARJETA).innerText();
  assert.match(sofi, /Sin confirmar/);
  assert.match(sofi, /Anticipo pedido · \$300\.00/);
  assert.match(sofi, /Mensualidad de ortodoncia vencida/);
  assert.match(sofi, /Debe hoy\s*\$1,200\.00/);
  await page.locator(TARJETA).screenshot({ path: join(CAPTURAS, "tarjeta-avisos.png") });

  // Paciente restringido: la tarjeta sale con lo ligero y NO se pide nada de él.
  await page.mouse.move(5, 5);
  const re = await centro(page, "a-rest");
  await page.mouse.move(re.x, re.y);
  await page.locator(`${TARJETA}[data-detalles-al-pasar="a-rest"]`).waitFor();
  assert.match(await page.locator(TARJETA).innerText(), /Paciente con acceso restringido/);
  assert.ok(!a.pedidos.includes("a-rest"));
  assert.deepEqual(a.errores, []);
});

test("pasar por encima sin detenerse no pide nada; irse antes de la respuesta la cancela", async (t) => {
  const a = await abrir(t, { demora: 1_500 });
  if (!a) return;
  const { page } = a;
  // Barrer las cuatro citas de arriba abajo, sin pararse.
  for (const id of ["a-ana", "a-luis", "a-sofi", "a-rest"]) {
    const p = await centro(page, id);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(60);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  assert.deepEqual(a.pedidos, [], "ni una petición");
  assert.equal(await page.locator(TARJETA).count(), 0);

  // Quieto lo justo para que salga y se pida, y se va antes de que conteste: se cancela.
  const p = await centro(page, "a-ana");
  await page.mouse.move(p.x, p.y);
  await page.locator(TARJETA).waitFor();
  await page.waitForFunction(() => document.querySelector("[data-detalles-al-pasar]")?.textContent?.includes("Ana García"));
  await page.waitForTimeout(100);
  await page.mouse.move(5, 5);
  await page.locator(TARJETA).waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  assert.deepEqual(a.pedidos, ["a-ana"]);
  assert.deepEqual(a.cancelados, ["/api/appointments/a-ana/detalles-al-pasar"], "la petición se canceló");
  assert.deepEqual(a.errores, []);
});

test("un clic la esconde y abre el panel; apagada desde el filtro no sale, la cita recupera su title y se guarda en la cuenta", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  const { page } = a;
  const p = await centro(page, "a-ana");
  await page.mouse.move(p.x, p.y);
  await page.locator(TARJETA).waitFor();
  await page.mouse.down();
  await page.mouse.up();
  await page.locator(TARJETA).waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-cita="a-ana"]').getAttribute("aria-pressed"), "true", "el clic abrió la cita");

  // Con el botón apretado (arrastrando), las citas que cruza no enseñan la tarjeta ni piden nada.
  const antes = a.pedidos.length;
  await page.mouse.move(p.x, p.y + 6);
  await page.mouse.down();
  const l = await page.locator('[data-cita="a-luis"]').boundingBox();
  await page.mouse.move(l.x + 40, l.y + l.height / 2, { steps: 8 });
  await page.waitForTimeout(600);
  assert.equal(await page.locator(TARJETA).count(), 0, "arrastrando: nada");
  assert.equal(a.pedidos.length, antes);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);

  // El interruptor, hasta abajo del filtro (después de los sillones).
  await page.mouse.move(5, 5);
  await page.locator('[aria-haspopup="true"][title]').first().click();
  const interruptor = page.locator("[data-interruptor-detalles]");
  await interruptor.waitFor();
  const orden = await page.evaluate(() => {
    const menu = document.querySelector("[data-interruptor-detalles]")!.parentElement!;
    const hijos = Array.from(menu.children);
    const sillon = hijos.findIndex((h) => h.textContent?.includes("Sillón 1"));
    return { sillon, interruptor: hijos.indexOf(document.querySelector("[data-interruptor-detalles]")!), total: hijos.length };
  });
  assert.ok(orden.interruptor > orden.sillon && orden.interruptor === orden.total - 1, JSON.stringify(orden));
  assert.equal(await interruptor.getAttribute("aria-checked"), "true", "viene encendida");
  assert.match(await interruptor.innerText(), /Mostrar detalles al pasar el mouse/);
  await page.screenshot({ path: join(CAPTURAS, "filtro-interruptor.png") });
  await interruptor.click();
  assert.equal(await interruptor.getAttribute("aria-checked"), "false");
  await page.waitForFunction(() => true);
  await page.keyboard.press("Escape");
  assert.deepEqual(a.puts, [{ encendida: false }]);
  assert.match((await page.locator('[data-cita="a-ana"]').getAttribute("title")) ?? "", /Ana García · 09:00–10:00/, "apagada: el title de siempre");
  const pedidosAntes = a.pedidos.length;
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(700);
  assert.equal(await page.locator(TARJETA).count(), 0, "apagada: no sale");
  assert.equal(a.pedidos.length, pedidosAntes, "apagada: no pide nada");
  assert.deepEqual(a.errores, []);
});

test("la preferencia guardada en la cuenta manda: apagada, no sale", async (t) => {
  const a = await abrir(t, { preferencia: false });
  if (!a) return;
  await a.page.waitForFunction(() => document.querySelector('[data-cita="a-ana"]')?.getAttribute("title") !== null);
  const p = await centro(a.page, "a-ana");
  await a.page.mouse.move(p.x, p.y);
  await a.page.waitForTimeout(700);
  assert.equal(await a.page.locator(TARJETA).count(), 0);
  assert.deepEqual(a.pedidos, []);
});

test("táctil a 390 px: tocar abre el panel, la tarjeta no sale y no se pide nada", async (t) => {
  const a = await abrir(t, { ancho: 390, tactil: true });
  if (!a) return;
  const { page } = a;
  assert.notEqual(await page.locator('[data-cita="a-ana"]').getAttribute("title"), null, "en táctil, el title se queda");
  await page.locator('[data-cita="a-ana"]').tap();
  await page.waitForTimeout(700);
  assert.equal(await page.locator(TARJETA).count(), 0);
  assert.deepEqual(a.pedidos, []);
  assert.equal(await page.locator('[data-cita="a-ana"]').getAttribute("aria-pressed"), "true", "tocar abrió la cita");
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, "tactil-390.png") });
  assert.deepEqual(a.errores, []);
});

test("mouse a 390 px: la tarjeta cabe en la ventana", async (t) => {
  const a = await abrir(t, { ancho: 390 });
  if (!a) return;
  const p = await centro(a.page, "a-ana");
  await a.page.mouse.move(p.x, p.y);
  await a.page.locator(`${TARJETA} [data-dinero]`).waitFor();
  const caja = await a.page.locator(TARJETA).boundingBox();
  assert.ok(caja.x >= 0 && caja.x + caja.width <= 390, JSON.stringify(caja));
  await a.page.screenshot({ path: join(CAPTURAS, "mouse-390.png") });
});

test("modo oscuro: la tarjeta toma los tokens oscuros (fondo oscuro, letra clara, alergias legibles)", async (t) => {
  const a = await abrir(t, { oscuro: true });
  if (!a) return;
  const p = await centro(a.page, "a-ana");
  await a.page.mouse.move(p.x, p.y);
  await a.page.locator(`${TARJETA} [data-dinero]`).waitFor();
  const luz = (c: number[]) => (c[0] + c[1] + c[2]) / 3;
  const fondo = await rgbDe(a.page, TARJETA, "backgroundColor");
  const letra = await rgbDe(a.page, TARJETA, "color");
  assert.ok(luz(fondo) < 80, `fondo oscuro: ${fondo}`);
  assert.ok(luz(letra) > 170, `letra clara: ${letra}`);
  const [r, g, b] = await rgbDe(a.page, `${TARJETA} [data-alergias]`, "color");
  assert.ok(r > g + 30 && r > b + 30 && luz([r, g, b]) > 120, `alergias rojas y legibles sobre oscuro: ${[r, g, b]}`);
  await a.page.locator(TARJETA).screenshot({ path: join(CAPTURAS, "tarjeta-oscuro.png") });
  await a.page.screenshot({ path: join(CAPTURAS, "oscuro-1440.png") });
});

test("en inglés", async (t) => {
  const a = await abrir(t, { lang: "en" });
  if (!a) return;
  const p = await centro(a.page, "a-ana");
  await a.page.mouse.move(p.x, p.y);
  await a.page.locator(`${TARJETA} [data-dinero]`).waitFor();
  const texto = await a.page.locator(TARJETA).innerText();
  assert.match(texto, /Allergies:/);
  assert.match(texto, /Confirmed via WhatsApp/);
  assert.match(texto, /34 years old · Returning/);
  assert.match(texto, /In this appointment/i);
  assert.match(texto, /Owes today/);
  assert.match(texto, /Deposit paid/);
  await a.page.locator(TARJETA).screenshot({ path: join(CAPTURAS, "tarjeta-en.png") });
});

test("también en Semana (la tarjeta compacta)", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  await a.page.getByRole("tab", { name: "Semana", exact: true }).click();
  await a.page.waitForTimeout(400);
  const p = await centro(a.page, "a-sofi");
  await a.page.mouse.move(p.x, p.y);
  await a.page.locator(`${TARJETA}[data-detalles-al-pasar="a-sofi"] [data-dinero]`).waitFor();
  const caja = await a.page.locator(TARJETA).boundingBox();
  assert.ok(caja.x >= 0 && caja.x + caja.width <= 1440 && caja.y >= 0 && caja.y + caja.height <= 900, JSON.stringify(caja));
  await a.page.screenshot({ path: join(CAPTURAS, "semana-1440.png") });
  assert.deepEqual(a.errores, []);
});
