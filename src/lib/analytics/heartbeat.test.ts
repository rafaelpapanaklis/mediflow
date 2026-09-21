// Pruebas de la DIETA del tracker (WS1-T3).
//
// Cubren las dos cosas que se arreglaron en el cliente:
//  1. El latido: no late con la pestaña oculta, no late cuando nadie toca nada,
//     y cuando late lo hace cada 60 s y no cada 20 s.
//  2. Los eventos `scroll` por hito (25/50/75/100) ya no se mandan, y la
//     profundidad de scroll sigue llegando dentro de `page_time`.
//
// No hay jsdom en el repo, así que el DOM se simula a mano: es poco y explícito.
// El tiempo lo mueve mock.timers de node:test, así que la prueba no espera ni
// un milisegundo real.

import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  shouldHeartbeat,
  start,
  stop,
  pageview,
} from "./tracker-core";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_IDLE_MS,
  LIVE_WINDOW_MS,
  FLUSH_INTERVAL_MS,
} from "./constants";

/* ========================= 1 · la decisión, en puro ========================= */

const T0 = 1_700_000_000_000;

test("shouldHeartbeat: con la pestaña oculta NO late, pase lo que pase", () => {
  assert.equal(
    shouldHeartbeat({ visible: false, hasPath: true, now: T0, lastActivityAt: T0 }),
    false,
  );
  // ni siquiera recién interactuado
  assert.equal(
    shouldHeartbeat({ visible: false, hasPath: true, now: T0 + 1, lastActivityAt: T0 }),
    false,
  );
});

test("shouldHeartbeat: sin ruta activa no late", () => {
  assert.equal(
    shouldHeartbeat({ visible: true, hasPath: false, now: T0, lastActivityAt: T0 }),
    false,
  );
});

test("shouldHeartbeat: sin ninguna interacción todavía no late", () => {
  assert.equal(
    shouldHeartbeat({ visible: true, hasPath: true, now: T0, lastActivityAt: 0 }),
    false,
  );
});

test("shouldHeartbeat: visible y con actividad reciente, late", () => {
  assert.equal(
    shouldHeartbeat({ visible: true, hasPath: true, now: T0, lastActivityAt: T0 }),
    true,
  );
  assert.equal(
    shouldHeartbeat({
      visible: true,
      hasPath: true,
      now: T0 + HEARTBEAT_IDLE_MS,
      lastActivityAt: T0,
    }),
    true,
    "justo en el límite de inactividad todavía late",
  );
});

test("shouldHeartbeat: pasada la inactividad calla (pestaña visible pero olvidada)", () => {
  assert.equal(
    shouldHeartbeat({
      visible: true,
      hasPath: true,
      now: T0 + HEARTBEAT_IDLE_MS + 1,
      lastActivityAt: T0,
    }),
    false,
  );
});

test("las constantes quedan coherentes entre sí", () => {
  assert.equal(HEARTBEAT_INTERVAL_MS, 60_000, "el latido es de un minuto");
  // La ventana de "en vivo" tiene que aguantar al menos un ping perdido, o el
  // visitante parpadea en el mapa.
  assert.ok(
    LIVE_WINDOW_MS >= 2 * HEARTBEAT_INTERVAL_MS,
    `LIVE_WINDOW_MS (${LIVE_WINDOW_MS}) debe cubrir 2 latidos de ${HEARTBEAT_INTERVAL_MS} ms`,
  );
  // Y el corte por inactividad tiene que dar para varios latidos, o no habría
  // latido que valga.
  assert.ok(HEARTBEAT_IDLE_MS > 2 * HEARTBEAT_INTERVAL_MS);
});

/* ===================== 2 · el tracker entero, con DOM falso ================== */

type Handler = (e?: unknown) => void;

interface Dom {
  fire(type: string, ev?: unknown): void;
  setVisibility(v: "visible" | "hidden"): void;
  /** Todos los eventos que SALIERON hacia /api/track (fetch + sendBeacon). */
  sentEvents(): { type: string; path: string; scrollPct?: number }[];
  restore(): void;
}

function fakeDom(visibility: "visible" | "hidden"): Dom {
  const saved = { ...(globalThis as Record<string, unknown>) };
  const bodies: string[] = [];
  const winL = new Map<string, Handler[]>();
  const docL = new Map<string, Handler[]>();

  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  const add = (m: Map<string, Handler[]>) => (t: string, h: Handler) => {
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(h);
  };
  const rm = (m: Map<string, Handler[]>) => (t: string, h: Handler) => {
    const a = m.get(t);
    if (a) m.set(t, a.filter((x) => x !== h));
  };

  const doc = {
    visibilityState: visibility,
    cookie: "",
    referrer: "",
    title: "Prueba",
    documentElement: { scrollHeight: 2000 },
    body: { scrollHeight: 2000 },
    addEventListener: add(docL),
    removeEventListener: rm(docL),
  };

  const win: Record<string, unknown> = {
    localStorage,
    location: { search: "" },
    screen: { width: 1440, height: 900 },
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
    getComputedStyle: () => ({ position: "static" }),
    addEventListener: add(winL),
    removeEventListener: rm(winL),
  };
  win.self = win;
  win.top = win; // fuera de iframe → el tracker arranca

  // Blob que se puede leer en síncrono, para inspeccionar lo que va por beacon.
  class FakeBlob {
    parts: string[];
    constructor(parts: string[]) {
      this.parts = parts;
    }
  }

  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = doc;
  g.navigator = {
    language: "es-MX",
    userAgent: "prueba",
    sendBeacon: (_url: string, blob: FakeBlob) => {
      bodies.push(blob.parts.join(""));
      return true;
    },
  };
  g.Blob = FakeBlob;
  g.fetch = (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    return { catch: () => undefined };
  };

  return {
    fire(type, ev) {
      [...(docL.get(type) || []), ...(winL.get(type) || [])].forEach((h) => h(ev));
    },
    setVisibility(v) {
      doc.visibilityState = v;
      this.fire("visibilitychange");
    },
    sentEvents() {
      return bodies.flatMap((b) => JSON.parse(b).events);
    },
    restore() {
      ["window", "document", "navigator", "Blob", "fetch"].forEach((k) => {
        if (k in saved) g[k] = saved[k];
        else delete g[k];
      });
    },
  };
}

/** Prepara DOM + reloj falso, corre el cuerpo y limpia pase lo que pase. */
function conTracker(
  visibility: "visible" | "hidden",
  body: (dom: Dom) => void,
): void {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const dom = fakeDom(visibility);
  try {
    body(dom);
  } finally {
    try {
      stop();
    } catch {
      /* da igual: ya estamos limpiando */
    }
    dom.restore();
    mock.timers.reset();
  }
}

const pings = (dom: Dom) => dom.sentEvents().filter((e) => e.type === "ping").length;

/** Un ping no viaja solo: se encola y sale en el flush siguiente (5 s). Para
 *  contar lo que DE VERDAD salió a la red hay que dejar pasar ese flush. Son
 *  5 s, muy por debajo del minuto del latido, así que drenar no añade pings. */
const drenar = () => mock.timers.tick(FLUSH_INTERVAL_MS);

test("pestaña OCULTA: el latido no manda NADA, ni en diez minutos", () => {
  conTracker("hidden", (dom) => {
    start();
    pageview("/");
    mock.timers.tick(10 * 60 * 1000);
    drenar();
    assert.equal(pings(dom), 0, "una pestaña en segundo plano no habla");
  });
});

test("pestaña visible y con actividad: late una vez por minuto, no tres", () => {
  conTracker("visible", (dom) => {
    start();
    pageview("/");
    // Cinco minutos tocando algo cada minuto → cinco latidos, no quince.
    for (let i = 0; i < 5; i += 1) {
      mock.timers.tick(60_000);
      dom.fire("scroll"); // interacción: mantiene vivo el latido
    }
    drenar();
    assert.equal(pings(dom), 5);
  });
});

test("la pestaña se oculta a media sesión: el latido se corta ahí mismo", () => {
  conTracker("visible", (dom) => {
    start();
    pageview("/");
    mock.timers.tick(60_000);
    drenar();
    assert.equal(pings(dom), 1);

    dom.setVisibility("hidden");
    mock.timers.tick(10 * 60 * 1000);
    drenar();
    assert.equal(pings(dom), 1, "oculta = cero latidos nuevos");
  });
});

test("pestaña visible pero OLVIDADA: calla sola tras el corte de inactividad", () => {
  conTracker("visible", (dom) => {
    start();
    pageview("/");
    // Nadie toca nada nunca más. Se avanza minuto a minuto (un tick gigante
    // haría saltar el reloj al final antes de correr los intervalos, y entonces
    // no se estaría midiendo nada).
    for (let i = 0; i < 60; i += 1) mock.timers.tick(60_000); // una hora entera
    drenar();

    const enviados = pings(dom);
    const tope = Math.ceil(HEARTBEAT_IDLE_MS / HEARTBEAT_INTERVAL_MS) + 1;
    assert.ok(
      enviados > 0,
      "los primeros minutos sí late: el visitante acaba de entrar",
    );
    assert.ok(
      enviados <= tope,
      `una hora olvidada debe dar como mucho ${tope} latidos, dio ${enviados}`,
    );
    // Lo que importa: con el latido viejo (20 s y sin corte por inactividad)
    // esa misma hora habrían sido 180 peticiones.
    assert.ok(enviados < 10);
  });
});

test("vuelve a primer plano: el latido se reanuda", () => {
  conTracker("visible", (dom) => {
    start();
    pageview("/");
    dom.setVisibility("hidden");
    mock.timers.tick(5 * 60 * 1000);
    drenar();
    const enOculto = pings(dom);

    dom.setVisibility("visible");
    mock.timers.tick(60_000);
    drenar();
    assert.equal(pings(dom), enOculto + 1, "al volver, vuelve a latir");
  });
});

test("los eventos scroll por hito ya no se mandan, y la profundidad sigue llegando", () => {
  conTracker("visible", (dom) => {
    start();
    pageview("/");

    // Scroll hasta el fondo: con el código viejo esto habría metido 4 filas.
    (globalThis as { window: { scrollY: number } }).window.scrollY = 1100;
    dom.fire("scroll");
    mock.timers.tick(300); // el debounce de 250 ms

    dom.fire("pagehide"); // salida → page_time por beacon

    const eventos = dom.sentEvents();
    assert.equal(
      eventos.filter((e) => e.type === "scroll").length,
      0,
      "ni un solo evento scroll: nadie los leía",
    );

    const pageTime = eventos.find((e) => e.type === "custom");
    assert.ok(pageTime, "page_time tiene que salir igual");
    assert.ok(
      (pageTime.scrollPct ?? 0) > 0,
      "y tiene que llevar la profundidad de scroll dentro",
    );
  });
});

test("el ping lleva la profundidad de scroll a cuestas (sin escribir ni una fila)", () => {
  // Por qué importa: `page_time` sólo sale al cerrar la página. Si el navegador
  // mata la pestaña sin pagehide ni visibilitychange, ese evento no llega nunca.
  // El ping es el segundo camino, y no cuesta ni una petición ni una fila: los
  // ping no se persisten, pero /api/track sube analytics_sessions.maxScroll con
  // el max de scrollPct de CUALQUIER evento del batch.
  conTracker("visible", (dom) => {
    start();
    pageview("/");

    (globalThis as { window: { scrollY: number } }).window.scrollY = 1100;
    dom.fire("scroll");
    mock.timers.tick(300); // el debounce de 250 ms

    mock.timers.tick(60_000); // un latido
    drenar();

    const ping = dom.sentEvents().find((e) => e.type === "ping");
    assert.ok(ping, "tiene que haber latido");
    assert.ok(
      (ping.scrollPct ?? 0) > 0,
      "y el ping tiene que llevar la profundidad dentro",
    );
  });
});

test("el click sigue saliendo: es lo que come el heatmap", () => {
  conTracker("visible", (dom) => {
    start();
    pageview("/");

    const el = {
      tagName: "BUTTON",
      id: "",
      className: "cta",
      closest: () => null,
      getAttribute: () => null,
      innerText: "Agendar",
      parentElement: null,
    };
    dom.fire("click", { target: el, clientX: 720, clientY: 400, pageY: 400 });
    mock.timers.tick(1500); // CLICK_FLUSH_MS

    const clicks = dom.sentEvents().filter((e) => e.type === "click");
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].path, "/");
  });
});
