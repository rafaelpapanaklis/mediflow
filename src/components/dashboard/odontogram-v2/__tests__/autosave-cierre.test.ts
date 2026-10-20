/**
 * ws1-t11 · revisiones t4 y t8 — lo pendiente del odontograma, ejecutando el caso.
 *
 * t4 O1 / t8 (segunda vuelta):
 *  - N-O1: lo pendiente es del USUARIO que lo hizo (llave = clínica + usuario
 *    de la sesión): otro usuario en el mismo navegador nunca lo ve ni lo manda;
 *    tras un 401 solo se reintenta si vuelve el mismo usuario.
 *  - N-O2: lo recuperado NO se manda solo: se ofrece «Guardar / Descartar» y al
 *    guardar se aplica diente por diente sobre lo que hay HOY (un «Limpiar
 *    todo» viejo no borra lo registrado después).
 *  - N-O3: la llave sale de la sesión actual, nunca de «la última conocida».
 *  - N-O4: al enganchar se barren las copias caducadas (48 h) y corruptas de
 *    cualquier paciente.
 *  - O3: abrir sin red da un mensaje en español (se ejecuta la carga real,
 *    `cargarOdontograma`, con el `fetchOdontogram` real y `fetch` sin red).
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
  SaveQueue, saveQueueFor, installPageHandlers, renderPendingNotice, textoAvisoPendiente, pendienteKey, sweepPendientes,
  _resetQueuesForTests, PENDIENTE_CADUCA_MS, PENDIENTE_PREFIJO, NOTICE_ID, bindBrowserCopy,
  type KeyValueStore, type SaveOp, type NoticeDoc, type NoticeEl,
} from "../autosave";
import { putFinding, setNote, fetchOdontogram, rotuloCara, OdontogramHttpError, SESION_VENCIDA, type OdontogramRead } from "../adapter";
import { cargarOdontograma, aplicarRecuperado, planRecovery } from "../recuperar";

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

/** Temporizadores reales que no retienen el proceso de prueba. */
const timers = {
  setTimer: (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref(); return t; },
  clearTimer: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

class HttpErr extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }

/** Servidor de mentira con red que se puede cortar. */
function server() {
  const sent: { op: SaveOp; keepalive: boolean }[] = [];
  let status: number | null = null;
  return {
    sent,
    offline() { status = 0; }, online() { status = null; }, fail(s: number) { status = s; },
    send: (op: SaveOp, o: { keepalive: boolean }) => {
      sent.push({ op, keepalive: o.keepalive });
      return status === null ? Promise.resolve() : Promise.reject(new HttpErr(status));
    },
  };
}

function page() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  return { win, doc };
}

const DRA_A = { clinicId: "cli_1", userId: "u_a" };
const DR_B = { clinicId: "cli_1", userId: "u_b" };
const SEDE_2 = { clinicId: "cli_2", userId: "u_a" };
const put = (n: number, s: string | null, c: string): SaveOp => ({ kind: "put", toothNumber: n, surface: s, conditionId: c });

/** Lectura de mentira del servidor (lo que devolvería fetchOdontogram). */
function hoy(entries: { toothNumber: number; surface: string | null; conditionId: string; updatedAt: string }[], notas: Record<number, [string, string]> = {}): OdontogramRead {
  const records: OdontogramRead["records"] = {};
  for (const e of entries) {
    const r = (records[e.toothNumber] ??= { surfaces: {}, tooth: [] });
    if (e.surface) (r.surfaces[e.surface] ??= []).push(e.conditionId); else r.tooth.push(e.conditionId);
  }
  const noteTimes: Record<number, string> = {};
  for (const [n, [text, t]] of Object.entries(notas)) {
    (records[Number(n)] ??= { surfaces: {}, tooth: [] }).note = text; noteTimes[Number(n)] = t;
  }
  return { records, clinicId: "cli_1", userId: "u_a", entries, noteTimes };
}

let uninstall: (() => void) | null = null;
beforeEach(() => { _resetQueuesForTests(); });
afterEach(() => { uninstall?.(); uninstall = null; _resetQueuesForTests(); });

/** Una «carga de la página» de la Dra. A que se queda sin red con cambios pendientes. */
async function dejarPendiente(store: KeyValueStore, sesion: { clinicId: string; userId: string }, tab: string, ops: SaveOp[], now?: () => number) {
  const srv = server(); srv.offline();
  const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers, ...(now ? { now } : {}) });
  bindBrowserCopy(q, store, sesion, "pat_1", tab);
  ops.forEach((o) => q.enqueue(o));
  await tick();
  return q;
}

test("t8 N-O1: lo pendiente de la Dra. A NO lo ve ni lo manda el Dr. B en el mismo navegador", async () => {
  const store = memStore();
  await dejarPendiente(store, DRA_A, "pestana1", [{ kind: "reset" }, put(16, "O", "caries")]);
  // cierra; entra el Dr. B en la misma PC y abre al mismo paciente
  const srvB = server();
  const qB = new SaveQueue({ send: srvB.send, ...timers });
  assert.equal(bindBrowserCopy(qB, store, DR_B, "pat_1", "pestana2"), 0, "B no encuentra nada");
  await tick();
  assert.equal(srvB.sent.length, 0, "B no manda nada de A");
  assert.equal(qB.getStatus().recovered, null);
  // la copia de A sigue ahí, para A
  const qA = new SaveQueue({ send: server().send, ...timers });
  assert.equal(bindBrowserCopy(qA, store, DRA_A, "pat_1", "pestana3"), 2);
});

test("t8 N-O1: en la MISMA pestaña, si entra otra sesión, lo de la anterior no se manda con la nueva", async () => {
  const store = memStore();
  const srv = server(); srv.offline();
  const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
  bindBrowserCopy(q, store, DRA_A, "pat_1", "t");
  q.enqueue(put(21, "V", "caries"));
  await tick();
  const intentosDeA = srv.sent.length; // el intento sin red, con la sesión de A
  srv.online();
  bindBrowserCopy(q, store, DR_B, "pat_1", "t"); // otra sesión en la pestaña
  q.retryNow();
  await tick();
  assert.equal(srv.sent.length, intentosDeA, "no se reintenta con la sesión de B");
  assert.equal(q.hasPending(), false, "la cola de B empieza vacía");
  assert.ok(store.getItem(`${pendienteKey(DRA_A.clinicId, DRA_A.userId, "pat_1")}:t`), "lo de A se queda en su copia");
});

test("t8 N-O1: tras un 401, al volver solo se reintenta si la sesión es del MISMO usuario", async () => {
  const srv = server(); srv.fail(401);
  let quien: string | null = "u_b";
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, whoAmI: async () => quien, ...timers }));
  bindBrowserCopy(q, memStore(), DRA_A, "pat_1", "t");
  q.enqueue(put(11, "V", "caries"));
  await tick();
  assert.equal(q.failedBySession(), true);
  srv.online();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  win.dispatchEvent(new Event("focus")); // entró el Dr. B en otra pestaña
  await tick();
  assert.equal(srv.sent.length, 1, "con B no se manda");
  assert.equal(q.hasPending(), true);
  quien = "u_a"; // vuelve a entrar la Dra. A
  win.dispatchEvent(new Event("focus"));
  await tick();
  assert.equal(srv.sent.length, 2);
  assert.equal(q.hasPending(), false);
});

test("t8 N-O2: lo recuperado NO se manda solo; se ofrece con fecha y «Descartar» lo borra", async () => {
  const store = memStore();
  const t0 = Date.parse("2026-10-18T14:32:00Z");
  await dejarPendiente(store, DRA_A, "ayer", [put(16, "O", "caries")], () => t0);
  const srv = server();
  const q = new SaveQueue({ send: srv.send, ...timers, now: () => t0 + 3600_000 });
  assert.equal(bindBrowserCopy(q, store, DRA_A, "pat_1", "hoy"), 1);
  await tick();
  assert.equal(srv.sent.length, 0, "nada sale sin que la doctora diga «Guardar»");
  assert.deepEqual(q.getStatus().recovered, { count: 1, at: t0 });
  assert.deepEqual(q.overlay({}), {}, "tampoco se pinta como si ya estuviera");
  q.discardRecovered();
  assert.equal(q.getStatus().recovered, null);
  assert.equal([...store.data.keys()].filter((k) => k.endsWith(":ayer")).length, 0, "la copia vieja se borró");
});

test("t8 N-O2: «Guardar» aplica sobre lo de HOY — un «Limpiar todo» viejo no borra lo registrado después", async () => {
  const store = memStore();
  const t0 = Date.parse("2026-10-18T14:32:00Z");
  // sin red, en el iPad: «Limpiar todo», luego una caries en el 16, quita la
  // corona del 26 y escribe una nota en el 11 (que antes decía «sensible»)
  await dejarPendiente(store, DRA_A, "ipad", [
    { kind: "reset" },
    put(16, "O", "caries"),
    { kind: "delete", toothNumber: 26, surface: null, conditionId: "crown" },
    { kind: "note", toothNumber: 11, text: "fractura", prev: "sensible" },
  ], (() => { let i = 0; return () => t0 + 1000 * i++; })());
  const srv = server();
  const q = new SaveQueue({ send: srv.send, ...timers, now: () => t0 + 86_400_000 });
  bindBrowserCopy(q, store, DRA_A, "pat_1", "pc");
  // HOY en la base: lo de antes del reset (36 rct), lo que el equipo registró
  // DESPUÉS en otra PC (46 caries, y la corona del 26 vuelta a poner) y la
  // nota del 11 cambiada después por otro doctor
  const antes = "2026-10-17T10:00:00Z", despues = "2026-10-19T09:00:00Z";
  const base = hoy([
    { toothNumber: 36, surface: null, conditionId: "rct", updatedAt: antes },
    { toothNumber: 46, surface: "O", conditionId: "caries", updatedAt: despues },
    { toothNumber: 26, surface: null, conditionId: "crown", updatedAt: despues },
  ], { 11: ["movilidad grado 1", despues] });
  const plan = await aplicarRecuperado(q, async () => base);
  await tick();
  const enviado = srv.sent.map((x) => x.op);
  assert.deepEqual(enviado.filter((o) => o.kind === "reset"), [], "el «Limpiar todo» NUNCA se repite");
  assert.ok(enviado.some((o) => o.kind === "delete" && o.toothNumber === 36), "lo que existía al limpiar sí se quita");
  assert.ok(!enviado.some((o) => (o.kind === "delete" || o.kind === "put") && o.toothNumber === 46), "lo registrado después se queda");
  assert.ok(!enviado.some((o) => o.kind === "delete" && o.toothNumber === 26), "la corona puesta después no se quita");
  assert.ok(enviado.some((o) => o.kind === "put" && o.toothNumber === 16), "la caries recuperada se añade");
  const nota = enviado.find((o) => o.kind === "note" && o.toothNumber === 11) as { text: string } | undefined;
  assert.ok(nota && nota.text.startsWith("movilidad grado 1") && /\[Recuperado del .+\] fractura$/.test(nota.text), "la nota nueva no se pisa: se conservan las dos");
  assert.ok(plan.omitidos >= 2);
  assert.equal(q.getStatus().recovered, null);
});

test("t8 N-O2: planRecovery — quitar una marca solo si nadie la tocó después; la nota se escribe si no cambió", () => {
  const t = Date.parse("2026-10-18T12:00:00Z");
  const base = hoy([
    { toothNumber: 21, surface: "O", conditionId: "caries", updatedAt: "2026-10-18T11:00:00Z" }, // incisal del 21 (base «O»)
    { toothNumber: 31, surface: null, conditionId: "rct", updatedAt: "2026-10-18T13:00:00Z" },
  ], { 12: ["sensible", "2026-10-17T00:00:00Z"] });
  const plan = planRecovery([
    { op: { kind: "delete", toothNumber: 21, surface: "I", conditionId: "caries" }, at: t },
    { op: { kind: "delete", toothNumber: 31, surface: null, conditionId: "rct" }, at: t },
    { op: { kind: "note", toothNumber: 12, text: "fractura", prev: "sensible" }, at: t },
  ], base);
  assert.deepEqual(plan.ops, [
    { kind: "delete", toothNumber: 21, surface: "I", conditionId: "caries" },
    { kind: "note", toothNumber: 12, text: "fractura" },
  ]);
  assert.equal(plan.omitidos, 1, "el rct se volvió a tocar después: no se quita");
});

test("t8 N-O3 y O3: abrir SIN red — llave de la sesión de la página, mensaje en español, nunca «la última conocida»", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  try {
    // con la sesión que pintó la página (sede 2 tras cambiar de sede)
    const store = memStore();
    const srv = server(); srv.offline();
    const q = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
    const r = await cargarOdontograma({ patientId: "pat_1", queue: q, sesion: SEDE_2, store, leer: fetchOdontogram, force: true, tabId: "t" });
    assert.match(r.error ?? "", /^No se pudo cargar el odontograma: sin conexión/);
    assert.doesNotMatch(r.error ?? "", /Failed to fetch|Load failed/);
    q.enqueue(put(16, "O", "caries"));
    await tick();
    const llaves = [...store.data.keys()];
    assert.deepEqual(llaves, [`${pendienteKey("cli_2", "u_a", "pat_1")}:t`], "la copia va con la clínica de la SESIÓN (sede 2)");
    // sin sesión de la página y sin red: no se inventa llave
    const store2 = memStore();
    store2.setItem("dc:odo-ultima-clinica", "cli_1"); // lo que antes se usaba
    const q2 = new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers });
    await cargarOdontograma({ patientId: "pat_1", queue: q2, sesion: null, store: store2, leer: fetchOdontogram, force: true, tabId: "t" });
    q2.enqueue(put(17, "O", "caries"));
    await tick();
    assert.equal([...store2.data.keys()].filter((k) => k.startsWith(PENDIENTE_PREFIJO)).length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("t8 cargarOdontograma con red: sin sesión de la página engancha con la sesión del GET y pinta lo pendiente", async () => {
  const store = memStore();
  await dejarPendiente(store, DRA_A, "vieja", [put(16, "O", "caries")]);
  const q = new SaveQueue({ send: server().send, ...timers });
  const r = await cargarOdontograma({
    patientId: "pat_1", queue: q, sesion: null, store, force: true, tabId: "nueva",
    leer: async () => hoy([{ toothNumber: 36, surface: null, conditionId: "rct", updatedAt: "2026-10-17T10:00:00Z" }]),
  });
  assert.equal(r.error, null);
  assert.deepEqual(r.records?.[36].tooth, ["rct"]);
  assert.equal(q.getStatus().recovered?.count, 1, "lo de la carga anterior se ofrece (no se manda)");
});

test("t8 N-O4: al enganchar se barren las copias caducadas (48 h) y corruptas de CUALQUIER paciente", async () => {
  assert.equal(PENDIENTE_CADUCA_MS, 48 * 3600 * 1000);
  const store = memStore();
  const ahora = Date.parse("2026-10-20T12:00:00Z");
  const k = (pat: string) => `${pendienteKey("cli_1", "u_a", pat)}:x`;
  store.setItem(k("viejo"), JSON.stringify({ v: 2, savedAt: ahora, ops: [{ op: put(11, null, "rct"), at: ahora - PENDIENTE_CADUCA_MS - 1 }] }));
  store.setItem(k("mixto"), JSON.stringify({ v: 2, savedAt: ahora, ops: [
    { op: put(12, null, "rct"), at: ahora - PENDIENTE_CADUCA_MS - 1 }, { op: put(13, null, "rct"), at: ahora - 1000 }] }));
  store.setItem(k("roto"), "{no es json");
  store.setItem(`${PENDIENTE_PREFIJO}cli_1:pat_v1:x`, JSON.stringify({ v: 1, savedAt: ahora, ops: [put(14, null, "rct")] }));
  store.setItem("otra-cosa", "se respeta");
  assert.equal(sweepPendientes(store, ahora), 3);
  assert.deepEqual([...store.data.keys()].sort(), [k("mixto"), "otra-cosa"].sort());
  assert.equal(JSON.parse(store.getItem(k("mixto"))!).ops.length, 1, "del mixto solo queda lo de menos de 48 h");
  // y lo hace solo al enganchar a cualquier paciente
  store.setItem(k("viejo2"), JSON.stringify({ v: 2, savedAt: ahora, ops: [{ op: put(11, null, "rct"), at: ahora - PENDIENTE_CADUCA_MS - 1 }] }));
  bindBrowserCopy(new SaveQueue({ send: server().send, ...timers, now: () => ahora }), store, DRA_A, "otro_paciente", "t");
  assert.equal(store.getItem(k("viejo2")), null);
});

test("t8 N-O5: lo rechazado con 403/404 no queda en la copia del navegador", async () => {
  const store = memStore();
  const srv = server(); srv.fail(403);
  const q = new SaveQueue({ send: srv.send, ...timers });
  bindBrowserCopy(q, store, DRA_A, "pat_1", "t");
  q.enqueue(put(11, "V", "caries"));
  await tick();
  assert.equal(q.getStatus().state, "discarded");
  assert.equal(store.length, 0, "no vuelve al abrir");
});

test("O1: sin red, desmontado e iOS mata la pestaña → la copia queda (con la nota a medias) y se ofrece al volver", async () => {
  const store = memStore();
  const srv = server(); srv.offline();
  const q = saveQueueFor("pat_1", () => new SaveQueue({ send: srv.send, retryDelays: [60_000], ...timers }));
  bindBrowserCopy(q, store, DRA_A, "pat_1", "A");
  const detach = q.attach();
  q.enqueue(put(16, "O", "caries"));
  q.noteChanged(16, "dolor al frío", "");
  await tick();
  detach();
  const { win, doc } = page();
  uninstall = installPageHandlers(win as any, doc as any);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  const copia = JSON.parse(store.getItem(`${pendienteKey("cli_1", "u_a", "pat_1")}:A`)!);
  assert.deepEqual(copia.ops.map((g: any) => g.op.kind).sort(), ["note", "put"]);
  assert.ok(copia.ops.every((g: any) => typeof g.at === "number"), "cada cambio lleva su fecha");
  uninstall(); uninstall = null;
  _resetQueuesForTests();
  const q2 = new SaveQueue({ send: server().send, ...timers });
  assert.equal(bindBrowserCopy(q2, store, DRA_A, "pat_1", "B"), 2);
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
  win.dispatchEvent(new Event("pagehide"));
  assert.ok(srv.sent.some((x) => x.keepalive && x.op.kind === "put"));
  srv.online();
  win.dispatchEvent(new Event("online"));
  await tick();
  const e2 = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(e2);
  assert.equal(e2.defaultPrevented, false);
});

test("O1: aviso fijo «sin guardar» fuera de pantalla, con «Reintentar» y «Descartar»", async () => {
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
  assert.match(aviso.children[0].textContent, /1 cambio sin guardar \(sin conexión\)/);
  srv.online();
  aviso.children[1].listeners.click(); // Reintentar
  await tick();
  renderPendingNotice(doc, qs);
  assert.equal(els.get(NOTICE_ID), undefined, "todo guardado → el aviso desaparece");
  // un 400 rechazado fuera de pantalla: «Descartar» lo tira
  srv.fail(400);
  q.enqueue(put(12, "V", "caries"));
  await tick();
  renderPendingNotice(doc, qs);
  const aviso2: any = els.get(NOTICE_ID);
  aviso2.children[2].listeners.click(); // Descartar
  assert.equal(q.hasPending(), false);
  assert.equal(textoAvisoPendiente([q]), null);
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
