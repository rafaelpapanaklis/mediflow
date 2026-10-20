/**
 * ws1-t11 · revisiones t4 y t8 — el autoguardado en vivo, ejecutando el caso.
 *
 * Tercera vuelta (decisión del gerente): se guarda al instante y se reintenta
 * MIENTRAS la pestaña siga abierta, con un aviso fijo «No se guardó: sin
 * conexión, reintentando» mientras haya algo pendiente; al cerrar u ocultar,
 * `beforeunload` avisa y `pagehide`/`visibilitychange` mandan con keepalive.
 * NO hay copia en el navegador entre sesiones: al cargar se borran las llaves
 * `dc:odo-pendiente:*` de versiones anteriores.
 *
 * Lo que queda de la revisión, cada caso ejecutado:
 *  - N3-O1: el 403 del reto de dos pasos NO descarta: se aparta y sale al
 *    volver el mismo usuario.
 *  - N3-O2: «Reintentar» y el evento `online` no mandan nada si la sesión es
 *    de otro usuario.
 *  - N3-O3: lo que lleva más de 15 min fallando no sale solo al volver la red.
 *  - N3-O4: un 404 porque la sede activa cambió en otra pestaña no se tira:
 *    se aparta con aviso claro; un 404 de verdad se descarta y sale del dibujo.
 *  - O3: abrir sin red da un mensaje en español (carga real con fetch real).
 * Cuarta vuelta (t8):
 *  - N4-O1: «Reintentar» sin red no toma el fallo de la pregunta «¿quién
 *    soy?» como «otra sesión»: todo se queda como estaba y sale al volver.
 *  - N4-O2: el temporizador del reintento pregunta antes de mandar; sin
 *    poder preguntar no manda; sin saber de quién es la cola, el keepalive
 *    no manda (la cadena con el servidor está en sync-cambios.test.ts).
 *  - N4-O3: «Descartar» del aviso fijo solo se ve si hay algo apartado.
 *  - N4-O4: lo descartado con el odontograma fuera de pantalla no se aplica
 *    al dibujo después.
 *  - N3-O3 (todo lo de la noche, no solo el primero) y N3-O1 (el guardia
 *    del reto de dos pasos no se lleva la pestaña con algo pendiente).
 * t4 O2/O3: rótulo «Incisal» y errores en español.
 *
 * Los eventos de la página son `EventTarget`/`Event` reales de Node.
 *
 * Run: npx tsx --test src/components/dashboard/odontogram-v2/__tests__/autosave-cierre.test.ts
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SaveQueue, saveQueueFor, installPageHandlers, renderPendingNotice, textoAvisoPendiente, limpiarCopiasViejas,
  _resetQueuesForTests, NOTICE_ID, OTRA_SESION, STALE_AFTER_MS,
  type KeyValueStore, type SaveOp, type NoticeDoc, type NoticeEl, type SessionInfo,
} from "../autosave";
import { putFinding, setNote, fetchOdontogram, fetchQuienSoy, rotuloCara, OdontogramHttpError, SESION_VENCIDA, FALTA_DOS_PASOS } from "../adapter";
import { instalarGuardia2FA } from "../../two-factor-fetch-guard";
import { cargarOdontograma, quitarDelDibujo } from "../recuperar";

const settle = () => new Promise((r) => setImmediate(r));
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await settle(); };

/** localStorage en memoria (misma API mínima). */
function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

/** Temporizadores reales que no retienen el proceso de prueba. */
const timers = {
  setTimer: (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref(); return t; },
  clearTimer: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Error como los del adaptador (status + código de la API). */
class HttpErr extends Error { constructor(public status: number, public code: string | null = null) { super(`HTTP ${status}`); } }

/** Servidor de mentira: red que se puede cortar o respuestas de error con código. */
function server() {
  const sent: { op: SaveOp; keepalive: boolean }[] = [];
  let fallo: HttpErr | null = null;
  return {
    sent,
    offline() { fallo = new HttpErr(0); }, online() { fallo = null; },
    fail(status: number, code: string | null = null) { fallo = new HttpErr(status, code); },
    send: (op: SaveOp, o: { keepalive: boolean }) => {
      sent.push({ op, keepalive: o.keepalive });
      return fallo === null ? Promise.resolve() : Promise.reject(fallo);
    },
  };
}

function page() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  return { win, doc };
}

const DRA_A: SessionInfo = { clinicId: "cli_1", userId: "u_a" };
const DR_B: SessionInfo = { clinicId: "cli_1", userId: "u_b" };
const A_EN_SEDE_2: SessionInfo = { clinicId: "cli_2", userId: "u_a" };
const put = (n: number, s: string | null, c: string): SaveOp => ({ kind: "put", toothNumber: n, surface: s, conditionId: c });

let uninstall: (() => void) | null = null;
beforeEach(() => { _resetQueuesForTests(); });
afterEach(() => { uninstall?.(); uninstall = null; _resetQueuesForTests(); });

test("t8 (3.ª): al cargar se borran las copias de versiones anteriores, y ya no se escribe nada en el navegador", async () => {
  const store = memStore();
  store.setItem("dc:odo-pendiente:v2:cli_1:u_a:pat_1:x", JSON.stringify({ v: 2, ops: [] }));
  store.setItem("dc:odo-pendiente:cli_1:pat_9:y", "{roto");
  store.setItem("dc:odo-ultima-clinica", "cli_1");
  store.setItem("dc:dental-draft:pat_1", "{\"v\":1}"); // el borrador del SOAP: no es nuestro
  store.setItem("otra-cosa", "se respeta");
  const srv = server(); srv.offline();
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers }));
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any, store);
  assert.deepEqual([...store.data.keys()].sort(), ["dc:dental-draft:pat_1", "otra-cosa"]);
  // sin red, se marca, se oculta y se cierra: NADA se guarda en el navegador
  q.enqueue(put(16, "O", "caries"));
  q.noteChanged(16, "dolor al frío");
  await tick();
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  win.dispatchEvent(new Event("pagehide"));
  assert.deepEqual([...store.data.keys()].sort(), ["dc:dental-draft:pat_1", "otra-cosa"]);
  assert.equal(limpiarCopiasViejas(null), 0, "sin almacenamiento no truena");
});

test("t8 (3.ª): ocultar o cerrar con algo pendiente → sale con keepalive (también la nota a medias) y la cola no se vacía", async () => {
  const srv = server(); srv.offline();
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers }));
  q.enqueue(put(16, "O", "caries"));
  q.noteChanged(16, "dolor al frío");
  await tick();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange")); // iOS: puede ser el último aviso
  const ka = srv.sent.filter((x) => x.keepalive).map((x) => x.op.kind).sort();
  assert.deepEqual(ka, ["note", "put"]);
  assert.equal(q.hasPending(), true, "si la pestaña sigue viva, sigue intentándolo");
  const e = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true, "el navegador pregunta antes de cerrar");
  srv.online();
  win.dispatchEvent(new Event("online"));
  await tick();
  assert.equal(q.hasPending(), false);
  const e2 = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(e2);
  assert.equal(e2.defaultPrevented, false);
});

test("t8 (3.ª): aviso fijo «No se guardó: sin conexión, reintentando» mientras haya algo pendiente, esté o no en pantalla", async () => {
  const els = new Map<string, NoticeEl>();
  const mk = (): NoticeEl => {
    const el: any = {
      id: "", textContent: null, style: {}, children: [] as NoticeEl[], listeners: {} as Record<string, () => void>,
      setAttribute() {}, appendChild(c: NoticeEl) { el.children.push(c); },
      remove() { els.delete(el.id); }, addEventListener(t: string, fn: () => void) { el.listeners[t] = fn; },
    };
    return el;
  };
  const doc: NoticeDoc = {
    getElementById: (id) => els.get(id) ?? null,
    createElement: () => mk(),
    body: { appendChild: (el: NoticeEl) => { els.set(el.id, el); } },
  };
  const srv = server(); srv.offline();
  const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
  const qs = () => [q];
  const detach = q.attach(); // EN pantalla
  q.enqueue(put(11, "V", "caries"));
  await tick();
  renderPendingNotice(doc, qs);
  const aviso: any = els.get(NOTICE_ID);
  assert.ok(aviso, "con el odontograma en pantalla también se ve");
  assert.match(aviso.children[0].textContent, /^No se guardó: sin conexión, reintentando\. Odontograma: 1 cambio sin guardar; no cierres esta pestaña\.$/);
  detach();
  renderPendingNotice(doc, qs);
  assert.ok(els.get(NOTICE_ID), "fuera de pantalla, igual");
  srv.online();
  aviso.children[1].listeners.click(); // Reintentar
  await tick();
  renderPendingNotice(doc, qs);
  assert.equal(els.get(NOTICE_ID), undefined, "todo guardado → el aviso desaparece");
  // un rechazo apartado: «Descartar» del aviso lo tira
  srv.fail(400, "invalid_payload");
  q.enqueue(put(12, "V", "caries"));
  await tick();
  renderPendingNotice(doc, qs);
  (els.get(NOTICE_ID) as any).children[2].listeners.click();
  assert.equal(q.hasPending(), false);
  assert.equal(textoAvisoPendiente([q]), null);
  assert.deepEqual(q.descartadosDesde(0), [put(12, "V", "caries")], "lo descartado se le entrega a la pantalla para quitarlo del dibujo");
});

test("t8 N3-O1: el 403 del reto de dos pasos NO descarta: se aparta y sale al volver el MISMO usuario", async () => {
  const srv = server();
  srv.fail(403, "two_factor_required");
  let quien: SessionInfo | null = DRA_A;
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, whoAmI: async () => quien, ...timers }));
  q.setOwner(DRA_A);
  q.enqueue(put(16, "O", "caries"));
  await tick();
  assert.equal(q.getStatus().state, "error", "apartado, no «discarded»");
  assert.equal(q.getStatus().discarded, 0);
  assert.equal(q.failedBySession(), true);
  assert.deepEqual(q.overlay({})[16].surfaces, { O: ["caries"] }, "se sigue viendo");
  // teclea el código y vuelve a la pestaña
  srv.online();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  win.dispatchEvent(new Event("focus"));
  await tick();
  assert.equal(q.hasPending(), false);
  assert.equal(srv.sent.length, 2);
  quien = null;
});

test("t8 N3-O2: «Reintentar» y `online` NO mandan lo de la Dra. A si la sesión ahora es del Dr. B", async () => {
  const srv = server();
  srv.fail(401, "unauthorized");
  let quien: SessionInfo | null = DR_B;
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], whoAmI: async () => quien, ...timers }));
  q.setOwner(DRA_A);
  q.enqueue(put(16, "O", "caries"));
  await tick();
  srv.online();
  // «Reintentar» (indicador o aviso fijo)
  assert.equal(await q.retryNow(), false);
  await tick();
  assert.equal(srv.sent.length, 1, "no sale firmado por B");
  assert.equal(q.getStatus().error, OTRA_SESION);
  // algo esperando reintento por la red + `online` con la sesión de B
  srv.offline();
  q.enqueue(put(17, "O", "caries"));
  await tick();
  srv.online();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  win.dispatchEvent(new Event("online"));
  await tick();
  assert.ok(!srv.sent.slice(2).some((x) => !x.keepalive), "tampoco al volver la red");
  assert.equal(q.hasPending(), true);
  // vuelve la Dra. A
  quien = DRA_A;
  assert.equal(await q.retryNow(), true);
  await tick();
  assert.equal(q.hasPending(), false);
});

test("t8 N3-O3: lo que lleva más de 15 min fallando NO sale solo al volver la red; con «Reintentar», sí", async () => {
  assert.equal(STALE_AFTER_MS, 15 * 60 * 1000);
  let ahora = Date.parse("2026-10-20T20:00:00Z");
  const fired: (() => void)[] = [];
  const srv = server(); srv.offline();
  const q = new SaveQueue({
    send: srv.send, now: () => ahora,
    setTimer: (fn) => { fired.push(fn); return fired.length; }, clearTimer: () => {},
  });
  q.enqueue({ kind: "reset" }); // «Limpiar todo» sin red, y se cierra la tapa
  await tick();
  assert.equal(q.getStatus().state, "retrying");
  // a la mañana siguiente, ya con red, vence el temporizador del reintento
  ahora += 12 * 3600 * 1000;
  srv.online();
  fired.shift()!();
  await tick();
  assert.equal(srv.sent.length, 1, "el reset viejo no se manda solo");
  assert.equal(q.getStatus().state, "error");
  assert.match(q.getStatus().error ?? "", /más de 15 min sin poder guardarse/);
  assert.equal(await q.retryNow(), true); // la doctora lo revisa y decide
  await tick();
  assert.equal(srv.sent.length, 2);
  assert.equal(q.hasPending(), false);
});

test("t8 N3-O4: cambiar de sede en otra pestaña NO tira lo que se marca: se aparta con aviso claro", async () => {
  const srv = server();
  srv.fail(404, "patient_not_found");
  let quien: SessionInfo | null = A_EN_SEDE_2; // en otra pestaña cambió a la sede 2
  const q = new SaveQueue({ send: srv.send, whoAmI: async () => quien, ...timers });
  q.setOwner(DRA_A); // abrió al paciente en la sede 1
  q.enqueue(put(16, "O", "caries"));
  await tick();
  assert.equal(q.getStatus().state, "error");
  assert.equal(q.getStatus().error, OTRA_SESION);
  assert.equal(q.getStatus().discarded, 0, "no se descartó");
  assert.deepEqual(q.overlay({})[16].surfaces, { O: ["caries"] });
  // vuelve a la sede 1 y reintenta
  quien = DRA_A; srv.online();
  assert.equal(await q.retryNow(), true);
  await tick();
  assert.equal(q.hasPending(), false);
  // un 404 DE VERDAD (misma sede): se descarta y la pantalla lo quita del dibujo
  srv.fail(404, "patient_not_found");
  q.enqueue(put(26, null, "crown"));
  await tick();
  assert.equal(q.getStatus().state, "discarded");
  assert.match(q.getStatus().error ?? "", /Ese cambio se descartó\.$/);
  const dibujo = { 26: { surfaces: {}, tooth: ["crown"] }, 36: { surfaces: {}, tooth: ["rct"] } };
  assert.deepEqual(quitarDelDibujo(dibujo, q.descartadosDesde(0)), { 26: { surfaces: {}, tooth: [] }, 36: { surfaces: {}, tooth: ["rct"] } },
    "aunque la relectura falle (sedes sin vincular), la marca no se queda pintada");
});

test("t8 O3: abrir SIN red — mensaje en español (carga real) y la cola anota de qué sesión es", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  try {
    const q = new SaveQueue({ send: server().send, ...timers });
    const r = await cargarOdontograma({ patientId: "pat_1", queue: q, sesion: A_EN_SEDE_2, leer: fetchOdontogram, force: true });
    assert.match(r.error ?? "", /^No se pudo cargar el odontograma: sin conexión/);
    assert.doesNotMatch(r.error ?? "", /Failed to fetch|Load failed|navegador/);
    assert.deepEqual(q.getOwner(), A_EN_SEDE_2);
  } finally {
    globalThis.fetch = realFetch;
  }
  // con red y sin sesión de la página: la toma del GET
  const q2 = new SaveQueue({ send: server().send, ...timers });
  const r2 = await cargarOdontograma({
    patientId: "pat_1", queue: q2, sesion: null, force: true,
    leer: async () => ({ records: { 36: { surfaces: {}, tooth: ["rct"] } }, clinicId: "cli_1", userId: "u_a", entries: [] }),
  });
  assert.equal(r2.error, null);
  assert.deepEqual(r2.records?.[36].tooth, ["rct"]);
  assert.deepEqual(q2.getOwner(), DRA_A);
});

test("O3: el adaptador habla español — 401, 403, 400, 500 y sin red; nunca el código crudo de la API", async () => {
  const realFetch = globalThis.fetch;
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const casos: [number, unknown, RegExp][] = [
    [401, { error: "unauthorized" }, /^Tu sesión venció, vuelve a entrar/],
    [403, { error: "forbidden" }, /no tiene permiso para editar el odontograma/],
    [400, { error: "invalid_payload", issues: [] }, /no es válido/],
    [404, { error: "patient_not_found" }, /No se encontró al paciente/],
    [500, { error: "internal_error" }, /Falló el servidor/],
    [502, "<html>", /falló el servidor \(502\)/],
  ];
  try {
    for (const [status, body, re] of casos) {
      globalThis.fetch = respond(status, body) as typeof fetch;
      const err = await putFinding({ patientId: "p", toothNumber: 11, surface: "I", conditionId: "caries" }).then(() => null, (e) => e);
      assert.ok(err instanceof OdontogramHttpError, String(status));
      assert.equal(err.status, status);
      assert.match(err.message, re, `${status}: ${err.message}`);
      assert.doesNotMatch(err.message, /unauthorized|forbidden|invalid_payload|patient_not_found|internal_error/);
    }
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    const net = await setNote("p", 11, "x").then(() => null, (e) => e);
    assert.equal(net.status, 0);
    assert.match(net.message, /sin conexión/);
    assert.doesNotMatch(net.message, /Failed to fetch/);
    // una redirección seguida (al login) no cuenta como guardado
    globalThis.fetch = (async () => ({ ok: true, status: 200, redirected: true, text: async () => "<html>" })) as unknown as typeof fetch;
    const red = await putFinding({ patientId: "p", toothNumber: 11, conditionId: "caries" }).then(() => null, (e) => e);
    assert.equal(red?.status, 401);
    // la lectura también: y trae la clínica de la sesión
    globalThis.fetch = respond(200, { entries: [{ toothNumber: 11, surface: "O", conditionId: "caries" }], notes: {}, clinicId: "cli_1" }) as typeof fetch;
    const r = await fetchOdontogram("p");
    assert.equal(r.clinicId, "cli_1");
    assert.deepEqual(r.records[11].surfaces, { I: ["caries"] });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("O2: la incisal de un anterior se rotula «Incisal» — también en «Completar cita»", () => {
  assert.equal(rotuloCara(11, "O"), "Incisal");
  assert.equal(rotuloCara(53, "O"), "Incisal");
  assert.equal(rotuloCara(16, "O"), "Oclusal");
  assert.equal(rotuloCara(16, "M"), "Mesial");
  assert.equal(rotuloCara(undefined, "O"), "Oclusal", "sin diente no se puede saber: se queda como venga");
  assert.equal(rotuloCara(11, null), null);
  // los tres sitios que pintan la cara guardada usan el mismo rótulo
  const root = path.resolve(__dirname, "../../../../..");
  const leer = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  assert.match(leer("src/components/dashboard/patient-detail/treatments-modal.tsx"), /rotuloCara\(r\.toothNumber, r\.surface\)/);
  assert.doesNotMatch(leer("src/components/dashboard/patient-detail/treatments-modal.tsx"), /O: "Oclusal"/);
  assert.match(leer("src/app/api/patients/[id]/expediente-pdf/route.tsx"), /cara: rotuloCara\(h\.toothNumber, h\.surface\)/);
  assert.match(leer("src/lib/ai/consult-context.ts"), /rotuloCara\(e\.toothNumber, e\.surface\)/);
});

/* ======================= cuarta vuelta (t8) ======================= */

/** `fetch` del navegador para «¿quién soy?»: sin red, o con la sesión que toque. */
function quienSoy() {
  let sesion: SessionInfo | null = DRA_A;
  let sinRed = false;
  const fetchFalso = (async (url: string) => {
    if (sinRed) throw new TypeError("Failed to fetch");
    assert.match(String(url), /\?quien=1$/, "no pregunta por el paciente");
    return sesion
      ? new Response(JSON.stringify(sesion), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }) as unknown as typeof fetch;
  return { fetchFalso, ser: (s: SessionInfo | null) => { sesion = s; }, cortar: (v: boolean) => { sinRed = v; } };
}

test("t8 N4-O1: «Reintentar» SIN red no toma el fallo como «otra sesión»: queda como estaba y sale solo al volver la red", async () => {
  const realFetch = globalThis.fetch;
  const quien = quienSoy();
  globalThis.fetch = quien.fetchFalso;
  try {
    const srv = server(); srv.offline(); quien.cortar(true);
    const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], whoAmI: fetchQuienSoy, ...timers }));
    q.setOwner(DRA_A);
    q.enqueue(put(16, "O", "caries"));
    await tick();
    assert.equal(q.getStatus().state, "retrying");
    // con el aviso «sin conexión, reintentando» a la vista, pulsa «Reintentar»
    assert.equal(await q.retryNow(), false);
    await tick();
    assert.equal(q.getStatus().state, "retrying", "sigue «reintentando», no «error»");
    assert.notEqual(q.getStatus().error, OTRA_SESION);
    assert.equal(q.hasFailed(), false, "nada apartado");
    assert.match(textoAvisoPendiente([q]) ?? "", /sin conexión, reintentando/);
    // vuelve la red: `online` lo manda solo (antes se quedaba apartado con el aviso falso)
    quien.cortar(false); srv.online();
    const { win, doc } = page();
    uninstall = installPageHandlers(win as any, doc as any);
    win.dispatchEvent(new Event("online"));
    await tick();
    assert.equal(q.hasPending(), false);
    assert.equal(srv.sent.filter((x) => !x.keepalive).length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("t8 N4-O1: un 404 de verdad (paciente borrado) se descarta; si no se pudo preguntar, NO se tira: se reintenta", async () => {
  const realFetch = globalThis.fetch;
  const quien = quienSoy();
  globalThis.fetch = quien.fetchFalso;
  try {
    const fired: (() => void)[] = [];
    const srv = server(); srv.fail(404, "patient_not_found");
    const q = new SaveQueue({ send: srv.send, whoAmI: fetchQuienSoy, setTimer: (fn) => { fired.push(fn); return fired.length; }, clearTimer: () => {} });
    q.setOwner(DRA_A);
    // sin red para preguntar: no se descarta ni se dice «otra sesión»
    quien.cortar(true);
    q.enqueue(put(26, null, "crown"));
    await tick();
    assert.equal(q.getStatus().discarded, 0);
    assert.equal(q.getStatus().state, "retrying");
    assert.match(q.getStatus().error ?? "", /No se pudo comprobar la sesión/);
    // ya se puede preguntar: es la misma sesión → el 404 es de verdad → se descarta
    quien.cortar(false);
    fired.shift()!();
    await tick();
    assert.equal(q.getStatus().state, "discarded");
    assert.match(q.getStatus().error ?? "", /No se encontró al paciente|Ese cambio se descartó/);
    assert.equal(q.hasPending(), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("t8 N4-O2: el temporizador del reintento pregunta antes de mandar; sin poder preguntar no manda; sin dueño, el keepalive no manda", async () => {
  const fired: (() => void)[] = [];
  const manual = { setTimer: (fn: () => void) => { fired.push(fn); return fired.length; }, clearTimer: () => {} };
  let quien: SessionInfo | null | "sin-red" = DRA_A;
  const whoAmI = async () => { if (quien === "sin-red") throw new Error("sin red"); return quien; };
  const srv = server(); srv.fail(503);
  const q = new SaveQueue({ send: srv.send, whoAmI, ...manual });
  q.setOwner(DRA_A);
  q.enqueue(put(16, "O", "caries"));
  await tick();
  assert.equal(srv.sent.length, 1);
  // el servidor vuelve, pero no se puede preguntar todavía: no sale nada y se vuelve a esperar
  srv.online(); quien = "sin-red";
  fired.shift()!();
  await tick();
  assert.equal(srv.sent.length, 1, "sin comprobar la sesión no se manda");
  assert.equal(q.getStatus().state, "retrying");
  assert.equal(fired.length, 1, "temporizador puesto otra vez");
  // ahora B tiene la sesión: no sale y se dice por qué
  quien = { ...DR_B };
  fired.shift()!();
  await tick();
  assert.equal(srv.sent.length, 1);
  assert.equal(q.getStatus().error, OTRA_SESION);
  // el keepalive tampoco manda lo apartado; y cada envío lleva la sesión de la cola
  const s2 = server();
  const q2 = new SaveQueue({ send: (op, o) => { assert.deepEqual(o.sesion, DRA_A); return s2.send(op, o); }, whoAmI, ...manual });
  q2.setOwner(DRA_A); s2.offline();
  q2.enqueue(put(17, "O", "caries"));
  await tick();
  q2.flushForUnload();
  assert.equal(s2.sent.filter((x) => x.keepalive).length, 1, "sale con keepalive y con la sesión de A (el servidor la compara)");
  // una cola que no sabe de quién es (sin sesión de la página ni GET): el keepalive no manda nada
  const s3 = server(); s3.offline();
  const q3 = new SaveQueue({ send: s3.send, whoAmI, ...manual });
  q3.enqueue(put(18, "O", "caries"));
  await tick();
  q3.flushForUnload();
  assert.equal(s3.sent.filter((x) => x.keepalive).length, 0);
  assert.equal(q3.hasPending(), true, "el navegador sigue avisando al cerrar");
});

test("t8 N3-O3 (cuarta vuelta): una noche sin red con VARIOS cambios — no sale solo ninguno, ni por keepalive", async () => {
  // La sonda del revisor: sin red se quita la caries del 16, se reescribe la
  // nota del 11 y se borra la corona del 21; 12 h después vuelve la red.
  let ahora = Date.parse("2026-10-20T20:00:00Z");
  const fired: (() => void)[] = [];
  const srv = server(); srv.offline();
  const q = new SaveQueue({ send: srv.send, now: () => ahora, setTimer: (fn) => { fired.push(fn); return fired.length; }, clearTimer: () => {} });
  q.enqueue({ kind: "delete", toothNumber: 16, surface: "O", conditionId: "caries" });
  q.enqueue({ kind: "note", toothNumber: 11, text: "sin dolor" });
  q.enqueue({ kind: "delete", toothNumber: 21, surface: null, conditionId: "crown" });
  await tick();
  assert.equal(srv.sent.length, 1, "solo el primero llegó a intentarse; los otros esperaban");
  ahora += 12 * 3600 * 1000;
  // si la pestaña se cierra ahora: nada de la noche sale por keepalive
  q.flushForUnload();
  assert.equal(srv.sent.filter((x) => x.keepalive).length, 0);
  srv.online();
  fired.shift()!();
  await tick();
  assert.equal(srv.sent.length, 1, "ni note:11 ni delete:21 salen solos");
  assert.equal(q.getStatus().state, "error");
  assert.equal(q.getStatus().pending, 3);
  assert.match(q.getStatus().error ?? "", /más de 15 min/);
  // la doctora revisa y decide mandarlos
  assert.equal(await q.retryNow(), true);
  await tick();
  assert.deepEqual(srv.sent.slice(1).map((x) => x.op.kind), ["delete", "note", "delete"]);
  assert.equal(q.hasPending(), false);
});

test("t8 N4-O3: «Descartar» del aviso fijo solo se ve si hay algo apartado (mientras dice «reintentando», no)", async () => {
  const els = new Map<string, NoticeEl>();
  const mk = (): NoticeEl => {
    const el: any = {
      id: "", textContent: null, style: {}, children: [] as NoticeEl[], listeners: {} as Record<string, () => void>,
      setAttribute() {}, appendChild(c: NoticeEl) { el.children.push(c); },
      remove() { els.delete(el.id); }, addEventListener(t: string, fn: () => void) { el.listeners[t] = fn; },
    };
    return el;
  };
  const doc: NoticeDoc = { getElementById: (id) => els.get(id) ?? null, createElement: () => mk(), body: { appendChild: (el: NoticeEl) => { els.set(el.id, el); } } };
  const srv = server(); srv.offline();
  const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
  q.enqueue(put(11, "V", "caries"));
  await tick();
  renderPendingNotice(doc, () => [q]);
  const aviso: any = els.get(NOTICE_ID);
  assert.equal(aviso.children[2].textContent, "Descartar");
  assert.equal(aviso.children[2].style.display, "none", "reintentando: no hay nada que «Descartar» pueda tirar");
  // «Reintentar» y el servidor lo rechaza: queda apartado y ahora sí se ve
  srv.fail(400, "invalid_payload");
  assert.equal(await q.retryNow(), true);
  await tick();
  assert.equal(q.hasFailed(), true);
  renderPendingNotice(doc, () => [q]);
  assert.equal(aviso.children[2].style.display, "");
});

test("t8 N4-O4: lo descartado con el odontograma fuera de pantalla no se aplica al dibujo al volver", async () => {
  const srv = server();
  const q = new SaveQueue({ send: srv.send, ...timers });
  // fuera de pantalla: un rechazo apartado que la doctora tira desde el aviso fijo
  srv.fail(400, "invalid_payload");
  q.enqueue(put(26, null, "crown"));
  await tick();
  q.discard();
  // vuelve a poner la corona y esta vez sí se guarda
  srv.online();
  q.enqueue(put(26, null, "crown"));
  await tick();
  assert.equal(q.hasPending(), false);
  // monta el odontograma: anota el contador (App.tsx: discardedSeen = status.discarded)
  const visto = q.getStatus().discarded;
  assert.deepEqual(q.descartadosDesde(visto), [], "el descarte viejo no es de esta pantalla");
  // un descarte DESPUÉS de montar sí le toca
  srv.fail(400, "invalid_payload");
  q.enqueue(put(36, null, "rct"));
  await tick();
  q.discard();
  assert.deepEqual(q.descartadosDesde(visto), [put(36, null, "rct")]);
  const dibujo = { 26: { surfaces: {}, tooth: ["crown"] }, 36: { surfaces: {}, tooth: ["rct"] } };
  assert.deepEqual(quitarDelDibujo(dibujo, q.descartadosDesde(visto)), { 26: { surfaces: {}, tooth: ["crown"] }, 36: { surfaces: {}, tooth: [] } },
    "la corona que sí se guardó sigue en pantalla");
  // App.tsx usa exactamente esto
  const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
  assert.match(app, /descartadosDesde\(discardedSeen\.current\)/);
  assert.match(app, /discardedSeen\.current = queue\.getStatus\(\)\.discarded;/);
});

test("t8 N3-O1 (cuarta vuelta): el guardia del reto de dos pasos NO se lleva la pestaña con algo del odontograma sin guardar", async () => {
  const respuesta2FA = () => new Response(JSON.stringify({ error: "Completa la verificación en dos pasos.", code: "two_factor_required" }), {
    status: 403, headers: { "content-type": "application/json" },
  });
  const navegadas: string[] = [];
  let reto = true;
  const win: any = {
    fetch: async () => (reto ? respuesta2FA() : new Response("{}", { status: 200 })),
    location: { pathname: "/dashboard/patients/pat_1", search: "?tab=odontograma", assign: (u: string) => { navegadas.push(u); } },
  };
  instalarGuardia2FA(win); // con la cola real (hayPendienteOdontograma)
  const realFetch = globalThis.fetch;
  globalThis.fetch = win.fetch;
  try {
    const q = saveQueueFor("pat_1", () => new SaveQueue({
      send: (op) => putFinding({ patientId: "pat_1", toothNumber: (op as any).toothNumber, surface: (op as any).surface, conditionId: (op as any).conditionId }),
      ...timers,
    }));
    q.enqueue(put(16, "O", "caries"));
    await tick();
    assert.deepEqual(navegadas, [], "no navega: lo pendiente vive solo en esta pestaña");
    assert.equal(q.getStatus().state, "error");
    assert.equal(q.failedBySession(), true);
    assert.match(q.getStatus().error ?? "", new RegExp(FALTA_DOS_PASOS.slice(0, 40)));
    // la completa en otra pestaña y pulsa «Reintentar»
    reto = false;
    assert.equal(await q.retryNow(), true);
    await tick();
    assert.equal(q.hasPending(), false);
    // sin nada pendiente, el guardia vuelve a llevar al reto como siempre
    reto = true;
    await win.fetch("/api/otra-cosa");
    assert.equal(navegadas.length, 1);
    assert.match(navegadas[0], /next=%2Fdashboard%2Fpatients%2Fpat_1%3Ftab%3Dodontograma$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
