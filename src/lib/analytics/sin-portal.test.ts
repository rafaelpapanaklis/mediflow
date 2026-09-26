// La analítica propia no registra NADA en lo que ve un paciente (/paciente, /portal
// y los enlaces con token), ni en el cliente ni en el servidor. /dashboard sigue igual.

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  isPatientPath,
  isTrackingIgnored,
  surfaceFromPath,
  FLUSH_INTERVAL_MS,
} from "./constants";
import { start, stop, pageview } from "./tracker-core";

/* ============================ 1 · la decisión ============================ */

test("rutas de paciente: ignoradas, con query, hash, mayúsculas y barras dobles", () => {
  for (const p of [
    "/paciente", "/paciente/login", "/paciente/inbox?x=1", "/portal/abc123", "/portal/prescription/9/verify",
    "/PACIENTE/documentos", "//paciente/registro", "/cita/tok/confirmar", "/consentimiento/tok",
    "/presupuesto/tok", "/resena/tok", "/share/p/tok", "/pago/exitoso", "/pago/abc#x",
  ]) {
    assert.equal(isTrackingIgnored(p), true, p);
  }
});

test("dashboard, landing y el resto público siguen midiéndose; el límite es de segmento", () => {
  for (const p of [
    "/", "/dashboard", "/dashboard/pacientes", "/reservar/mi-clinica", "/descubre", "/r/ABC", "/socio/x",
    "/teleconsulta/1", "/pagos", "/portales", "/pacientes", "/citas", "/precios", "/afiliados/login",
  ]) {
    assert.equal(isTrackingIgnored(p), false, p);
  }
  assert.equal(isPatientPath("/dashboard/pacientes"), false);
});

test("admin y live siguen ignorados", () => {
  assert.equal(isTrackingIgnored("/admin/analytics"), true);
  assert.equal(isTrackingIgnored("/live"), true);
});

test("surfaceFromPath ya no produce «portal»", () => {
  assert.notEqual(surfaceFromPath("/paciente/login"), "portal");
  assert.equal(surfaceFromPath("/dashboard/agenda"), "dashboard");
});

/* ======================== 2 · el cliente, con DOM falso ===================== */

type Handler = (e?: unknown) => void;

function fakeDom() {
  const saved = { ...(globalThis as Record<string, unknown>) };
  const bodies: string[] = [];
  const winL = new Map<string, Handler[]>();
  const docL = new Map<string, Handler[]>();
  const store = new Map<string, string>();
  const add = (m: Map<string, Handler[]>) => (t: string, h: Handler) => {
    m.set(t, [...(m.get(t) || []), h]);
  };
  const rm = (m: Map<string, Handler[]>) => (t: string, h: Handler) => {
    m.set(t, (m.get(t) || []).filter((x) => x !== h));
  };
  const doc = {
    visibilityState: "visible", cookie: "", referrer: "", title: "Prueba",
    documentElement: { scrollHeight: 2000 }, body: { scrollHeight: 2000 },
    addEventListener: add(docL), removeEventListener: rm(docL),
  };
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { search: "" }, screen: { width: 1440, height: 900 },
    innerWidth: 1440, innerHeight: 900, scrollY: 0,
    getComputedStyle: () => ({ position: "static" }),
    addEventListener: add(winL), removeEventListener: rm(winL),
  };
  win.self = win;
  win.top = win;
  class FakeBlob {
    parts: string[];
    constructor(parts: string[]) { this.parts = parts; }
  }
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = doc;
  g.navigator = {
    language: "es-MX", userAgent: "prueba",
    sendBeacon: (_u: string, b: FakeBlob) => { bodies.push(b.parts.join("")); return true; },
  };
  g.Blob = FakeBlob;
  g.fetch = (_u: string, init: { body: string }) => { bodies.push(init.body); return { catch: () => undefined }; };
  return {
    click() {
      const target = { tagName: "BUTTON", closest: () => null, getAttribute: () => null, parentElement: null };
      [...(docL.get("click") || [])].forEach((h) => h({ target, clientX: 10, clientY: 10, pageY: 10 }));
    },
    sent: () => bodies.flatMap((b) => JSON.parse(b).events as { type: string; path: string }[]),
    restore() {
      ["window", "document", "navigator", "Blob", "fetch"].forEach((k) => {
        if (k in saved) g[k] = saved[k]; else delete g[k];
      });
    },
  };
}

function conTracker(body: (dom: ReturnType<typeof fakeDom>) => void) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_700_000_000_000 });
  const dom = fakeDom();
  try {
    body(dom);
  } finally {
    try { stop(); } catch { /* limpiando */ }
    dom.restore();
    mock.timers.reset();
  }
}

for (const ruta of ["/paciente/login", "/paciente/inbox", "/portal/tok123", "/cita/tok/confirmar"]) {
  test(`cliente: una visita a ${ruta} no manda nada a /api/track`, () => {
    conTracker((dom) => {
      start();
      pageview(ruta);
      dom.click();
      mock.timers.tick(10 * 60_000); // flushes y latidos
      stop();
      assert.deepEqual(dom.sent(), []);
    });
  });
}

test("cliente: /dashboard sigue enviando pageview y clic", () => {
  conTracker((dom) => {
    start();
    pageview("/dashboard/agenda");
    dom.click();
    mock.timers.tick(FLUSH_INTERVAL_MS);
    const tipos = dom.sent().map((e) => e.type);
    assert.ok(tipos.includes("pageview"), "pageview");
    assert.ok(tipos.includes("click"), "click");
    assert.ok(dom.sent().every((e) => e.path === "/dashboard/agenda"));
  });
});

test("cliente: de /dashboard a /paciente, lo de después no sale", () => {
  conTracker((dom) => {
    start();
    pageview("/dashboard");
    mock.timers.tick(FLUSH_INTERVAL_MS);
    const antes = dom.sent().length;
    pageview("/paciente/login");
    dom.click();
    mock.timers.tick(FLUSH_INTERVAL_MS);
    assert.ok(dom.sent().slice(antes).every((e) => !isPatientPath(e.path)));
  });
});

/* ============================ 3 · el servidor ============================ */

// prisma-admin toma el cliente de globalThis fuera de producción: un doble que anota todo.
const llamadas: string[] = [];
let filasGuardadas: { path: string }[] = [];
const doble = new Proxy(
  {},
  {
    get: (_t, modelo: string) =>
      new Proxy(
        {},
        {
          get: (_m, op: string) => async (arg?: { data?: unknown }) => {
            llamadas.push(`${modelo}.${op}`);
            if (modelo === "analyticsEvent" && op === "createMany") filasGuardadas = arg?.data as { path: string }[];
            return null;
          },
        },
      ),
  },
);
(globalThis as Record<string, unknown>).prismaAdmin = doble;

async function post(events: { type: string; path: string }[]) {
  const { POST } = await import("../../app/api/track/route");
  const req = new Request("http://localhost/api/track", {
    method: "POST",
    headers: { host: "localhost", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36" },
    body: JSON.stringify({ sid: "sesion-123456", vid: "visita-123456", events }),
  });
  return POST(req as never);
}

for (const path of ["/paciente/login", "/portal/tok", "/pago/exitoso"]) {
  test(`servidor: /api/track descarta ${path} sin tocar la base`, async () => {
    llamadas.length = 0;
    const res = await post([{ type: "pageview", path }, { type: "click", path }, { type: "ping", path }]);
    assert.equal(res.status, 204);
    assert.deepEqual(llamadas, []);
  });
}

test("servidor: un batch mezclado guarda sólo lo que no es de paciente", async () => {
  llamadas.length = 0;
  filasGuardadas = [];
  const res = await post([
    { type: "pageview", path: "/dashboard/agenda" },
    { type: "pageview", path: "/paciente/inbox" },
  ]);
  assert.equal(res.status, 204);
  assert.deepEqual(filasGuardadas.map((f) => f.path), ["/dashboard/agenda"]);
});
