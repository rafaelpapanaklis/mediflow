/* ============================================================
   autosave — cola de guardado del odontograma VIVO (ws1-t11).

   Rafael pidió «que se guarde solo, sin poner Guardar». Así funciona:
   - cada cambio (marcar/quitar un hallazgo, la nota del diente, limpiar un
     diente o todo) se pinta al instante y se encola aquí;
   - la cola manda las escrituras de UNA en UNA y en orden, así marcar y
     desmarcar deprisa nunca llega al revés, y junta las que tocan lo mismo
     mientras esperan: solo viaja la última, nada se manda dos veces;
   - la nota se guarda sola tras una pausa al teclear (debounce) y al salir
     del cuadro, cerrar el panel, cambiar de pestaña o cerrar la página;
   - si falla la red o el servidor (0, 408, 429, 5xx) reintenta sola MIENTRAS
     la pestaña siga abierta, sin revertir lo que el doctor marcó, y un aviso
     fijo («No se guardó: sin conexión, reintentando…») se queda a la vista
     mientras haya algo pendiente, esté o no el odontograma en pantalla;
   - al cerrar u ocultar la pestaña con algo pendiente: `beforeunload` avisa y
     `pagehide` / `visibilitychange` mandan lo pendiente con keepalive. Si aun
     así no sale, eso se pierde — pero el aviso estuvo a la vista todo el
     tiempo.

   NO hay copia en el navegador entre sesiones (revisión t8, tercera vuelta:
   decisión del gerente). Al cargar se borran las llaves `dc:odo-pendiente:*`
   y `dc:odo-ultima-clinica` que dejaron versiones anteriores de esta rama
   (memoria del navegador, no datos de la clínica).

   Quién manda: cada cola sabe de qué sesión es (usuario y clínica que pintó la
   página). Antes de reintentar algo que falló —«Reintentar», vuelve la red,
   vuelve el foco— se pregunta quién tiene la sesión ahora: si es otro usuario
   u otra sede, NO se manda (no sale firmado por otro ni a otra sede) y se
   dice qué hacer.

   Las escrituras son idempotentes en el servidor (upsert / deleteMany y el
   candado de las filas de diente completo), así que un reintento de algo que
   sí llegó no duplica nada.
   ============================================================ */
import type { Records, ToothRecord } from "./types";

export type SaveOp =
  | { kind: "put"; toothNumber: number; surface: string | null; conditionId: string }
  | { kind: "delete"; toothNumber: number; surface: string | null; conditionId: string }
  | { kind: "note"; toothNumber: number; text: string }
  | { kind: "reset" };

export type SaveState = "idle" | "saving" | "saved" | "retrying" | "error" | "discarded";

export interface SaveStatus {
  state: SaveState;
  /** escrituras que faltan por confirmar (incluida la nota que se está tecleando y lo apartado) */
  pending: number;
  /** mensaje del último fallo (retrying / error / discarded) */
  error?: string;
  /** cuántas escrituras descartó el servidor (403/404 de verdad) desde que se creó la cola */
  discarded: number;
}

/** Quién tiene la sesión: usuario y clínica (sede) activa. */
export interface SessionInfo { userId: string; clinicId: string }

/** Lo que manda cada operación al servidor. Lanza un error con `status` (0 = sin respuesta) y `code`. */
export type SendFn = (op: SaveOp, opts: { keepalive: boolean }) => Promise<void>;

export interface QueueOptions {
  send: SendFn;
  /** espera tras la última tecla antes de guardar la nota (ms) */
  noteDelay?: number;
  /** esperas entre reintentos automáticos (ms); el último se repite */
  retryDelays?: number[];
  /** lo que lleve este tiempo fallando ya no se reintenta solo: se aparta y se pregunta */
  staleAfterMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  now?: () => number;
  /** ¿Quién tiene la sesión ahora? — antes de reintentar lo que falló */
  whoAmI?: () => Promise<SessionInfo | null>;
}

/** Lo mínimo de localStorage para borrar lo que dejaron versiones anteriores. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** Llaves que dejaron en el navegador versiones anteriores de esta rama (copia entre sesiones, ya quitada). */
export const LLAVES_VIEJAS = ["dc:odo-pendiente:", "dc:odo-ultima-clinica"];

/** Borra del navegador las copias de versiones anteriores. Devuelve cuántas borró. Nunca lanza. */
export function limpiarCopiasViejas(store: KeyValueStore | null): number {
  if (!store) return 0;
  let n = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && LLAVES_VIEJAS.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => { store.removeItem(k); n++; });
  } catch { /* bloqueado */ }
  return n;
}

/** Lo que lleva más de esto fallando ya no se reintenta solo (revisión t8, N3-O3). */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function opKey(op: SaveOp): string {
  if (op.kind === "reset") return "reset";
  if (op.kind === "note") return `n:${op.toothNumber}`;
  return `f:${op.toothNumber}:${op.surface ?? "-"}:${op.conditionId}`;
}

/**
 * Qué hacer con un fallo:
 *  - red: sin respuesta, tiempo agotado, demasiadas peticiones o fallo del
 *    servidor → reintentar solo;
 *  - sesion: sesión vencida (401) o el reto de dos pasos pendiente (403
 *    `two_factor_required` del middleware) → apartar y reintentar cuando
 *    vuelva el MISMO usuario (revisión t8, N3-O1: ya no se descarta);
 *  - descartar: la API dice que ese usuario no puede o que el paciente no es
 *    de esta clínica (`forbidden`, `patient_not_found`) → reintentar no lo
 *    arreglará (salvo que la sede activa haya cambiado: se comprueba antes);
 *  - rechazo: cualquier otro 4xx → apartar con «Reintentar / Descartar».
 */
export type TipoDeFallo = "red" | "sesion" | "descartar" | "rechazo";

export function tipoDeFallo(err: unknown): TipoDeFallo {
  const e = err as { status?: unknown; code?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  const code = typeof e?.code === "string" ? e.code : null;
  if (status === null || status === 0 || status === 408 || status === 429 || status >= 500) return "red";
  if (status === 401 || code === "two_factor_required") return "sesion";
  if ((status === 403 && code === "forbidden") || (status === 404 && code === "patient_not_found")) return "descartar";
  return "rechazo";
}

/** ¿Vale la pena reintentar solo? */
export function isTransient(err: unknown): boolean {
  return tipoDeFallo(err) === "red";
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "No se pudo guardar";
}

export const OTRA_SESION =
  "La sesión de esta pestaña cambió (otro usuario u otra sede en otra pestaña). Vuelve a la sede y al usuario con que abriste a este paciente y pulsa «Reintentar»; no cierres esta pestaña.";

export class SaveQueue {
  private queue: SaveOp[] = [];
  private inflight: SaveOp | null = null;
  /** lo apartado (rechazo, sesión, otra sede, demasiado viejo): no se reintenta solo ni detiene a lo demás */
  private failed: SaveOp[] = [];
  private failError: string | undefined;
  private transientError: string | undefined;
  private lastFailKind: TipoDeFallo | null = null;
  private noteDrafts = new Map<number, string>();
  private noteTimers = new Map<number, unknown>();
  private retryTimer: unknown = null;
  private attempt = 0;
  private version = 0;
  private touched = false;
  private status: SaveStatus = { state: "idle", pending: 0, discarded: 0 };
  private listeners = new Set<(s: SaveStatus) => void>();
  /** cuándo hizo el doctor cada escritura pendiente (por opKey) */
  private opAt = new Map<string, number>();
  /** escrituras que ya fallaron por la red al menos una vez */
  private retried = new Set<string>();
  private owner: SessionInfo | null = null;
  private attachedCount = 0;
  private discardedCount = 0;
  private discardError: string | undefined;
  private discardedOps: SaveOp[] = [];
  private readonly send: SendFn;
  private readonly noteDelay: number;
  private readonly retryDelays: number[];
  private readonly staleAfterMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private readonly now: () => number;
  private readonly whoAmI: (() => Promise<SessionInfo | null>) | null;

  constructor(opts: QueueOptions) {
    this.send = opts.send;
    this.noteDelay = opts.noteDelay ?? 1500;
    this.retryDelays = opts.retryDelays ?? [1000, 3000, 8000, 20000, 30000];
    this.staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => Date.now());
    this.whoAmI = opts.whoAmI ?? null;
  }

  /* ---------------- de quién es ---------------- */
  /** La sesión con que se abrió al paciente (la pinta el servidor, o la devuelve el primer GET). */
  setOwner(owner: SessionInfo | null) {
    if (owner && !this.owner) this.owner = owner;
  }

  getOwner(): SessionInfo | null { return this.owner; }

  /** ¿La sesión de ahora es la misma con que se abrió? Sin forma de saberlo, sí. */
  private async sameSession(): Promise<boolean> {
    if (!this.whoAmI || !this.owner) return true;
    const now = await this.whoAmI().catch(() => null);
    return !!now && now.userId === this.owner.userId && now.clinicId === this.owner.clinicId;
  }

  /** El odontograma de este paciente está en pantalla (su indicador ya avisa). */
  attach(): () => void {
    this.attachedCount++;
    this.refresh();
    let done = false;
    return () => { if (!done) { done = true; this.attachedCount--; this.refresh(); } };
  }

  isAttached(): boolean { return this.attachedCount > 0; }

  /** ¿Lo último apartado fue por la sesión (vencida, reto de dos pasos u otra sede)? */
  failedBySession(): boolean { return this.failed.length > 0 && this.lastFailKind === "sesion"; }

  /* ---------------- estado ---------------- */
  getStatus(): SaveStatus { return this.status; }

  subscribe(fn: (s: SaveStatus) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /**
   * Sube con cada cambio de la cola. Quien lee del servidor la anota antes de
   * pedir y la compara al llegar la respuesta: si cambió, esa lectura puede ser
   * anterior a una escritura que ya se confirmó y no debe pintarse.
   */
  getVersion(): number { return this.version; }

  /** ¿Queda algo sin confirmar (en cola, en vuelo, tecleándose o apartado)? */
  hasPending(): boolean {
    return this.queue.length > 0 || this.inflight !== null || this.noteDrafts.size > 0 || this.failed.length > 0;
  }

  /** Lo que el servidor descartó (o el doctor tiró) desde la última vez: la pantalla lo quita del dibujo. */
  takeDiscarded(): SaveOp[] {
    const out = this.discardedOps;
    this.discardedOps = [];
    return out;
  }

  /** Recalcula el estado visible a partir de lo que hay (nunca a parches). */
  private refresh() {
    this.version++;
    const busy = this.queue.length > 0 || this.inflight !== null || this.noteDrafts.size > 0;
    let state: SaveState;
    let error: string | undefined;
    if (this.retryTimer !== null) { state = "retrying"; error = this.transientError; }
    else if (busy) state = "saving";
    else if (this.failed.length) { state = "error"; error = this.failError; }
    else if (this.discardError) { state = "discarded"; error = this.discardError; }
    else state = this.touched ? "saved" : "idle";
    this.status = {
      state, error,
      pending: this.queue.length + (this.inflight ? 1 : 0) + this.noteDrafts.size + this.failed.length,
      discarded: this.discardedCount,
    };
    this.listeners.forEach((fn) => fn(this.status));
  }

  /* ---------------- entrada ---------------- */
  /** Encola una escritura. Si había otra de lo mismo esperando (o apartada), la sustituye. */
  enqueue(op: SaveOp) {
    this.touched = true;
    this.discardError = undefined;
    if (op.kind === "reset") {
      // limpiar todo deja sin sentido lo que esperaba (no lo que ya va en vuelo)
      this.queue = [];
      this.failed = [];
      this.noteTimers.forEach((id) => this.clearTimer(id));
      this.noteTimers.clear();
      this.noteDrafts.clear();
    } else if (op.kind === "note") {
      // una nota firme sustituye a la que se estaba tecleando de ese diente
      const t = this.noteTimers.get(op.toothNumber);
      if (t !== undefined) this.clearTimer(t);
      this.noteTimers.delete(op.toothNumber);
      this.noteDrafts.delete(op.toothNumber);
    }
    const k = opKey(op);
    this.queue = this.queue.filter((q) => opKey(q) !== k);
    this.failed = this.failed.filter((q) => opKey(q) !== k);
    this.queue.push(op);
    this.opAt.set(k, this.now());
    this.retried.delete(k);
    this.refresh();
    this.pump();
  }

  /** La nota de un diente cambió al teclear: se guarda sola tras una pausa. */
  noteChanged(toothNumber: number, text: string) {
    this.touched = true;
    this.discardError = undefined;
    this.noteDrafts.set(toothNumber, text);
    const timer = this.noteTimers.get(toothNumber);
    if (timer !== undefined) this.clearTimer(timer);
    this.noteTimers.set(toothNumber, this.setTimer(() => this.flushNote(toothNumber), this.noteDelay));
    this.refresh();
  }

  /** Manda ya la nota que se estaba tecleando (salir del cuadro, cerrar el panel…). */
  flushNote(toothNumber: number) {
    const t = this.noteTimers.get(toothNumber);
    if (t !== undefined) this.clearTimer(t);
    this.noteTimers.delete(toothNumber);
    if (!this.noteDrafts.has(toothNumber)) return;
    const text = this.noteDrafts.get(toothNumber)!;
    this.noteDrafts.delete(toothNumber);
    this.enqueue({ kind: "note", toothNumber, text });
  }

  /** Manda ya todo lo que se estaba tecleando. */
  flush() {
    [...this.noteDrafts.keys()].forEach((n) => this.flushNote(n));
  }

  /**
   * La página se cierra u oculta: una copia de lo pendiente sale ya con
   * keepalive (no da tiempo a ir de una en una). La cola NO se vacía: si la
   * página sigue (pestaña oculta, bfcache), sigue mandando lo suyo, y repetir
   * es inocuo (idempotente). Lo apartado no sale: espera a que alguien diga.
   */
  flushForUnload() {
    this.flush();
    // lo que va en vuelo puede no llegar si la página muere: se repite, salvo
    // que detrás espere otra de lo mismo o un «limpiar todo»
    const repeatInflight = this.inflight
      && !this.queue.some((q) => q.kind === "reset" || opKey(q) === opKey(this.inflight!));
    const ops = repeatInflight ? [this.inflight!, ...this.queue] : [...this.queue];
    const fire = (list: SaveOp[]) => list.forEach((op) => { this.send(op, { keepalive: true }).catch(() => {}); });
    // «limpiar todo» va primero y lo demás detrás: en paralelo podría borrarlo
    const r = ops.findIndex((op) => op.kind === "reset");
    if (r < 0) fire(ops);
    else this.send(ops[r], { keepalive: true }).then(() => fire(ops.filter((_, i) => i !== r)), () => {});
  }

  /**
   * «Reintentar» (y lo que pasa al volver la sesión): lo apartado vuelve a la
   * cola, pero SOLO si la sesión de ahora es la misma con que se abrió (N3-O2:
   * nada sale firmado por otro usuario ni a otra sede). Devuelve si se reanudó.
   */
  async retryNow(): Promise<boolean> {
    if (!(await this.sameSession())) {
      if (this.hasPending()) { this.lastFailKind = "sesion"; this.failError = OTRA_SESION; this.moveQueueToFailed(); }
      return false;
    }
    if (this.retryTimer !== null) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
    this.attempt = 0;
    this.failed.forEach((op) => this.retried.delete(opKey(op)));
    this.queue = [...this.failed, ...this.queue];
    this.failed = [];
    this.failError = undefined;
    this.lastFailKind = null;
    this.refresh();
    this.pump();
    return true;
  }

  /** Volvió la red: se reanuda lo que esperaba su reintento (no lo apartado), con la misma comprobación de sesión. */
  async resume(): Promise<boolean> {
    if (this.retryTimer === null) return false;
    if (!(await this.sameSession())) {
      if (this.retryTimer !== null) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
      this.lastFailKind = "sesion"; this.failError = OTRA_SESION;
      this.moveQueueToFailed();
      return false;
    }
    if (this.retryTimer !== null) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
    this.attempt = 0;
    this.refresh();
    this.pump();
    return true;
  }

  /** Aparta lo que esperaba en la cola (otra sesión): nada sale hasta que alguien diga. */
  private moveQueueToFailed() {
    this.failed = [...this.failed, ...this.queue];
    this.queue = [];
    this.refresh();
  }

  /** «Descartar»: tira lo apartado (la pantalla lo quita del dibujo y recarga del servidor). */
  discard() {
    this.failed.forEach((op) => { this.opAt.delete(opKey(op)); this.retried.delete(opKey(op)); });
    this.discardedOps.push(...this.failed);
    this.failed = [];
    this.failError = undefined;
    this.discardError = undefined;
    this.lastFailKind = null;
    this.discardedCount++;
    this.refresh();
  }

  /**
   * Pinta lo pendiente encima de lo que devolvió el servidor: al volver a
   * montar el odontograma con escrituras sin confirmar (o apartadas y aún sin
   * descartar), el doctor sigue viendo lo que marcó.
   */
  overlay(server: Records): Records {
    const out: Records = JSON.parse(JSON.stringify(server));
    const rec = (n: number): ToothRecord => (out[n] ??= { surfaces: {}, tooth: [] });
    const ops = [...(this.inflight ? [this.inflight] : []), ...this.failed, ...this.queue];
    for (const op of ops) {
      if (op.kind === "reset") { Object.keys(out).forEach((k) => delete out[Number(k)]); continue; }
      const r = rec(op.toothNumber);
      if (op.kind === "note") { r.note = op.text; continue; }
      const arr = op.surface ? (r.surfaces[op.surface] ??= []) : r.tooth;
      const i = arr.indexOf(op.conditionId);
      if (op.kind === "put" && i < 0) arr.push(op.conditionId);
      if (op.kind === "delete" && i >= 0) arr.splice(i, 1);
      if (op.surface && !r.surfaces[op.surface].length) delete r.surfaces[op.surface];
    }
    this.noteDrafts.forEach((text, n) => { rec(n).note = text; });
    return out;
  }

  /* ---------------- envío ---------------- */
  private pump() {
    if (this.inflight || this.retryTimer !== null) return;
    const op = this.queue.shift();
    if (!op) return;
    const k = opKey(op);
    // N3-O3: lo que ya falló por la red y lleva demasiado (la laptop cerrada
    // toda la noche) no sale solo al volver la red: se aparta y se pregunta
    if (this.retried.has(k) && this.now() - (this.opAt.get(k) ?? this.now()) > this.staleAfterMs) {
      this.failed.push(op);
      this.lastFailKind = "rechazo";
      const min = Math.round(this.staleAfterMs / 60000);
      this.failError = `Hay cambios que llevan más de ${min} min sin poder guardarse. Revisa el odontograma y pulsa «Reintentar» para mandarlos o «Descartar».`;
      this.refresh();
      this.pump();
      return;
    }
    this.inflight = op;
    this.send(op, { keepalive: false }).then(
      () => {
        this.inflight = null;
        this.attempt = 0;
        this.transientError = undefined;
        if (!this.queue.some((q) => opKey(q) === k)) { this.opAt.delete(k); this.retried.delete(k); }
        this.refresh();
        this.pump();
      },
      (err) => { void this.onFail(op, err); },
    );
  }

  private async onFail(op: SaveOp, err: unknown) {
    const k = opKey(op);
    // si mientras tanto llegó otra de lo mismo, esa manda y esta sobra
    const superseded = () => op.kind !== "reset" && this.queue.some((q) => opKey(q) === k);
    let tipo = tipoDeFallo(err);
    let mensaje = errorMessage(err);
    if (tipo === "descartar" && !(await this.sameSession())) {
      // N3-O4: un 403/404 porque la sede activa (o el usuario) cambió en otra
      // pestaña no es un «no» del servidor: se aparta con un aviso claro
      tipo = "sesion";
      mensaje = OTRA_SESION;
    }
    this.inflight = null;
    if (tipo === "descartar") {
      // sin permiso o paciente de otra clínica (revisión t8, N-O5): reintentar
      // no lo arreglará nunca. Se descarta, se dice y la pantalla lo quita
      if (!superseded()) { this.opAt.delete(k); this.retried.delete(k); this.discardedOps.push(op); }
      this.discardedCount++;
      this.discardError = `${mensaje} Ese cambio se descartó.`;
      this.refresh();
      this.pump();
      return;
    }
    if (tipo === "sesion" || tipo === "rechazo") {
      // apartado: lo demás sigue guardándose (no se queda como rehén)
      if (!superseded()) this.failed.push(op);
      this.lastFailKind = tipo;
      this.failError = mensaje;
      this.refresh();
      this.pump();
      return;
    }
    if (!superseded()) { this.queue.unshift(op); this.retried.add(k); }
    const delay = this.retryDelays[Math.min(this.attempt, this.retryDelays.length - 1)];
    this.attempt++;
    this.transientError = mensaje;
    this.retryTimer = this.setTimer(() => { this.retryTimer = null; this.refresh(); this.pump(); }, delay);
    this.refresh();
  }
}

/* Una cola por paciente y por pestaña: sobrevive a que el odontograma se desmonte. */
const queues = new Map<string, SaveQueue>();

export function saveQueueFor(patientId: string, make: () => SaveQueue): SaveQueue {
  let q = queues.get(patientId);
  if (!q) {
    q = make();
    queues.set(patientId, q);
    q.subscribe(() => scheduleNotice());
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      let store: KeyValueStore | null = null;
      try { store = window.localStorage; } catch { /* bloqueado */ }
      installPageHandlers(window, document, store);
    }
  }
  return q;
}

/** Solo pruebas: vacía el registro de colas. */
export function _resetQueuesForTests() { queues.clear(); handlersInstalled = null; }

/* ---------------- avisos de la página ----------------
   Viven con las colas, no con el componente: siguen activos aunque el
   odontograma se haya desmontado (otra pestaña de la ficha). */
interface PageTarget {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}
interface DocTarget extends PageTarget { visibilityState: string }

let handlersInstalled: (() => void) | null = null;

export function installPageHandlers(win: PageTarget, doc: DocTarget, store: KeyValueStore | null = null): () => void {
  if (handlersInstalled) return handlersInstalled;
  // lo que dejaron en el navegador versiones anteriores (copia entre sesiones, ya quitada)
  limpiarCopiasViejas(store);
  const all = () => [...queues.values()];
  // la pestaña se oculta (cambiar de app en iPad, bloquear el teléfono): puede
  // ser el último aviso antes de que la maten → lo pendiente sale con keepalive.
  // Al volver: lo apartado por la sesión se reintenta (si es el mismo usuario).
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") all().forEach((q) => q.flushForUnload());
    else all().forEach((q) => { if (q.failedBySession()) void q.retryNow(); });
  };
  const onPageHide = () => all().forEach((q) => q.flushForUnload());
  // cerrar o recargar en escritorio: el navegador pregunta si queda algo
  const onBeforeUnload = (e: Event) => {
    const qs = all();
    qs.forEach((q) => q.flush());
    if (!qs.some((q) => q.hasPending())) return;
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = "";
  };
  // volvió la red: se reanuda lo que esperaba (con la comprobación de sesión)
  const onOnline = () => all().forEach((q) => { void q.resume(); });
  const onFocus = () => all().forEach((q) => { if (q.failedBySession()) void q.retryNow(); });
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("beforeunload", onBeforeUnload);
  win.addEventListener("online", onOnline);
  win.addEventListener("focus", onFocus);
  handlersInstalled = () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", onPageHide);
    win.removeEventListener("beforeunload", onBeforeUnload);
    win.removeEventListener("online", onOnline);
    win.removeEventListener("focus", onFocus);
    handlersInstalled = null;
  };
  return handlersInstalled;
}

/* ---------------- aviso fijo «sin guardar» ----------------
   Mientras haya algo sin guardar por la red o apartado, este aviso, fuera de
   React y pegado al <body>, se queda a la vista — esté o no el odontograma en
   pantalla. Desaparece en cuanto todo se confirma o se descarta. */
export interface NoticeDoc {
  getElementById(id: string): NoticeEl | null;
  createElement(tag: string): NoticeEl;
  body: { appendChild(el: NoticeEl): unknown };
}
export interface NoticeEl {
  id: string;
  textContent: string | null;
  style: Record<string, string> | CSSStyleDeclaration;
  setAttribute(name: string, value: string): void;
  appendChild(el: NoticeEl): unknown;
  remove(): void;
  addEventListener(type: string, fn: () => void): void;
}

export const NOTICE_ID = "odo-aviso-pendiente";

/** Texto del aviso fijo; null si no hay nada que avisar. */
export function textoAvisoPendiente(qs: SaveQueue[]): string | null {
  const conProblema = qs.filter((q) => q.hasPending() && (q.getStatus().state === "retrying" || q.getStatus().state === "error"));
  const fuera = qs.filter((q) => !q.isAttached() && q.hasPending());
  if (!conProblema.length && !fuera.length) return null;
  const lista = conProblema.length ? conProblema : fuera;
  const n = lista.reduce((acc, q) => acc + q.getStatus().pending, 0);
  const cambios = n === 1 ? "1 cambio" : `${n} cambios`;
  const err = lista.find((q) => q.getStatus().state === "error");
  if (err) return `No se guardó: Odontograma, ${cambios} pendiente${n === 1 ? "" : "s"}. ${err.getStatus().error ?? "El servidor no lo aceptó."}`;
  if (lista.some((q) => q.getStatus().state === "retrying")) {
    return `No se guardó: sin conexión, reintentando. Odontograma: ${cambios} sin guardar; no cierres esta pestaña.`;
  }
  return `Odontograma: guardando ${cambios}…`;
}

export function renderPendingNotice(doc: NoticeDoc, getQs: () => SaveQueue[] = () => [...queues.values()]) {
  const texto = textoAvisoPendiente(getQs());
  let el = doc.getElementById(NOTICE_ID);
  if (!texto) { el?.remove(); return; }
  if (!el) {
    el = doc.createElement("div");
    el.id = NOTICE_ID;
    el.setAttribute("role", "alert");
    Object.assign(el.style, {
      position: "fixed", left: "16px", bottom: "16px", zIndex: "2147483000", maxWidth: "min(460px, calc(100vw - 32px))",
      background: "#fdf3f3", color: "#8a3a39", border: "1px solid #f0b4b4", borderRadius: "10px",
      padding: "10px 12px", font: "600 13px/1.35 system-ui, sans-serif", boxShadow: "0 6px 24px rgba(0,0,0,.12)",
      display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap",
    });
    const span = doc.createElement("span");
    span.setAttribute("data-texto", "1");
    el.appendChild(span);
    const btn = doc.createElement("button");
    btn.setAttribute("type", "button");
    btn.textContent = "Reintentar";
    Object.assign(btn.style, { border: "1px solid #f0b4b4", background: "#fff", color: "#b3403f", borderRadius: "6px", padding: "2px 8px", fontWeight: "700", cursor: "pointer" });
    btn.addEventListener("click", () => getQs().forEach((q) => { void q.retryNow(); }));
    el.appendChild(btn);
    // lo apartado (rechazo, sesión de otro, demasiado viejo) se puede tirar desde aquí
    const tirar = doc.createElement("button");
    tirar.setAttribute("type", "button");
    tirar.setAttribute("data-descartar", "1");
    tirar.textContent = "Descartar";
    Object.assign(tirar.style, btn.style);
    tirar.addEventListener("click", () => getQs().forEach((q) => q.discard()));
    el.appendChild(tirar);
    doc.body.appendChild(el);
    (el as unknown as { _texto: NoticeEl })._texto = span;
  }
  const span = (el as unknown as { _texto?: NoticeEl })._texto;
  if (span) span.textContent = texto; else el.textContent = texto;
}

let noticeQueued = false;
function scheduleNotice() {
  if (typeof document === "undefined" || noticeQueued) return;
  noticeQueued = true;
  queueMicrotask(() => { noticeQueued = false; renderPendingNotice(document as unknown as NoticeDoc); });
}
