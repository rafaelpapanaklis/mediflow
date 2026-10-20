/* ============================================================
   autosave — cola de guardado del odontograma VIVO (ws1-t11).

   Cada cambio (marcar/quitar un hallazgo, la nota del diente, limpiar un
   diente o todo) se pinta al instante y se encola aquí. La cola:
   - manda las escrituras de UNA en UNA y en orden, así marcar y desmarcar
     deprisa nunca llega al revés;
   - junta las que tocan lo mismo (mismo diente+cara+hallazgo, o la nota del
     mismo diente) mientras esperan: solo viaja la última, nada se manda dos
     veces;
   - la nota se guarda sola tras una pausa al teclear (debounce) y al salir
     del cuadro, cerrar el panel, cambiar de pestaña o cerrar la página;
   - si falla por red o por el servidor (0, 408, 429, 5xx) reintenta sola con
     espera creciente y NO revierte lo que el doctor marcó; si el servidor dice
     que no (403, 404, 400…) aparta ESA escritura, avisa con «Reintentar» y
     «Descartar», y sigue guardando lo demás;
   - vive por paciente y por pestaña del navegador (registro de módulo): si el
     odontograma se desmonta con algo pendiente (cambio de pestaña de la
     ficha), lo pendiente se sigue mandando y al volver se pinta encima de lo
     que diga el servidor;
   - (revisión t4, O1) copia lo pendiente en el navegador (localStorage, por
     clínica y paciente) en cada cambio: si se cierra el navegador sin red —o
     iOS mata la pestaña, donde no hay `beforeunload`— lo pendiente sale solo
     la próxima vez que se abra a ese paciente. Los avisos de cierre
     (`pagehide`, `visibilitychange`, `beforeunload`, `online`) se registran
     aquí, no en el componente, y un aviso fijo «sin guardar» se ve aunque el
     odontograma ya no esté en pantalla.

   Las escrituras son idempotentes en el servidor (upsert / deleteMany), así
   que un reintento de algo que sí llegó no duplica nada.
   ============================================================ */
import type { Records, ToothRecord } from "./types";

export type SaveOp =
  | { kind: "put"; toothNumber: number; surface: string | null; conditionId: string }
  | { kind: "delete"; toothNumber: number; surface: string | null; conditionId: string }
  | { kind: "note"; toothNumber: number; text: string }
  | { kind: "reset" };

export type SaveState = "idle" | "saving" | "saved" | "retrying" | "error";

export interface SaveStatus {
  state: SaveState;
  /** escrituras que faltan por confirmar (incluida la nota que se está tecleando) */
  pending: number;
  /** mensaje del último fallo (retrying / error) */
  error?: string;
}

/** Lo que manda cada operación al servidor. Lanza un error con `status` (0 = sin respuesta). */
export type SendFn = (op: SaveOp, opts: { keepalive: boolean }) => Promise<void>;

export interface QueueOptions {
  send: SendFn;
  /** espera tras la última tecla antes de guardar la nota (ms) */
  noteDelay?: number;
  /** esperas entre reintentos automáticos (ms); el último se repite */
  retryDelays?: number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  now?: () => number;
}

/** Lo mínimo de localStorage que se usa (inyectable en las pruebas). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** Cada pestaña escribe su propia copia: dos pestañas del mismo paciente no se borran la una a la otra. */
const TAB_ID = Math.random().toString(36).slice(2, 10);

/** Lo pendiente guardado en el navegador caduca: no se manda una marca de hace semanas. */
export const PENDIENTE_CADUCA_MS = 14 * 24 * 60 * 60 * 1000;

/** Prefijo de lo pendiente en el navegador: por clínica (de la sesión) y paciente; cada pestaña añade `:<pestaña>`. */
export function pendienteKey(clinicId: string, patientId: string): string {
  return `dc:odo-pendiente:${clinicId}:${patientId}`;
}

function esOpValida(o: unknown): o is SaveOp {
  const op = o as Record<string, unknown> | null;
  if (!op || typeof op !== "object") return false;
  if (op.kind === "reset") return true;
  if (typeof op.toothNumber !== "number" || !Number.isInteger(op.toothNumber)) return false;
  if (op.kind === "note") return typeof op.text === "string";
  return (op.kind === "put" || op.kind === "delete")
    && typeof op.conditionId === "string"
    && (op.surface === null || typeof op.surface === "string");
}

export function opKey(op: SaveOp): string {
  if (op.kind === "reset") return "reset";
  if (op.kind === "note") return `n:${op.toothNumber}`;
  return `f:${op.toothNumber}:${op.surface ?? "-"}:${op.conditionId}`;
}

/** ¿Vale la pena reintentar? Sin respuesta, tiempo agotado, demasiadas peticiones o fallo del servidor. */
export function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status !== "number") return true;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "No se pudo guardar";
}

export class SaveQueue {
  private queue: SaveOp[] = [];
  private inflight: SaveOp | null = null;
  /** lo que el servidor rechazó (4xx): no se reintenta solo ni detiene a lo demás */
  private failed: SaveOp[] = [];
  private failError: string | undefined;
  private transientError: string | undefined;
  private noteDrafts = new Map<number, string>();
  private noteTimers = new Map<number, unknown>();
  private retryTimer: unknown = null;
  private attempt = 0;
  private version = 0;
  private touched = false;
  private status: SaveStatus = { state: "idle", pending: 0 };
  private listeners = new Set<(s: SaveStatus) => void>();
  private readonly send: SendFn;
  private readonly noteDelay: number;
  private readonly retryDelays: number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private readonly now: () => number;
  private store: KeyValueStore | null = null;
  private storeKey: string | null = null;
  private attachedCount = 0;
  private lastFailStatus: number | null = null;

  constructor(opts: QueueOptions) {
    this.send = opts.send;
    this.noteDelay = opts.noteDelay ?? 1500;
    this.retryDelays = opts.retryDelays ?? [1000, 3000, 8000, 20000, 30000];
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => Date.now());
  }

  /* ---------------- copia en el navegador (O1) ---------------- */
  /**
   * Engancha el almacenamiento del navegador y recupera lo que quedó
   * pendiente la última vez (cerrado sin red, pestaña muerta…): lo vuelve a
   * encolar, y sale solo. Devuelve cuántas escrituras recuperó.
   */
  bindStorage(store: KeyValueStore | null, prefix: string, tabId: string = TAB_ID): number {
    const own = `${prefix}:${tabId}`;
    if (!store || this.storeKey === own) return 0;
    this.store = store;
    this.storeKey = own;
    // Copias de otras cargas de la página (esta pestaña antes de cerrarse, u
    // otra pestaña): esta cola se hace cargo de ellas y las borra; si la otra
    // pestaña sigue viva, su próxima copia la vuelve a escribir.
    const ajenas: string[] = [];
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k !== own && (k === prefix || k.startsWith(`${prefix}:`))) ajenas.push(k);
      }
    } catch { /* bloqueado */ }
    const pendientes = new Set(this.pendingOps().map(opKey));
    let restored = 0;
    for (const k of ajenas) {
      let ops: SaveOp[] = [];
      try {
        const d = JSON.parse(store.getItem(k) ?? "null");
        if (d && d.v === 1 && Array.isArray(d.ops) && typeof d.savedAt === "number" && this.now() - d.savedAt < PENDIENTE_CADUCA_MS) {
          ops = d.ops.filter(esOpValida);
        }
        store.removeItem(k);
      } catch { /* corrupto: se ignora */ }
      // en orden (un «limpiar todo» guardado borra lo de antes, como pasó en
      // pantalla); lo que esta cola ya tiene pendiente de lo mismo es más nuevo
      for (const op of ops) {
        if (pendientes.has(opKey(op))) continue;
        this.enqueue(op);
        restored++;
      }
    }
    this.persist();
    return restored;
  }

  /** Todo lo que aún no está confirmado, en orden, con la nota a medias como nota. */
  private pendingOps(): SaveOp[] {
    const notes: SaveOp[] = [...this.noteDrafts].map(([toothNumber, text]) => ({ kind: "note", toothNumber, text }));
    return [...(this.inflight ? [this.inflight] : []), ...this.failed, ...this.queue, ...notes];
  }

  /** Escribe (o borra) la copia del navegador. Nunca lanza. */
  persist() {
    if (!this.store || !this.storeKey) return;
    try {
      const ops = this.pendingOps();
      if (!ops.length) this.store.removeItem(this.storeKey);
      else this.store.setItem(this.storeKey, JSON.stringify({ v: 1, savedAt: this.now(), ops }));
    } catch { /* lleno o bloqueado: queda la cola en memoria */ }
  }

  /** El odontograma de este paciente está en pantalla (su indicador ya avisa). */
  attach(): () => void {
    this.attachedCount++;
    this.refresh();
    let done = false;
    return () => { if (!done) { done = true; this.attachedCount--; this.refresh(); } };
  }

  isAttached(): boolean { return this.attachedCount > 0; }

  /** ¿Lo último que falló fue la sesión vencida? (al volver a la pestaña se reintenta) */
  failedBySession(): boolean { return this.failed.length > 0 && this.lastFailStatus === 401; }

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

  /** ¿Queda algo sin confirmar (en cola, en vuelo, tecleándose o rechazado)? */
  hasPending(): boolean {
    return this.queue.length > 0 || this.inflight !== null || this.noteDrafts.size > 0 || this.failed.length > 0;
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
    else state = this.touched ? "saved" : "idle";
    this.status = {
      state, error,
      pending: this.queue.length + (this.inflight ? 1 : 0) + this.noteDrafts.size + this.failed.length,
    };
    this.persist();
    this.listeners.forEach((fn) => fn(this.status));
  }

  /* ---------------- entrada ---------------- */
  /** Encola una escritura. Si había otra de lo mismo esperando (o rechazada), la sustituye. */
  enqueue(op: SaveOp) {
    this.touched = true;
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
    this.refresh();
    this.pump();
  }

  /** La nota de un diente cambió al teclear: se guarda sola tras una pausa. */
  noteChanged(toothNumber: number, text: string) {
    this.touched = true;
    this.noteDrafts.set(toothNumber, text);
    const prev = this.noteTimers.get(toothNumber);
    if (prev !== undefined) this.clearTimer(prev);
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
   * La página se cierra: una copia de lo pendiente sale ya con keepalive (no
   * da tiempo a ir de una en una). La cola NO se vacía: si la página vuelve
   * (bfcache), sigue mandando lo suyo, y repetir es inocuo (idempotente).
   */
  flushForUnload() {
    this.flush();
    // lo que va en vuelo puede no llegar si la página muere: se repite, salvo
    // que detrás espere otra de lo mismo (mandarlas en paralelo podría
    // invertirlas; la de detrás es la buena)
    // (ni tras un «limpiar todo» en cola: lo de antes ya no cuenta)
    const repeatInflight = this.inflight
      && !this.queue.some((q) => q.kind === "reset" || opKey(q) === opKey(this.inflight!));
    const ops = repeatInflight ? [this.inflight!, ...this.queue] : [...this.queue];
    const fire = (list: SaveOp[]) => list.forEach((op) => { this.send(op, { keepalive: true }).catch(() => {}); });
    // «limpiar todo» va primero y lo demás detrás: en paralelo podría borrarlo
    const r = ops.findIndex((op) => op.kind === "reset");
    if (r < 0) fire(ops);
    else this.send(ops[r], { keepalive: true }).then(() => fire(ops.filter((_, i) => i !== r)), () => {});
  }

  /** «Reintentar»: lo rechazado vuelve a la cola y no se espera a la próxima vuelta automática. */
  retryNow() {
    if (this.retryTimer !== null) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
    this.attempt = 0;
    this.queue = [...this.failed, ...this.queue];
    this.failed = [];
    this.failError = undefined;
    this.refresh();
    this.pump();
  }

  /** «Descartar»: tira lo que el servidor rechazó (el llamador recarga del servidor). */
  discard() {
    this.failed = [];
    this.failError = undefined;
    this.refresh();
  }

  /**
   * Pinta lo pendiente encima de lo que devolvió el servidor: al volver a
   * montar el odontograma con escrituras sin confirmar (o rechazadas y aún sin
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
    this.inflight = op;
    this.send(op, { keepalive: false }).then(
      () => {
        this.inflight = null;
        this.attempt = 0;
        this.transientError = undefined;
        this.lastFailStatus = null;
        this.refresh();
        this.pump();
      },
      (err) => {
        this.inflight = null;
        // si mientras tanto llegó otra de lo mismo, esa manda y esta sobra
        const superseded = op.kind !== "reset" && this.queue.some((q) => opKey(q) === opKey(op));
        const status = (err as { status?: unknown })?.status;
        this.lastFailStatus = typeof status === "number" ? status : null;
        if (!isTransient(err)) {
          // el servidor dijo que no: repetirla igual no sirve. Se aparta, se
          // avisa, y lo demás sigue guardándose (no se queda como rehén)
          if (!superseded) this.failed.push(op);
          this.failError = errorMessage(err);
          this.refresh();
          this.pump();
          return;
        }
        if (!superseded) this.queue.unshift(op);
        const delay = this.retryDelays[Math.min(this.attempt, this.retryDelays.length - 1)];
        this.attempt++;
        this.transientError = errorMessage(err);
        this.retryTimer = this.setTimer(() => { this.retryTimer = null; this.refresh(); this.pump(); }, delay);
        this.refresh();
      },
    );
  }
}

/** La última clínica de la sesión vista en este navegador: sirve de llave si se abre sin red. */
export const ULTIMA_CLINICA = "dc:odo-ultima-clinica";

/** Engancha la copia de lo pendiente (tras leer del servidor la clínica de la sesión). */
export function bindBrowserCopy(queue: SaveQueue, store: KeyValueStore | null, clinicId: string, patientId: string, tabId?: string): number {
  try { store?.setItem(ULTIMA_CLINICA, clinicId); } catch { /* lleno o bloqueado */ }
  return queue.bindStorage(store, pendienteKey(clinicId, patientId), tabId);
}

/** Sin red al abrir: se engancha con la última clínica conocida para no perder lo que se marque. */
export function bindBrowserCopyOffline(queue: SaveQueue, store: KeyValueStore | null, patientId: string, tabId?: string): number {
  let clinicId: string | null = null;
  try { clinicId = store?.getItem(ULTIMA_CLINICA) ?? null; } catch { /* bloqueado */ }
  return clinicId ? queue.bindStorage(store, pendienteKey(clinicId, patientId), tabId) : 0;
}

/* Una cola por paciente y por pestaña: sobrevive a que el odontograma se desmonte. */
const queues = new Map<string, SaveQueue>();

export function saveQueueFor(patientId: string, make: () => SaveQueue): SaveQueue {
  let q = queues.get(patientId);
  if (!q) {
    q = make();
    queues.set(patientId, q);
    q.subscribe(() => scheduleNotice());
    if (typeof window !== "undefined" && typeof document !== "undefined") installPageHandlers(window, document);
  }
  return q;
}

/** Solo pruebas: vacía el registro de colas. */
export function _resetQueuesForTests() { queues.clear(); handlersInstalled = null; }

/* ---------------- avisos de la página (O1) ----------------
   Viven con las colas, no con el componente: siguen activos aunque el
   odontograma se haya desmontado (otra pestaña de la ficha). */
interface PageTarget {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}
interface DocTarget extends PageTarget { visibilityState: string }

let handlersInstalled: (() => void) | null = null;

export function installPageHandlers(win: PageTarget, doc: DocTarget): () => void {
  if (handlersInstalled) return handlersInstalled;
  const all = () => [...queues.values()];
  // la pestaña se oculta (cambiar de app en iPad, bloquear el teléfono): en iOS
  // puede ser el último aviso antes de que la maten → copia al navegador ya
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") all().forEach((q) => { q.flush(); q.persist(); });
    else all().forEach((q) => { if (q.failedBySession()) q.retryNow(); });
  };
  // la página se va: copia al navegador y, por si hay red, sale con keepalive
  const onPageHide = () => all().forEach((q) => { q.flush(); q.persist(); q.flushForUnload(); });
  // cerrar o recargar en escritorio: el navegador pregunta si queda algo
  const onBeforeUnload = (e: Event) => {
    const qs = all();
    qs.forEach((q) => { q.flush(); q.persist(); });
    if (!qs.some((q) => q.hasPending())) return;
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = "";
  };
  const onOnline = () => all().forEach((q) => q.retryNow());
  // volver a la pestaña tras iniciar sesión en otra: lo que falló por 401 sale
  const onFocus = () => all().forEach((q) => { if (q.failedBySession()) q.retryNow(); });
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

/* ---------------- aviso fijo «sin guardar» (O1) ----------------
   Cuando el odontograma de un paciente con algo pendiente ya no está en
   pantalla, su indicador no se ve: este aviso, fuera de React y pegado al
   <body>, sí. Desaparece en cuanto todo se confirma o se vuelve a abrir. */
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
  const fuera = qs.filter((q) => !q.isAttached() && q.hasPending());
  if (!fuera.length) return null;
  const n = fuera.reduce((acc, q) => acc + q.getStatus().pending, 0);
  const cambios = n === 1 ? "1 cambio" : `${n} cambios`;
  const err = fuera.find((q) => q.getStatus().state === "error");
  if (err) return `Odontograma: ${cambios} sin guardar. ${err.getStatus().error ?? "El servidor no lo aceptó."}`;
  if (fuera.some((q) => q.getStatus().state === "retrying")) {
    return `Odontograma: ${cambios} sin guardar (sin conexión). Se reintenta solo y queda guardado en este navegador.`;
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
    btn.addEventListener("click", () => getQs().forEach((q) => q.retryNow()));
    el.appendChild(btn);
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
