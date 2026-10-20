/**
 * ws1-t11 — autoguardado del odontograma vivo (autosave.ts).
 *
 * Sin botón «Guardar»: cada cambio se encola y se manda solo. Aquí se
 * comprueba la cola con un servidor de mentira y relojes manuales: orden,
 * que nada viaje dos veces, la nota con pausa, reintentos sin perder lo
 * marcado, el aviso cuando el servidor dice que no, y lo pendiente pintado
 * encima de lo que devuelve el servidor al volver a montar.
 *
 * Run: npx tsx --test src/components/dashboard/odontogram-v2/__tests__/autosave.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { SaveQueue, isTransient, opKey, type SaveOp, type SaveStatus } from "../autosave";
import type { Records } from "../types";
import { entriesToRecords, fromServerSurface, recordsForServer, toServerSurface } from "../adapter";
import { applyToothDelta, mergeLiveOdontogram } from "../merge-consulta";

/** Relojes a mano: `tick(ms)` dispara lo que toque. */
function clock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id: unknown) => { timers.delete(id as number); },
    async tick(ms: number) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].fn();
        await settle();
      }
      await settle();
    },
  };
}
const settle = () => new Promise((r) => setImmediate(r));

class HttpErr extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }

/** Servidor de mentira: guarda lo recibido; `fail` decide si una petición falla. */
function server() {
  const sent: { op: SaveOp; keepalive: boolean }[] = [];
  let fail: ((op: SaveOp, n: number) => number | null) | null = null;
  let holds: (() => void)[] = [];
  let holding = false;
  const send = (op: SaveOp, opts: { keepalive: boolean }) => {
    sent.push({ op, keepalive: opts.keepalive });
    const status = fail ? fail(op, sent.length) : null;
    if (holding) return new Promise<void>((res, rej) => { holds.push(() => (status !== null ? rej(new HttpErr(status)) : res())); });
    return status !== null ? Promise.reject(new HttpErr(status)) : Promise.resolve();
  };
  return {
    sent, send,
    setFail(f: typeof fail) { fail = f; },
    hold() { holding = true; },
    release() { holding = false; const h = holds; holds = []; h.forEach((fn) => fn()); },
  };
}

function makeQueue(srv: ReturnType<typeof server>, c = clock()) {
  const states: SaveStatus[] = [];
  const q = new SaveQueue({ send: srv.send, noteDelay: 1000, retryDelays: [1000, 5000], setTimer: c.setTimer, clearTimer: c.clearTimer });
  q.subscribe((s) => states.push(s));
  return { q, c, states };
}

const put = (n: number, s: string | null, c: string): SaveOp => ({ kind: "put", toothNumber: n, surface: s, conditionId: c });
const del = (n: number, s: string | null, c: string): SaveOp => ({ kind: "delete", toothNumber: n, surface: s, conditionId: c });

test("cada cambio sale solo y en orden; al terminar queda «Guardado»", async () => {
  const srv = server();
  const { q, states } = makeQueue(srv);
  q.enqueue(put(16, "O", "caries"));
  q.enqueue(put(26, null, "crown"));
  q.enqueue(del(16, "O", "caries"));
  await settle(); await settle(); await settle();
  assert.deepEqual(srv.sent.map((x) => x.op), [put(16, "O", "caries"), put(26, null, "crown"), del(16, "O", "caries")]);
  assert.equal(states.at(-1)?.state, "saved");
  assert.equal(q.hasPending(), false);
});

test("marcar y desmarcar deprisa: lo que espera se junta y nada viaja dos veces", async () => {
  const srv = server();
  const { q } = makeQueue(srv);
  srv.hold();
  q.enqueue(put(36, "M", "caries")); // sale ya (en vuelo)
  q.enqueue(del(36, "M", "caries"));
  q.enqueue(put(36, "M", "caries"));
  q.enqueue(del(36, "M", "caries")); // de las tres que esperaban, solo cuenta esta
  srv.release(); await settle(); await settle();
  assert.deepEqual(srv.sent.map((x) => x.op), [put(36, "M", "caries"), del(36, "M", "caries")]);
});

test("la nota se guarda sola tras la pausa, una vez y con el último texto", async () => {
  const srv = server();
  const { q, c } = makeQueue(srv);
  q.noteChanged(21, "f");
  q.noteChanged(21, "fr");
  await c.tick(600);
  q.noteChanged(21, "fractura");
  await c.tick(900);
  assert.equal(srv.sent.length, 0, "no se manda mientras se teclea");
  assert.equal(q.hasPending(), true, "lo tecleado cuenta como pendiente (aviso al cerrar)");
  await c.tick(200);
  assert.deepEqual(srv.sent.map((x) => x.op), [{ kind: "note", toothNumber: 21, text: "fractura" }]);
});

test("salir del cuadro / cerrar el panel manda la nota ya; sin teclear no se manda nada", async () => {
  const srv = server();
  const { q, c } = makeQueue(srv);
  q.flushNote(11); // mirar la nota no es escribirla
  q.noteChanged(11, "sensible al frío");
  q.flushNote(11);
  await settle();
  assert.deepEqual(srv.sent.map((x) => x.op), [{ kind: "note", toothNumber: 11, text: "sensible al frío" }]);
  await c.tick(5000);
  assert.equal(srv.sent.length, 1, "el temporizador de la pausa ya no vuelve a mandarla");
});

test("sin red: reintenta sola, NO pierde lo marcado y termina «Guardado»", async () => {
  const srv = server();
  const { q, c, states } = makeQueue(srv);
  srv.setFail((_op, n) => (n <= 2 ? 0 : null)); // dos fallos de red y luego bien
  q.enqueue(put(46, null, "rct"));
  await settle();
  assert.equal(states.at(-1)?.state, "retrying");
  assert.equal(q.hasPending(), true);
  // lo que no llegó se sigue pintando encima de lo que diga el servidor
  assert.deepEqual(q.overlay({})[46].tooth, ["rct"]);
  await c.tick(1000);
  assert.equal(states.at(-1)?.state, "retrying");
  await c.tick(5000);
  assert.equal(states.at(-1)?.state, "saved");
  assert.equal(srv.sent.length, 3);
  assert.ok(srv.sent.every((x) => JSON.stringify(x.op) === JSON.stringify(put(46, null, "rct"))));
});

test("si mientras reintenta llega otra de lo mismo, manda la nueva y no la vieja", async () => {
  const srv = server();
  const { q, c } = makeQueue(srv);
  srv.setFail((_op, n) => (n === 1 ? 503 : null));
  q.enqueue(put(14, "O", "caries"));
  await settle();
  q.enqueue(del(14, "O", "caries"));
  await c.tick(1000);
  assert.deepEqual(srv.sent.map((x) => x.op), [put(14, "O", "caries"), del(14, "O", "caries")]);
});

test("el servidor dice que no (403): avisa, no reintenta solo, y «Reintentar» / «Descartar» funcionan", async () => {
  const srv = server();
  const { q, c, states } = makeQueue(srv);
  srv.setFail(() => 403);
  q.enqueue(put(11, "V", "caries"));
  q.enqueue(put(12, "V", "caries"));
  await settle(); await settle();
  assert.equal(states.at(-1)?.state, "error");
  assert.equal(states.at(-1)?.error, "HTTP 403");
  assert.equal(states.at(-1)?.pending, 2);
  assert.equal(q.hasPending(), true, "lo rechazado sigue contando: el navegador avisa al cerrar");
  await c.tick(60_000);
  assert.equal(srv.sent.length, 2, "un 403 no se reintenta solo");
  srv.setFail(null);
  q.retryNow();
  await settle(); await settle(); await settle();
  assert.equal(srv.sent.length, 4);
  assert.equal(states.at(-1)?.state, "saved");

  srv.setFail(() => 404);
  q.enqueue(put(13, "V", "caries"));
  await settle();
  assert.equal(states.at(-1)?.state, "error");
  assert.deepEqual(q.overlay({})[13].surfaces, { V: ["caries"] }, "hasta descartar, se sigue viendo lo marcado");
  q.discard();
  assert.equal(q.hasPending(), false);
  assert.equal(states.at(-1)?.state, "saved");
  assert.deepEqual(q.overlay({}), {});
});

test("un rechazo (400) no deja como rehén lo que va detrás: lo demás se guarda", async () => {
  // Caso real del refutador: una nota de más de 2000 caracteres o una cara que
  // la API no conoce. Antes de esto, un solo 400 paraba toda la cola.
  const srv = server();
  const { q, states } = makeQueue(srv);
  srv.setFail((op) => (op.kind === "note" ? 400 : null));
  q.enqueue({ kind: "note", toothNumber: 21, text: "x".repeat(2001) });
  q.enqueue(put(22, null, "crown"));
  q.enqueue(put(23, "V", "caries"));
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(srv.sent.map((x) => opKey(x.op)), ["n:21", opKey(put(22, null, "crown")), opKey(put(23, "V", "caries"))]);
  assert.equal(states.at(-1)?.state, "error");
  assert.equal(states.at(-1)?.pending, 1);
  // una nota nueva del mismo diente sustituye a la rechazada
  srv.setFail(null);
  q.enqueue({ kind: "note", toothNumber: 21, text: "corta" });
  await settle(); await settle();
  assert.equal(states.at(-1)?.state, "saved");
  assert.equal(q.hasPending(), false);
});

test("mientras espera el reintento, un cambio nuevo no borra el aviso de «sin conexión»", async () => {
  const srv = server();
  const { q, c, states } = makeQueue(srv);
  srv.setFail(() => 0);
  q.enqueue(put(11, "V", "caries"));
  await settle();
  assert.equal(states.at(-1)?.state, "retrying");
  q.enqueue(put(12, "V", "caries"));
  q.noteChanged(13, "a");
  assert.equal(states.at(-1)?.state, "retrying");
  srv.setFail(null);
  await c.tick(1000);
  await c.tick(1500);
  assert.equal(states.at(-1)?.state, "saved");
});

test("getVersion sube con cada confirmación: una lectura que cruzó una escritura se reconoce", async () => {
  const srv = server();
  const { q } = makeQueue(srv);
  srv.hold();
  q.enqueue(put(11, "V", "caries"));
  const v = q.getVersion(); // aquí «sale» el GET
  srv.release(); await settle(); // el PUT se confirma antes de que vuelva el GET
  assert.notEqual(q.getVersion(), v);
  assert.equal(q.hasPending(), false, "la cola ya está vacía: sin la versión, el GET viejo borraría la marca");
});

test("«Limpiar todo» deja sin efecto lo que esperaba, pero lo que va detrás sí sale", async () => {
  const srv = server();
  const { q } = makeQueue(srv);
  srv.hold();
  q.enqueue(put(11, "V", "caries")); // en vuelo
  q.enqueue(put(12, "V", "caries")); // espera → sobra
  q.noteChanged(13, "x");            // se teclea → sobra
  q.enqueue({ kind: "reset" });
  q.enqueue(put(21, null, "crown"));
  srv.release(); await settle(); await settle(); await settle();
  assert.deepEqual(srv.sent.map((x) => x.op), [put(11, "V", "caries"), { kind: "reset" }, put(21, null, "crown")]);
});

test("overlay: lo pendiente se pinta sobre el servidor (hallazgos, notas tecleándose, reset)", () => {
  const srv = server();
  const { q } = makeQueue(srv);
  srv.hold();
  const base: Records = { 16: { surfaces: { O: ["caries"] }, tooth: [], note: "vieja" }, 26: { surfaces: {}, tooth: ["crown"] } };
  q.enqueue(del(16, "O", "caries"));
  q.enqueue(put(16, "M", "restoration"));
  q.noteChanged(16, "nueva");
  const out = q.overlay(base);
  assert.deepEqual(out[16].surfaces, { M: ["restoration"] });
  assert.equal(out[16].note, "nueva");
  assert.deepEqual(out[26].tooth, ["crown"]);
  assert.deepEqual(base[16].surfaces, { O: ["caries"] }, "no toca lo que vino del servidor");
  q.enqueue({ kind: "reset" });
  q.enqueue(put(11, null, "missing"));
  assert.deepEqual(Object.keys(q.overlay(base)), ["11"]);
});

test("al cerrar la página lo pendiente sale con keepalive (también la nota a medias)", async () => {
  const srv = server();
  const { q } = makeQueue(srv);
  srv.hold();
  q.enqueue(put(31, "L", "caries")); // en vuelo
  q.enqueue(put(32, "L", "caries"));
  q.noteChanged(33, "movilidad");
  q.flushForUnload();
  await settle();
  const ka = srv.sent.filter((x) => x.keepalive).map((x) => opKey(x.op)).sort();
  assert.deepEqual(ka, [opKey(put(31, "L", "caries")), opKey(put(32, "L", "caries")), "n:33"].sort());
  // si la página vuelve (bfcache), nada se perdió: la cola sigue con lo suyo
  assert.equal(q.hasPending(), true);
  srv.release(); await settle(); await settle(); await settle();
  assert.equal(q.hasPending(), false);
});

test("al cerrar la página con «Limpiar todo» en cola, lo que iba en vuelo no se repite detrás", async () => {
  const srv = server();
  const { q } = makeQueue(srv);
  srv.hold();
  q.enqueue(put(41, "V", "caries")); // en vuelo
  q.enqueue({ kind: "reset" });
  q.flushForUnload();
  await settle(); await settle();
  const ka = srv.sent.filter((x) => x.keepalive).map((x) => opKey(x.op));
  assert.deepEqual(ka, ["reset"], "repetir el put tras el reset resucitaría el hallazgo");
});

test("qué se reintenta: sin respuesta, 408, 429 y 5xx sí; 400/403/404 no", () => {
  for (const s of [0, 408, 429, 500, 503]) assert.equal(isTransient({ status: s }), true, String(s));
  for (const s of [400, 401, 403, 404, 422]) assert.equal(isTransient({ status: s }), false, String(s));
  assert.equal(isTransient(new TypeError("Failed to fetch")), true);
});

test("la API no duplica filas de diente completo ni notas: buscar-y-crear con candado", () => {
  // La unique (patientId, toothNumber, surface, conditionId) no cubre surface
  // NULL en Postgres; con autoguardado, dos pestañas o un reintento pueden
  // mandar el mismo PUT a la vez.
  const root = path.resolve(__dirname, "../../../../..");
  const main = fs.readFileSync(path.join(root, "src/app/api/odontogram/route.ts"), "utf8");
  const note = fs.readFileSync(path.join(root, "src/app/api/odontogram/note/route.ts"), "utf8");
  assert.match(main, /pg_advisory_xact_lock\(hashtext\(\$\{candadoDiente\(patientId, toothNumber, conditionId\)\}\)\)[\s\S]*?tx\.odontogramEntry\.findFirst\(\{\s*where: \{ patientId, toothNumber, surface: null, conditionId \}/);
  assert.match(note, /pg_advisory_xact_lock\(hashtext\([\s\S]*?NOTE_CONDITION[\s\S]*?tx\.odontogramEntry\.findFirst/);
  assert.doesNotMatch(main, /^export function/m, "route.ts solo exporta los métodos (Next rechaza otros exports)");
});

test("la cara incisal: la pantalla dice «I», la base «O» (antes la API rechazaba la «I» con 400)", () => {
  assert.equal(toServerSurface("I"), "O");
  assert.equal(toServerSurface("M"), "M");
  assert.equal(toServerSurface(null), null);
  assert.equal(fromServerSurface(11, "O"), "I", "anterior: su centro es la incisal");
  assert.equal(fromServerSurface(63, "O"), "I");
  assert.equal(fromServerSurface(16, "O"), "O", "posterior: oclusal");
  assert.equal(fromServerSurface(11, "M"), "M");
  // lo que viene de la base (también lo importado: el importador ya guarda «incisal» como «O»)
  const recs = entriesToRecords([
    { toothNumber: 21, surface: "O", conditionId: "caries" },
    { toothNumber: 26, surface: "O", conditionId: "caries" },
  ]);
  assert.deepEqual(recs[21].surfaces, { I: ["caries"] });
  assert.deepEqual(recs[26].surfaces, { O: ["caries"] });
  // «Guardar consulta»: /sync solo acepta M|D|V|L|O
  const out = recordsForServer({ 11: { surfaces: { I: ["caries"], M: ["restoration"] }, tooth: [], note: "n" } });
  assert.deepEqual(out[11].surfaces, { O: ["caries"], M: ["restoration"] });
  assert.equal(out[11].note, "n");
});

test("consulta: el cambio del doctor se aplica sobre el vivo fresco, sin pisar lo que cambió otra pestaña", () => {
  // Al tocar el 16 tenía caries en O; el doctor añadió una restauración en M
  // y quitó la caries. Mientras, en la pestaña Odontograma alguien añadió una
  // corona al 16 (autoguardada en el vivo).
  const base = { surfaces: { O: ["caries"] }, tooth: [] };
  const now = { surfaces: { M: ["restoration"] }, tooth: [] };
  const live = { surfaces: { O: ["caries"] }, tooth: ["crown"] };
  assert.deepEqual(applyToothDelta(live, base, now), { surfaces: { M: ["restoration"] }, tooth: ["crown"] });
  // la nota manda solo si el doctor la cambió
  assert.equal(applyToothDelta({ surfaces: {}, tooth: [], note: "viva" }, { surfaces: {}, tooth: [] }, { surfaces: {}, tooth: [] }).note, "viva");
  assert.equal(applyToothDelta({ surfaces: {}, tooth: [], note: "viva" }, { surfaces: {}, tooth: [] }, { surfaces: {}, tooth: [], note: "mía" }).note, "mía");

  // precarga: lo no tocado sale del vivo; lo tocado lleva el cambio; un diente
  // que el doctor vació no reaparece
  const liveAll: Records = { 16: live, 26: { surfaces: {}, tooth: ["rct"] }, 36: { surfaces: { O: ["caries"] }, tooth: [] } };
  const local: Records = { 16: now, 26: { surfaces: {}, tooth: [] }, 36: { surfaces: {}, tooth: [] } };
  const bases = new Map([[16, base], [36, { surfaces: { O: ["caries"] }, tooth: [] }]]);
  const merged = mergeLiveOdontogram(liveAll, local, true, bases);
  assert.deepEqual(merged[16], { surfaces: { M: ["restoration"] }, tooth: ["crown"] });
  assert.deepEqual(merged[26], { surfaces: {}, tooth: ["rct"] }, "26 no se tocó: manda el vivo");
  assert.equal(merged[36], undefined, "el doctor quitó la caries del 36: no reaparece");
  // marcado antes de que llegara la precarga (base vacía): se suma al vivo, no lo sustituye
  const pre = mergeLiveOdontogram({ 46: { surfaces: { O: ["caries"] }, tooth: [] } }, { 46: { surfaces: { V: ["caries"] }, tooth: [] } }, true, new Map([[46, { surfaces: {}, tooth: [] }]]));
  assert.deepEqual(pre[46].surfaces, { O: ["caries"], V: ["caries"] });
});
