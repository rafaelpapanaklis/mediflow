/**
 * LA CITA «SIN DOCTOR» EN LA AGENDA NUEVA, EN CHROMIUM — ws1-t11 · fase 2 · P2.
 *
 * Run: npm run test:cita-sin-doctor-panel
 *
 * La Agenda nueva ENTERA, la ventana Nueva cita y el panel de la cita de VERDAD, empaquetados con esbuild
 * y con clics de ratón. Fija (plan §2.1-§2.5, decisiones D1/D2/D3/D9):
 *  · Día: columna «Sin doctor» a la IZQUIERDA con sus citas (también una importada de Dentalink, id no
 *    uuid) y su color de PROCEDIMIENTO; con un solo doctor las dos columnas se reparten el ancho;
 *  · sin `sql/cita-sin-doctor.sql` (`sinDoctorDisponible` falso) no hay columna ni opción: todo como hoy;
 *  · Nueva cita desde un botón genérico abre en «Sin doctor», sin `*` en «Profesional», con la rejilla y
 *    su nota; ocupa SOLO el sillón elegido (ni la cita de un doctor ni otra «Sin doctor» en otro sillón
 *    tapan el hueco) y el POST manda `doctorId: null` explícito;
 *  · el clic en un hueco de la columna de un doctor abre con ese doctor; en la de «Sin doctor», sin doctor;
 *  · arrastrar una «Sin doctor» a la columna de un doctor se la ASIGNA («Sin doctor → Dra.»), y al revés
 *    se la quita (`doctorId: null`);
 *  · «Registrar llegada» pregunta «¿Quién lo atiende?» (opcional), «Pasar a consulta» exige doctor y
 *    «Asignar doctor» lo pone sin tocar nada más;
 *  · un DOCTOR con «solo sus citas» ve la «Sin doctor», la «toma» sin diálogo y no ve Editar / Cancelar /
 *    No asistió.
 * Fotos en ~/capturas/cita-sin-doctor/. Sin Playwright (NAVEGADOR_DIR) la prueba se SALTA diciéndolo.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cargarChromium } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";

const RAIZ = process.cwd();
const TZ = "America/Mexico_City";
const CAPTURAS = join(homedir(), "capturas/cita-sin-doctor");
const SIN_DOCTOR = "__sin_doctor__";

/** Un día de dentro de dos semanas (la rejilla de Nueva cita apaga lo que ya pasó). CDMX = UTC−6 todo el año. */
const DIA = (() => {
  const d = new Date(Date.now() + 14 * 86_400_000 - 6 * 3_600_000);
  return d.toISOString().slice(0, 10);
})();
const hora = (h: number, m = 0) => {
  const [y, mo, d] = DIA.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 6, m)).toISOString();
};

// Ids como los de la base: cuid, de siembra y una cita importada de Dentalink (no son uuid).
const DRA = "cm3doctor0000laura000001";
const DR2 = "seed-doctor-2";
const CITA_DOCTOR = "cmabc123xyz0000def456ghi";
const CITA_SD = "seed-appt-sd-1";
const CITA_DENTALINK = "dentalink-appt-88231";
const CITA_TELE = "seed-appt-tele-1";

const PREFIJOS: Record<string, string> = {
  "elegir-doctor-cita.module.css": "edc-",
  "nueva-cita.module.css": "nc-",
  "detalles-al-pasar.module.css": "dap-",
  // Sin hash de CSS Modules su `.velo` tomaría el de la agenda (que tapa todo): con prefijo y sin hoja.
  "confirmar-bloqueo.module.css": "cb-",
};

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
                ? `const anota = (tipo, u) => { (window.__nav ??= []).push([tipo, u]); };
                   export const useRouter = () => ({ push: (u) => anota("push", u), replace: (u) => anota("replace", u), refresh() {}, prefetch() {}, back() {} });
                   export const usePathname = () => location.pathname;
                   export const useSearchParams = () => new URLSearchParams(location.search);
                   export const redirect = () => {}; export const notFound = () => {};`
                : a.path === "next/link"
                  ? `import { createElement, forwardRef } from "react"; export default forwardRef(function Link({ href, prefetch, replace, scroll, ...r }, ref) { return createElement("a", { ...r, ref, href: typeof href === "string" ? href : "#" }); });`
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
          b.onLoad({ filter: /.*/, namespace: "css-doblado" }, (a) => {
            const base = a.path.split("/").pop() ?? "";
            const prefijo = PREFIJOS[base] ?? "";
            return { contents: `export default new Proxy({}, { get: (_t, k) => ${JSON.stringify(prefijo)} + String(k) });`, loader: "js" };
          });
        },
      },
    ],
  });
  return r.outputFiles[0]!.text;
}

/** El CSS de verdad, crudo (clase = llave); las hojas que chocan de nombres van con prefijo. */
function css(): string {
  const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bloque = (t: string, inicio: string) => {
    const i = t.indexOf(inicio);
    return t.slice(i, t.indexOf("}", i) + 1);
  };
  const conPrefijo = (t: string, p: string) => t.replace(/(?<![\w\d-])\.([a-zA-Z_][\w-]*)/g, `.${p}$1`);
  const menu = leer("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.module.css");
  const agenda = leer("src/components/dashboard/agenda-nueva/agenda-nueva.module.css").replace(/:global\(\.dark\)/g, ".dark");
  const elegir = conPrefijo(leer("src/components/dashboard/agenda/elegir-doctor-cita.module.css"), "edc-");
  const nueva = conPrefijo(leer("src/components/dashboard/new-appointment/nueva-cita.module.css").replace(/:global\(\.dark\)/g, ".dark"), "nc-");
  const raiz = ":root{--bg-elev:#fff;--border-soft:rgba(26,24,38,.09);--border-strong:rgba(26,24,38,.18);--text-1:#1a1826;--text-2:#55526a;--text-3:#6e6b82;--brand:#5b3fd6;--brand-soft:#efeafd;--radius:10px;--radius-lg:14px;--shadow-3:0 24px 64px -16px rgba(15,10,30,.45)}";
  const base = "*,::before,::after{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif}";
  return `${raiz} ${base} ${bloque(menu, ".tokens {")} ${agenda} ${elegir} ${nueva}`;
}

interface CitaFalsa {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  patient: { id: string; name: string };
  doctor?: { id: string; shortName: string };
  reason: string;
  resourceId: string | null;
  source: string;
  requiresValidation: boolean;
  overrideReason: null;
}

function cita(id: string, nombre: string, desde: string, hasta: string, extra: Partial<CitaFalsa> = {}): CitaFalsa {
  return {
    id,
    startsAt: desde,
    endsAt: hasta,
    status: "SCHEDULED",
    patient: { id: `p-${id}`, name: nombre },
    reason: "Consulta General",
    resourceId: "r1",
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
    ...extra,
  };
}

const DOCTORES = {
  laura: { id: DRA, displayName: "Dra. Laura Ruiz", shortName: "Dra. Ruiz", color: "#0d9488", activeInAgenda: true },
  mario: { id: DR2, displayName: "Dr. Mario Paz", shortName: "Dr. Paz", color: "#2563eb", activeInAgenda: true },
};

function payload(o: { sinDoctorDisponible?: boolean; dosDoctores?: boolean; conSinDoctor?: boolean; soloDelDoctor?: boolean } = {}) {
  const citas: CitaFalsa[] = [
    cita(CITA_DOCTOR, "Luis Pérez", hora(15), hora(15, 30), { doctor: { id: DRA, shortName: "Dra. Ruiz" }, resourceId: "r2", reason: "Resina" }),
  ];
  // Una teleconsulta de la doctora (v2, m4): nunca puede quedarse «Sin doctor».
  citas.push(cita(CITA_TELE, "Rosa León", hora(13), hora(13, 30), { doctor: { id: DRA, shortName: "Dra. Ruiz" }, resourceId: null, isTeleconsult: true } as any));
  if (o.conSinDoctor !== false) {
    citas.push(cita(CITA_SD, "Sofía Torres", hora(16), hora(16, 45), { reason: "Limpieza", resourceId: "r1" }));
    citas.push(cita(CITA_DENTALINK, "Marta Ríos", hora(16), hora(16, 30), { resourceId: "r2", status: "CONFIRMED" }));
  }
  return {
    range: { from: `${DIA}T06:00:00.000Z`, to: new Date(new Date(`${DIA}T06:00:00.000Z`).getTime() + 86_400_000).toISOString() },
    timezone: TZ,
    slotMinutes: 15,
    dayStart: 8,
    dayEnd: 20,
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, enabled: true, openTime: "08:00", closeTime: "20:00" })),
    appointments: o.soloDelDoctor ? citas : citas,
    doctors: o.dosDoctores ? [DOCTORES.laura, DOCTORES.mario] : [DOCTORES.laura],
    resources: [
      { id: "r1", name: "Sillón 1", kind: "SILLA_DENTAL", color: null, orderIndex: 0, isActive: true },
      { id: "r2", name: "Sillón 2", kind: "SILLA_DENTAL", color: null, orderIndex: 1, isActive: true },
    ],
    pendingValidation: [],
    waitlistCount: 0,
    bloqueos: [],
    horarioDelDia: { abierto: true, aperturaMin: 8 * 60, cierreMin: 20 * 60 },
    agendaFlexible: {
      encendida: true,
      modoColor: "procedimiento",
      procedimientos: [{ id: "proc-limpieza", nombre: "Limpieza", color: "verde" }],
    },
    sinDoctorDisponible: o.sinDoctorDisponible ?? true,
  };
}

let navegador: any = null;
let paquete: string | null = null;
after(async () => {
  await navegador?.close();
});

interface Abierta {
  page: any;
  errores: string[];
  posts: any[];
  patches: { url: string; body: any }[];
}

async function abrir(
  t: { skip(m: string): void },
  o: { ancho?: number; rol?: string; usuario?: string; datos?: ReturnType<typeof payload>; chocaAlLlegar?: boolean; chocaAlAsignar?: boolean } = {},
): Promise<Abierta | null> {
  const chromium = await cargarChromium();
  if (!chromium) {
    t.skip("Playwright no está (NAVEGADOR_DIR): la pantalla NO se ejecutó");
    return null;
  }
  paquete ??= await empaquetar("src/components/dashboard/agenda-nueva/__tests__/arnes-sin-doctor.tsx");
  navegador ??= await chromium.launch({ args: ["--no-sandbox"] });
  const page = await navegador.newPage({ viewport: { width: o.ancho ?? 1440, height: 900 } });
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  const datos = o.datos ?? payload();
  const citas = new Map<string, any>(datos.appointments.map((a) => [a.id, { ...a }]));
  const posts: any[] = [];
  const patches: { url: string; body: any }[] = [];
  const nombreCorto = (id: string) => [DOCTORES.laura, DOCTORES.mario].find((d) => d.id === id)?.shortName ?? "Doctor";
  await page.route("**/*", async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/dashboard/agenda") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css()}</style></head><body class="tokens"><div id="raiz"></div><script>window.__PAYLOAD__=${JSON.stringify(datos)};window.__DIA__=${JSON.stringify(DIA)};window.__ROL__=${JSON.stringify(o.rol ?? "ADMIN")};window.__USUARIO__=${JSON.stringify(o.usuario ?? "cmadmin000000000000000001")};</script><script src="/arnes.js"></script></body></html>`,
      });
    }
    if (p === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    if (p === "/api/appointments" && req.method() === "GET") return json({ ...datos, appointments: [...citas.values()] });
    if (p === "/api/appointments" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}");
      posts.push(body);
      return json({ appointment: { id: "nueva", startsAt: body.startsAt }, whatsapp: null }, 201);
    }
    const mCita = p.match(/^\/api\/appointments\/([^/]+)(\/status)?$/);
    if (mCita && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}");
      patches.push({ url: p, body });
      // Contrato «§P1 v2»: llegar con un doctor que ya tiene otra cita a esa hora = 409 confirmable.
      if (o.chocaAlLlegar && mCita[2] && body.status === "CHECKED_IN" && body.doctorId && !body.sobreagendar) {
        return json(
          {
            error: "appointment_overlap",
            sobreagendable: true,
            conflictingAppointment: { id: CITA_DOCTOR, patientName: "Luis Pérez", startsAt: hora(16), endsAt: hora(16, 30), doctorId: body.doctorId, resourceId: null, status: "SCHEDULED", otras: 0 },
            comida: null,
            reason: "Dra. Laura Ruiz ya tiene otra cita a esa hora (Luis Pérez). Si de todos modos lo atiende, confírmalo y la cita queda como sobreturno.",
          },
          409,
        );
      }
      // v2 (m5): asignar un doctor que ya tiene otra cita a esa hora, con agenda flexible = 409 confirmable.
      if (o.chocaAlAsignar && !mCita[2] && body.doctorId && !body.sobreagendar) {
        return json(
          {
            error: "appointment_overlap",
            sobreagendable: true,
            conflictingAppointment: { id: CITA_DOCTOR, patientName: "Luis Pérez", startsAt: hora(16), endsAt: hora(16, 30), doctorId: body.doctorId, resourceId: null, status: "SCHEDULED", otras: 0 },
            comida: null,
            reason: "La doctora ya tiene otra cita a esa hora.",
          },
          409,
        );
      }
      const actual = citas.get(decodeURIComponent(mCita[1]));
      if (!actual) return json({ error: "not_found" }, 404);
      const nueva = { ...actual };
      if (body.status) nueva.status = body.status;
      if (body.startsAt) nueva.startsAt = body.startsAt;
      if (body.endsAt) nueva.endsAt = body.endsAt;
      if ("resourceId" in body) nueva.resourceId = body.resourceId;
      if (typeof body.doctorId === "string") nueva.doctor = { id: body.doctorId, shortName: nombreCorto(body.doctorId) };
      else if (body.doctorId === null) delete nueva.doctor;
      citas.set(nueva.id, nueva);
      return json({ appointment: nueva });
    }
    if (p === "/api/agenda/range") return json({ appointments: [...citas.values()], bloqueos: [] });
    if (p === "/api/clinic/me") return json({ clinic: { waConnected: false } });
    if (p === "/api/pediatrics/context") return json({ pediatric: false });
    if (p === "/api/orthodontics/context") return json({});
    return json({}, 404);
  });
  await page.goto(`http://panel.prueba/dashboard/agenda?date=${DIA}`);
  await page
    .locator("[data-columna]")
    .first()
    .waitFor({ timeout: 20_000 })
    .catch((e: Error) => {
      throw new Error(`la agenda no se pintó: ${errores.join(" | ") || e.message}`);
    });
  return { page, errores, posts, patches };
}

/** La columna en la que está pintada una cita (su `data-columna`). */
async function columnaDe(page: any, citaId: string): Promise<string | null> {
  return page.evaluate(
    `(() => { const el = document.querySelector('[data-cita=${JSON.stringify(citaId)}]'); return el ? (el.closest('[data-columna]')?.getAttribute('data-columna') ?? null) : null; })()`,
  );
}

async function abrirNuevaCitaGenerica(page: any) {
  await page.locator("#nueva-con-paciente").click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("[data-campo=doctorId] select").waitFor({ timeout: 10_000 });
  return dialogo;
}

/** Un clic en un hueco libre arriba de la columna (08:15 más o menos: ahí no hay citas). */
async function clicEnHueco(page: any, columna: string) {
  const col = page.locator(`[data-columna="${columna}"]`);
  await col.scrollIntoViewIfNeeded();
  const caja = await col.boundingBox();
  assert.ok(caja, `sin columna ${columna}`);
  const visibleArriba = Math.max(caja.y, 0);
  await page.mouse.move(caja.x + caja.width / 2, visibleArriba + 60);
  await page.mouse.click(caja.x + caja.width / 2, visibleArriba + 60);
}

test("Día: «Sin doctor» a la izquierda con sus dos citas (y la importada) y el color del procedimiento; con un solo doctor se reparten el ancho", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  const columnas: string[] = await a.page.$$eval("[data-columna]", (els: Element[]) => els.map((e) => e.getAttribute("data-columna")));
  assert.deepEqual(columnas, [SIN_DOCTOR, DRA], "«Sin doctor» primero (a la izquierda), después la doctora");
  assert.equal(await columnaDe(a.page, CITA_SD), SIN_DOCTOR);
  assert.equal(await columnaDe(a.page, CITA_DENTALINK), SIN_DOCTOR, "la importada de Dentalink (id no uuid) también");
  assert.equal(await columnaDe(a.page, CITA_DOCTOR), DRA);
  const cabecera = a.page.locator("[data-columna-sin-doctor]");
  assert.match(await cabecera.innerText(), /Sin doctor/);
  assert.match(await cabecera.innerText(), /2 citas/);
  assert.doesNotMatch(await cabecera.innerText(), /\bSD\b|\bSR\b/, "sin iniciales inventadas");
  // Color por procedimiento sin doctor: «Limpieza» lleva su verde.
  const sombra: string = await a.page.locator(`[data-cita="${CITA_SD}"]`).evaluate((el: HTMLElement) => el.style.boxShadow);
  assert.match(sombra, /--ag-proc-verde/, `la barra es la del procedimiento: ${sombra}`);
  // Con un solo doctor las dos columnas son anchas y parecidas (ninguna se queda en un hilo).
  const anchos: number[] = await a.page.$$eval("[data-columna]", (els: Element[]) => els.map((e) => e.getBoundingClientRect().width));
  assert.ok(anchos.every((x) => x > 400), `anchos: ${anchos}`);
  assert.ok(Math.abs(anchos[0] - anchos[1]) < 4, `se reparten el ancho: ${anchos}`);
  // La leyenda del color nombra a «Sin doctor»… solo en modo doctor; en procedimiento, «Limpieza».
  mkdirSync(CAPTURAS, { recursive: true });
  await a.page.screenshot({ path: join(CAPTURAS, "dia-1440.png") });
  assert.deepEqual(a.errores, []);
});

test("sin el SQL (`sinDoctorDisponible` falso) y sin ninguna: ni columna ni opción; Nueva cita abre con la doctora, como hoy", async (t) => {
  const a = await abrir(t, { datos: payload({ sinDoctorDisponible: false, conSinDoctor: false }) });
  if (!a) return;
  const columnas: string[] = await a.page.$$eval("[data-columna]", (els: Element[]) => els.map((e) => e.getAttribute("data-columna")));
  assert.deepEqual(columnas, [DRA]);
  const dialogo = await abrirNuevaCitaGenerica(a.page);
  const select = dialogo.locator("[data-campo=doctorId] select");
  assert.equal(await select.inputValue(), DRA);
  assert.equal(await select.locator(`option[value="${SIN_DOCTOR}"]`).count(), 0);
  assert.match(await dialogo.locator("[data-campo=doctorId]").innerText(), /Profesional\*/i);
  assert.deepEqual(a.errores, []);
});

test("Nueva cita genérica: «Sin doctor» por defecto, sin `*`, con la rejilla y su nota; ocupa solo el sillón; el POST manda doctorId null", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  const dialogo = await abrirNuevaCitaGenerica(a.page);
  const select = dialogo.locator("[data-campo=doctorId] select");
  assert.equal(await select.inputValue(), SIN_DOCTOR, "abre en «Sin doctor»");
  assert.equal(await select.locator("option").first().getAttribute("value"), SIN_DOCTOR, "y es la primera opción");
  assert.equal(await select.locator("option").first().innerText(), "Sin doctor");
  const rotulo = await dialogo.locator("[data-campo=doctorId]").innerText();
  assert.match(rotulo, /Profesional/i);
  assert.doesNotMatch(rotulo, /Profesional\*/i, "con «Sin doctor» el campo deja de ser obligatorio");
  await dialogo.locator("[data-nota-sin-doctor]").waitFor({ timeout: 10_000 });
  assert.match(await dialogo.locator("[data-nota-sin-doctor]").innerText(), /no se bloquean entre sí/);
  // Sillón 1: la «Sin doctor» de las 16:00 (45 min) lo ocupa; la cita de la doctora (Sillón 2, 15:00) no.
  await dialogo.locator("[data-campo=resourceId] select").selectOption("r1");
  const hueco = (h: string) => dialogo.locator('[role="gridcell"]', { hasText: new RegExp(`^${h}$`) });
  await hueco("17:00").waitFor({ timeout: 10_000 });
  await a.page.waitForFunction(`(() => { const b = [...document.querySelectorAll('[role="gridcell"]')].find((x) => x.textContent.trim() === "16:00"); return b && b.disabled; })()`, null, { timeout: 10_000 });
  assert.equal(await hueco("15:00").isDisabled(), false, "la cita de la doctora en otro sillón no tapa a una «Sin doctor»");
  assert.equal(await hueco("16:00").isDisabled(), true, "el sillón 1 está ocupado a las 16:00");
  assert.equal(await hueco("16:30").isDisabled(), true);
  assert.equal(await hueco("16:45").isDisabled(), false);
  // Sillón 2: a las 16:00 está la de Dentalink (otra «Sin doctor»): ahí sí ocupa, por SILLÓN.
  await dialogo.locator("[data-campo=resourceId] select").selectOption("r2");
  assert.equal(await hueco("16:00").isDisabled(), true);
  assert.equal(await hueco("15:00").isDisabled(), true, "la doctora ocupa el sillón 2 a las 15:00");
  await dialogo.locator("[data-campo=resourceId] select").selectOption("r1");
  await dialogo.getByRole("button", { name: "Limpieza", exact: true }).click();
  await hueco("17:00").click();
  assert.match(await a.page.locator("[data-resumen-sin-doctor]").innerText(), /Sin doctor/);
  await a.page.screenshot({ path: join(CAPTURAS, "nueva-cita-1440.png") });
  await a.page.getByRole("button", { name: "Crear cita" }).click();
  // Se guardó y la ventana se cerró (sin `openAgendaAfter` solo hace `router.refresh()`).
  await dialogo.locator("[data-campo=doctorId]").waitFor({ state: "detached", timeout: 10_000 });
  assert.equal(a.posts.length, 1);
  assert.ok("doctorId" in a.posts[0], "el campo viaja (ausente sería el 400 de siempre)");
  assert.equal(a.posts[0].doctorId, null);
  assert.equal(a.posts[0].resourceId, "r1");
  assert.equal(a.posts[0].startsAt, hora(17));
  assert.deepEqual(a.errores, []);
});

test("clic en un hueco: en la columna de la doctora abre con ella; en «Sin doctor», sin doctor", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  await clicEnHueco(a.page, DRA);
  let dialogo = a.page.getByRole("dialog");
  let select = dialogo.locator("[data-campo=doctorId] select");
  await select.waitFor({ timeout: 10_000 });
  assert.equal(await select.inputValue(), DRA);
  await dialogo.getByRole("button", { name: "Cancelar" }).first().click();
  await select.waitFor({ state: "detached" });
  await clicEnHueco(a.page, SIN_DOCTOR);
  dialogo = a.page.getByRole("dialog");
  select = dialogo.locator("[data-campo=doctorId] select");
  await select.waitFor({ timeout: 10_000 });
  assert.equal(await select.inputValue(), SIN_DOCTOR);
  assert.deepEqual(a.errores, []);
});

/** Arrastra una tarjeta a otra columna, a la misma altura (dnd-kit: puntero real, más de la distancia de arranque). */
async function arrastrar(page: any, citaId: string, columna: string) {
  const tarjeta = page.locator(`[data-cita="${citaId}"]`);
  await tarjeta.scrollIntoViewIfNeeded();
  const t = await tarjeta.boundingBox();
  const c = await page.locator(`[data-columna="${columna}"]`).boundingBox();
  assert.ok(t && c);
  const y = t.y + Math.min(12, t.height / 2);
  await page.mouse.move(t.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(t.x + 40, y, { steps: 4 });
  await page.mouse.move(c.x + c.width / 2, y, { steps: 12 });
  await page.mouse.move(c.x + c.width / 2 + 2, y, { steps: 2 });
  await page.mouse.up();
}

test("arrastrar: una «Sin doctor» a la columna de la doctora se la asigna («Sin doctor → Dra.»); al revés se la quita", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  await arrastrar(a.page, CITA_SD, DRA);
  const modal = a.page.getByRole("dialog");
  await modal.getByText("Mover cita").first().waitFor({ timeout: 10_000 });
  const texto = await modal.innerText();
  assert.match(texto, /Sin doctor/, `antes: «Sin doctor» — ${texto}`);
  assert.match(texto, /Dra\. Laura Ruiz/);
  await modal.getByRole("button", { name: "Mover cita" }).click();
  await a.page.waitForFunction(`document.querySelector('[data-cita="${CITA_SD}"]')?.closest('[data-columna]')?.getAttribute('data-columna') === ${JSON.stringify(DRA)}`, null, { timeout: 10_000 });
  assert.equal(a.patches.length, 1);
  assert.equal(a.patches[0].url, `/api/appointments/${CITA_SD}`);
  assert.equal(a.patches[0].body.doctorId, DRA);

  await arrastrar(a.page, CITA_DOCTOR, SIN_DOCTOR);
  await a.page.getByRole("dialog").getByRole("button", { name: "Mover cita" }).click({ timeout: 10_000 });
  await a.page.waitForFunction(`document.querySelector('[data-cita="${CITA_DOCTOR}"]')?.closest('[data-columna]')?.getAttribute('data-columna') === ${JSON.stringify(SIN_DOCTOR)}`, null, { timeout: 10_000 });
  assert.equal(a.patches.length, 2);
  assert.ok("doctorId" in a.patches[1].body);
  assert.equal(a.patches[1].body.doctorId, null, "soltar en «Sin doctor» le quita el doctor");
  assert.deepEqual(a.errores, []);
});

test("panel: «Registrar llegada» pregunta «¿Quién lo atiende?» (opcional); «Pasar a consulta» exige doctor; «Asignar doctor»", async (t) => {
  const a = await abrir(t, { datos: payload({ dosDoctores: true }) });
  if (!a) return;
  await a.page.locator(`[data-cita="${CITA_SD}"]`).click();
  await a.page.getByRole("button", { name: "Registrar llegada" }).click({ timeout: 10_000 });
  let pregunta = a.page.locator("[data-elegir-doctor=llegada]");
  await pregunta.waitFor({ timeout: 5_000 });
  assert.match(await pregunta.innerText(), /¿Quién lo atiende\?/);
  assert.equal(await pregunta.locator("select").inputValue(), SIN_DOCTOR, "opcional: abre en «Sin doctor»");
  await a.page.screenshot({ path: join(CAPTURAS, "llegada-1440.png") });
  await pregunta.locator("[data-confirmar-doctor]").click();
  await a.page.waitForFunction(`document.querySelectorAll("[data-elegir-doctor]").length === 0`, null, { timeout: 5_000 });
  assert.equal(a.patches.length, 1);
  assert.equal(a.patches[0].url, `/api/appointments/${CITA_SD}/status`);
  assert.deepEqual(a.patches[0].body, { status: "CHECKED_IN" }, "«Sin doctor» al llegar: la cita sigue sin doctor");

  await a.page.getByRole("button", { name: "Pasar a consulta" }).first().click({ timeout: 10_000 });
  pregunta = a.page.locator("[data-elegir-doctor=iniciar]");
  await pregunta.waitFor({ timeout: 5_000 });
  assert.equal(await pregunta.locator(`option[value="${SIN_DOCTOR}"]`).count(), 0, "al iniciar no se ofrece «Sin doctor»");
  assert.equal(await pregunta.locator("[data-confirmar-doctor]").isDisabled(), true, "con dos doctores, hay que elegir");
  await a.page.screenshot({ path: join(CAPTURAS, "iniciar-1440.png") });
  await pregunta.locator("select").selectOption(DR2);
  await pregunta.locator("[data-confirmar-doctor]").click();
  await a.page.waitForFunction(`(window.__nav ?? []).some((n) => n[0] === "push")`, null, { timeout: 10_000 });
  assert.deepEqual(a.patches[1].body, { status: "IN_PROGRESS", doctorId: DR2 });

  // «Asignar doctor» en la otra «Sin doctor» (la importada de Dentalink).
  await a.page.locator(`[data-cita="${CITA_DENTALINK}"]`).click();
  await a.page.locator("[data-asignar-doctor]").click({ timeout: 10_000 });
  const asignar = a.page.locator("[data-elegir-doctor=asignar]");
  await asignar.locator("select").selectOption(DRA);
  await asignar.locator("[data-confirmar-doctor]").click();
  await a.page.waitForFunction(`document.querySelector('[data-cita="${CITA_DENTALINK}"]')?.closest('[data-columna]')?.getAttribute('data-columna') === ${JSON.stringify(DRA)}`, null, { timeout: 10_000 });
  assert.deepEqual(a.patches[2], { url: `/api/appointments/${CITA_DENTALINK}`, body: { doctorId: DRA } });
  assert.deepEqual(a.errores, []);
});

test("DOCTOR con «solo sus citas»: ve la «Sin doctor», la toma sin diálogo y no ve Editar / Cancelar / No asistió", async (t) => {
  const a = await abrir(t, { rol: "DOCTOR", usuario: DRA });
  if (!a) return;
  assert.equal(await columnaDe(a.page, CITA_SD), SIN_DOCTOR);
  await a.page.locator(`[data-cita="${CITA_SD}"]`).click();
  const tomar = a.page.locator("[data-asignar-doctor]");
  await tomar.waitFor({ timeout: 10_000 });
  assert.equal(await tomar.innerText(), "Tomar cita");
  const pie = a.page.locator("aside");
  for (const nombre of ["Editar", "Cancelar", "No asistió"]) {
    assert.equal(await pie.getByRole("button", { name: nombre, exact: true }).count(), 0, `sin «${nombre}»`);
  }
  await tomar.click();
  await a.page.waitForFunction(`document.querySelector('[data-cita="${CITA_SD}"]')?.closest('[data-columna]')?.getAttribute('data-columna') === ${JSON.stringify(DRA)}`, null, { timeout: 10_000 });
  assert.equal(await a.page.locator("[data-elegir-doctor]").count(), 0, "un DOCTOR no elige: se la queda");
  assert.deepEqual(a.patches, [{ url: `/api/appointments/${CITA_SD}`, body: { doctorId: DRA } }]);
  assert.deepEqual(a.errores, []);
});

test("llegada con un doctor que ya tiene otra cita: el «¿Seguro?» (409 de §P1 v2) habla de ese doctor y se reenvía confirmado", async (t) => {
  const a = await abrir(t, { chocaAlLlegar: true });
  if (!a) return;
  await a.page.locator(`[data-cita="${CITA_SD}"]`).click();
  await a.page.getByRole("button", { name: "Registrar llegada" }).click({ timeout: 10_000 });
  const pregunta = a.page.locator("[data-elegir-doctor=llegada]");
  await pregunta.locator("select").selectOption(DRA);
  await pregunta.locator("[data-confirmar-doctor]").click();
  const seguro = a.page.getByRole("dialog").filter({ hasText: "Luis Pérez" });
  await seguro.waitFor({ timeout: 10_000 });
  assert.doesNotMatch(await seguro.innerText(), /sillón/i, "el choque es del doctor elegido, no del sillón");
  await seguro.getByRole("button", { name: "Sí, sobreagendar" }).click();
  await a.page.waitForFunction(`document.querySelector('[data-cita="${CITA_SD}"]')?.closest('[data-columna]')?.getAttribute('data-columna') === ${JSON.stringify(DRA)}`, null, { timeout: 10_000 });
  assert.equal(a.patches.length, 2);
  assert.deepEqual(a.patches[0].body, { status: "CHECKED_IN", doctorId: DRA });
  assert.deepEqual(a.patches[1].body, { status: "CHECKED_IN", doctorId: DRA, sobreagendar: true, sobreagendarCita: CITA_DOCTOR, sobreagendarOtras: 0 });
  assert.deepEqual(a.errores, []);
});

// ── v2 (revisión de t12) ─────────────────────────────────────────────────────────────────────────

test("M2: un DOCTOR no deja SU cita «Sin doctor»: soltarla en esa columna avisa y no manda nada; Editar no lo ofrece", async (t) => {
  const a = await abrir(t, { rol: "DOCTOR", usuario: DRA });
  if (!a) return;
  await arrastrar(a.page, CITA_DOCTOR, SIN_DOCTOR);
  await a.page.getByText("Una cita tuya no se puede dejar «Sin doctor»", { exact: false }).waitFor({ timeout: 10_000 });
  assert.equal(await a.page.getByRole("dialog").filter({ hasText: "Mover cita" }).count(), 0, "sin «Mover cita»");
  assert.equal(await columnaDe(a.page, CITA_DOCTOR), DRA, "la tarjeta no se movió");
  assert.deepEqual(a.patches, []);
  // Editar su propia cita: sin la opción «Sin doctor».
  await a.page.locator(`[data-cita="${CITA_DOCTOR}"]`).click();
  await a.page.locator("aside").getByRole("button", { name: "Editar", exact: true }).click({ timeout: 10_000 });
  const select = a.page.locator(`select:has(option[value="${DRA}"])`).last();
  await select.waitFor({ timeout: 10_000 });
  assert.equal(await select.locator(`option[value="${SIN_DOCTOR}"]`).count(), 0, "un DOCTOR no ve «Sin doctor» en su cita");
  assert.deepEqual(a.errores, []);
});

test("M2 (contraprueba): recepción sí ve «Sin doctor» al editar una cita con doctor", async (t) => {
  const a = await abrir(t, { rol: "RECEPTIONIST", usuario: "cmrecep00000000000000001" });
  if (!a) return;
  await a.page.locator(`[data-cita="${CITA_DOCTOR}"]`).click();
  await a.page.locator("aside").getByRole("button", { name: "Editar", exact: true }).click({ timeout: 10_000 });
  const select = a.page.locator(`select:has(option[value="${DRA}"])`).last();
  await select.waitFor({ timeout: 10_000 });
  assert.equal(await select.locator(`option[value="${SIN_DOCTOR}"]`).count(), 1);
  assert.deepEqual(a.errores, []);
});

test("m4: una teleconsulta soltada en «Sin doctor» avisa con su texto y no se mueve", async (t) => {
  const a = await abrir(t);
  if (!a) return;
  await arrastrar(a.page, CITA_TELE, SIN_DOCTOR);
  await a.page.getByText("Una teleconsulta necesita doctor", { exact: false }).waitFor({ timeout: 10_000 });
  assert.equal(await columnaDe(a.page, CITA_TELE), DRA);
  assert.deepEqual(a.patches, []);
  assert.deepEqual(a.errores, []);
});

test("m5: «Asignar doctor» con la doctora ocupada pregunta «¿Seguro?» y reenvía confirmado", async (t) => {
  const a = await abrir(t, { chocaAlAsignar: true });
  if (!a) return;
  await a.page.locator(`[data-cita="${CITA_DENTALINK}"]`).click();
  await a.page.locator("[data-asignar-doctor]").click({ timeout: 10_000 });
  await a.page.locator("[data-elegir-doctor=asignar] [data-confirmar-doctor]").click();
  const seguro = a.page.getByRole("dialog").filter({ hasText: "Luis Pérez" });
  await seguro.waitFor({ timeout: 10_000 });
  await seguro.getByRole("button", { name: "Sí, sobreagendar" }).click();
  await a.page.waitForFunction(`document.querySelector('[data-cita="${CITA_DENTALINK}"]')?.closest('[data-columna]')?.getAttribute('data-columna') === ${JSON.stringify(DRA)}`, null, { timeout: 10_000 });
  assert.deepEqual(a.patches.map((p) => p.body), [
    { doctorId: DRA },
    { doctorId: DRA, sobreagendar: true, sobreagendarCita: CITA_DOCTOR, sobreagendarOtras: 0 },
  ]);
  assert.deepEqual(a.errores, []);
});

// ── v3 ───────────────────────────────────────────────────────────────────────────────────────────

test("m7: Editar la cita de un doctor inactivo cuyo nombre llega vacío dice «Doctor de la cita» (no una opción en blanco)", async (t) => {
  const datos = payload();
  const INACTIVO = "cmdoctorinactivo00000001";
  datos.appointments.push(cita("cmcitainactivo0000000001", "Pepe Luna", hora(9), hora(9, 30), { doctor: { id: INACTIVO, shortName: "" }, resourceId: "r1" }));
  const a = await abrir(t, { datos });
  if (!a) return;
  await a.page.locator('[data-cita="cmcitainactivo0000000001"]').click();
  await a.page.locator("aside").getByRole("button", { name: "Editar", exact: true }).click({ timeout: 10_000 });
  const opcion = a.page.locator(`option[value="${INACTIVO}"]`);
  await opcion.waitFor({ state: "attached", timeout: 10_000 });
  assert.equal((await opcion.textContent())?.trim(), "Doctor de la cita");
  assert.deepEqual(a.errores, []);
});
