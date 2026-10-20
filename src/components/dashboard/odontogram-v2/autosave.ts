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
     que diga el servidor.

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

  constructor(opts: QueueOptions) {
    this.send = opts.send;
    this.noteDelay = opts.noteDelay ?? 1500;
    this.retryDelays = opts.retryDelays ?? [1000, 3000, 8000, 20000, 30000];
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

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
        this.refresh();
        this.pump();
      },
      (err) => {
        this.inflight = null;
        // si mientras tanto llegó otra de lo mismo, esa manda y esta sobra
        const superseded = op.kind !== "reset" && this.queue.some((q) => opKey(q) === opKey(op));
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

/* Una cola por paciente y por pestaña: sobrevive a que el odontograma se desmonte. */
const queues = new Map<string, SaveQueue>();

export function saveQueueFor(patientId: string, make: () => SaveQueue): SaveQueue {
  let q = queues.get(patientId);
  if (!q) { q = make(); queues.set(patientId, q); }
  return q;
}
