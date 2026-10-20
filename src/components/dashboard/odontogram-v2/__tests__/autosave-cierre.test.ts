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
import { putFinding, setNote, fetchOdontogram, rotuloCara, OdontogramHttpError, SESION_VENCIDA } from "../adapter";
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
  assert.deepEqual(q.takeDiscarded(), [put(12, "V", "caries")], "lo descartado se le entrega a la pantalla para quitarlo del dibujo");
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
  assert.deepEqual(quitarDelDibujo(dibujo, q.takeDiscarded()), { 26: { surfaces: {}, tooth: [] }, 36: { surfaces: {}, tooth: ["rct"] } },
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
