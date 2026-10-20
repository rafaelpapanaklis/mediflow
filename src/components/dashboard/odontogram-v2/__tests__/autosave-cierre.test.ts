/**
 * ws1-t11 · revisión t4 — O1, O2 y O3, ejecutando el caso.
 *
 * O1: sin red, el doctor marca, cambia a otra pestaña de la ficha (el
 *     odontograma se desmonta) y cierra el navegador — o iOS mata la pestaña,
 *     sin `beforeunload`. Nada se pierde: lo pendiente queda en el navegador y
 *     sale al volver a abrir al paciente; mientras tanto, un aviso fijo dice
 *     que hay cambios sin guardar aunque el odontograma no esté en pantalla.
 * O2: la cara incisal de un anterior se rotula «Incisal» (también en
 *     «Completar cita»).
 * O3: los errores salen en español; con la sesión vencida (401) se dice y lo
 *     pendiente se conserva y sale solo al volver.
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
  SaveQueue, saveQueueFor, installPageHandlers, renderPendingNotice, textoAvisoPendiente, pendienteKey,
  _resetQueuesForTests, PENDIENTE_CADUCA_MS, NOTICE_ID, bindBrowserCopy, bindBrowserCopyOffline,
  type KeyValueStore, type SaveOp, type NoticeDoc, type NoticeEl,
} from "../autosave";
import { putFinding, setNote, fetchOdontogram, rotuloCara, OdontogramHttpError, SESION_VENCIDA } from "../adapter";

const settle = () => new Promise((r) => setImmediate(r));
const tick = async (n = 5) => { for (let i = 0; i < n; i++) await settle(); };

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

/** Temporizadores reales que no retienen el proceso de prueba (reintentos de 60 s, pausa de la nota). */
const timers = {
  setTimer: (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref(); return t; },
  clearTimer: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

class HttpErr extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }

/** Servidor de mentira con red que se puede cortar. */
function server() {
  const sent: { op: SaveOp; keepalive: boolean }[] = [];
  let status: number | null = null; // null = responde bien
  return {
    sent,
    offline() { status = 0; }, online() { status = null; }, fail(s: number) { status = s; },
    send: (op: SaveOp, o: { keepalive: boolean }) => {
      sent.push({ op, keepalive: o.keepalive });
      return status === null ? Promise.resolve() : Promise.reject(new HttpErr(status));
    },
  };
}

/** Página de mentira: window y document como EventTarget reales. */
function page() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  return { win, doc };
}

const PREFIX = pendienteKey("cli_1", "pat_1");
const put = (n: number, s: string | null, c: string): SaveOp => ({ kind: "put", toothNumber: n, surface: s, conditionId: c });

let uninstall: (() => void) | null = null;
beforeEach(() => { _resetQueuesForTests(); });
afterEach(() => { uninstall?.(); uninstall = null; _resetQueuesForTests(); });

test("O1: sin red, desmontado y cerrado el navegador → lo pendiente queda en el navegador y sale al reabrir al paciente", async () => {
  const store = memStore();
  const srv = server();
  srv.offline();
  // --- primera carga de la página ---
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers }));
  q.bindStorage(store, PREFIX, "pestanaA");
  const detach = q.attach();           // odontograma en pantalla
  q.enqueue(put(16, "O", "caries"));
  q.noteChanged(16, "dolor al frío"); // tecleándose
  await tick();
  detach();                           // cambia a «Citas»: el odontograma se desmonta
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  // iOS: la pestaña se oculta y la matan sin `beforeunload` ni `pagehide`
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  const copia = JSON.parse(store.getItem(`${PREFIX}:pestanaA`)!);
  assert.deepEqual(copia.ops.map((o: SaveOp) => o.kind).sort(), ["note", "put"], "marca y nota a medias, copiadas");
  assert.equal(copia.ops.find((o: any) => o.kind === "note").text, "dolor al frío");

  // --- el navegador se cierra; al día siguiente, otra carga, ya con red ---
  uninstall(); uninstall = null;
  _resetQueuesForTests();
  const srv2 = server();
  const q2 = saveQueueFor("pat_1", () => new SaveQueue({ send: srv2.send, ...timers }));
  const recuperadas = q2.bindStorage(store, PREFIX, "pestanaB");
  assert.equal(recuperadas, 2);
  // se ve encima de lo que diga el servidor mientras sale
  assert.deepEqual(q2.overlay({})[16], { surfaces: { O: ["caries"] }, tooth: [], note: "dolor al frío" });
  await tick();
  assert.deepEqual(srv2.sent.map((x) => x.op.kind).sort(), ["note", "put"]);
  assert.equal(q2.hasPending(), false);
  assert.equal(store.length, 0, "confirmado → la copia del navegador se borra");
});

test("O1: abrir al paciente SIN red: lo que quedaba y lo que se marque ahora sigue guardándose en el navegador", async () => {
  const store = memStore();
  // una sesión anterior (con red) dejó la clínica y una marca sin mandar
  const srv0 = server(); srv0.offline();
  const q0 = new SaveQueue({ send: srv0.send, retryDelays: [60_000], ...timers });
  bindBrowserCopy(q0, store, "cli_1", "pat_1", "ayer");
  q0.enqueue(put(12, "V", "caries"));
  await tick();
  // hoy se abre sin red: el GET falla y no hay clínica de la sesión → se usa la última
  const srv = server(); srv.offline();
  const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
  assert.equal(bindBrowserCopyOffline(q, store, "pat_1", "hoy"), 1, "recupera la marca de ayer");
  assert.deepEqual(q.overlay({})[12].surfaces, { V: ["caries"] });
  q.enqueue(put(13, "V", "caries"));
  await tick();
  const mias = [...store.data.entries()].filter(([k]) => k.startsWith(PREFIX + ":")).map(([, v]) => JSON.parse(v).ops.length);
  assert.deepEqual(mias, [2], "las dos quedan copiadas para la próxima vez");
  assert.equal(bindBrowserCopyOffline(new SaveQueue({ send: srv.send, ...timers }), memStore(), "pat_1"), 0, "sin clínica conocida no inventa llave");
});

test("O1: cerrar en escritorio con algo pendiente → el navegador pregunta, aunque el odontograma ya no esté montado", async () => {
  const srv = server();
  srv.offline();
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers }));
  const detach = q.attach();
  q.enqueue(put(26, null, "crown"));
  await tick();
  detach();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  const e = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  // pagehide: por si hay red, sale con keepalive (y la cola no se vacía)
  win.dispatchEvent(new Event("pagehide"));
  assert.ok(srv.sent.some((x) => x.keepalive && x.op.kind === "put"));
  assert.equal(q.hasPending(), true);
  // con todo confirmado, cerrar no pregunta
  srv.online();
  win.dispatchEvent(new Event("online"));
  await tick();
  const e2 = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(e2);
  assert.equal(e2.defaultPrevented, false);
});

test("O1: aviso fijo «sin guardar» cuando el odontograma no está en pantalla; se quita al confirmarse", async () => {
  // documento de mentira con lo justo que usa el aviso
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
  const srv = server();
  srv.offline();
  const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
  const qs = () => [q];
  const detach = q.attach();
  q.enqueue(put(11, "V", "caries"));
  await tick();
  renderPendingNotice(doc, qs);
  assert.equal(els.get(NOTICE_ID), undefined, "en pantalla avisa su propio indicador");
  detach();
  renderPendingNotice(doc, qs);
  const aviso: any = els.get(NOTICE_ID);
  assert.ok(aviso, "fuera de pantalla aparece el aviso fijo");
  assert.match(aviso.children[0].textContent, /1 cambio sin guardar \(sin conexión\)/);
  // «Reintentar» del aviso, ya con red
  srv.online();
  aviso.children[1].listeners.click();
  await tick();
  renderPendingNotice(doc, qs);
  assert.equal(els.get(NOTICE_ID), undefined, "todo guardado → el aviso desaparece");
  assert.equal(textoAvisoPendiente([q]), null);
});

test("O1: dos pestañas del mismo paciente no se borran la copia; una vieja (caducada) no se manda", async () => {
  const store = memStore();
  const srvA = server(); srvA.offline();
  const srvB = server(); srvB.offline();
  const a = new SaveQueue({ send: srvA.send, retryDelays: [60_000], ...timers });
  const b = new SaveQueue({ send: srvB.send, retryDelays: [60_000], ...timers });
  a.bindStorage(store, PREFIX, "A");
  b.bindStorage(store, PREFIX, "B");
  a.enqueue(put(31, "L", "caries"));
  b.enqueue(put(41, "L", "caries"));
  b.discard(); b.persist();
  await tick();
  assert.ok(store.getItem(`${PREFIX}:A`), "B no borró la copia de A");
  // caducada
  store.setItem(`${PREFIX}:Z`, JSON.stringify({ v: 1, savedAt: Date.now() - PENDIENTE_CADUCA_MS - 1, ops: [put(48, null, "missing")] }));
  const srvC = server();
  const c = new SaveQueue({ send: srvC.send, ...timers });
  c.bindStorage(store, PREFIX, "C");
  await tick();
  assert.ok(!srvC.sent.some((x) => x.op.kind === "put" && x.op.toothNumber === 48), "la de hace más de 14 días no sale");
  assert.ok(srvC.sent.some((x) => x.op.kind === "put" && x.op.toothNumber === 31), "la de la otra pestaña sí");
});

test("O3: sesión vencida (401) → se dice en español, se conserva lo pendiente y sale solo al volver", async () => {
  const srv = server();
  srv.fail(401);
  const q = saveQueueFor("pat_1", () => new SaveQueue({
    // el envío real del adaptador traduce el 401
    send: async (op, o) => { await srv.send(op, o).catch((e) => { throw new OdontogramHttpError(SESION_VENCIDA, e.status); }); },
    ...timers,
  }));
  q.enqueue(put(21, "I", "caries"));
  await tick();
  assert.equal(q.getStatus().state, "error");
  assert.equal(q.getStatus().error, SESION_VENCIDA);
  assert.match(SESION_VENCIDA, /Tu sesión venció, vuelve a entrar/);
  assert.equal(q.hasPending(), true, "no se tira lo pendiente");
  // vuelve a entrar en otra pestaña y regresa a esta
  srv.online();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  win.dispatchEvent(new Event("focus"));
  await tick();
  assert.equal(q.hasPending(), false);
  assert.equal(srv.sent.length, 2);
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
