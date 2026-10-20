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
  /** `prev`: la nota tal como estaba antes de que el doctor la tocara (para no pisar una nota más nueva al recuperar) */
  | { kind: "note"; toothNumber: number; text: string; prev?: string }
  | { kind: "reset" };

export type SaveState = "idle" | "saving" | "saved" | "retrying" | "error" | "discarded";

export interface SaveStatus {
  state: SaveState;
  /** escrituras que faltan por confirmar (incluida la nota que se está tecleando) */
  pending: number;
  /** mensaje del último fallo (retrying / error / discarded) */
  error?: string;
  /** cuántas escrituras descartó el servidor (403/404) desde que se creó la cola */
  discarded: number;
  /** cambios de una sesión anterior de ESTE usuario en este navegador, esperando «Guardar / Descartar» */
  recovered: { count: number; at: number } | null;
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
  /** ¿Quién tiene la sesión ahora? (userId) — antes de reintentar lo que falló por 401 */
  whoAmI?: () => Promise<string | null>;
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

/**
 * Lo pendiente guardado en el navegador caduca a las 48 h de hecho cada
 * cambio (revisión t8, N-O4): pasado eso no se ofrece recuperarlo y la copia se
 * borra del disco, sea del paciente que sea.
 */
export const PENDIENTE_CADUCA_MS = 48 * 60 * 60 * 1000;

/** Todas las copias empiezan así (el barrido de caducadas las busca por este prefijo). */
export const PENDIENTE_PREFIJO = "dc:odo-pendiente:";

/**
 * Prefijo de lo pendiente de un paciente: por clínica y USUARIO de la SESIÓN
 * (revisión t8, N-O1 y N-O3); cada pestaña añade `:<pestaña>`. Otro usuario en
 * el mismo navegador tiene otra llave: nunca ve ni manda lo de este.
 */
export function pendienteKey(clinicId: string, userId: string, patientId: string): string {
  return `${PENDIENTE_PREFIJO}v2:${clinicId}:${userId}:${patientId}`;
}

/** Una escritura guardada en la copia, con cuándo la hizo el doctor. */
export interface OpGuardada { op: SaveOp; at: number }

function esOpValida(o: unknown): o is SaveOp {
  const op = o as Record<string, unknown> | null;
  if (!op || typeof op !== "object") return false;
  if (op.kind === "reset") return true;
  if (typeof op.toothNumber !== "number" || !Number.isInteger(op.toothNumber)) return false;
  if (op.kind === "note") return typeof op.text === "string" && (op.prev === undefined || typeof op.prev === "string");
  return (op.kind === "put" || op.kind === "delete")
    && typeof op.conditionId === "string"
    && (op.surface === null || typeof op.surface === "string");
}

/** Lee una copia; null si está corrupta o no es del formato actual. */
function leerCopia(raw: string | null): { savedAt: number; ops: OpGuardada[] } | null {
  try {
    const d = JSON.parse(raw ?? "null");
    if (!d || d.v !== 2 || typeof d.savedAt !== "number" || !Array.isArray(d.ops)) return null;
    const ops = (d.ops as unknown[]).filter((x): x is OpGuardada => {
      const g = x as OpGuardada;
      return !!g && typeof g.at === "number" && esOpValida(g.op);
    });
    return ops.length === d.ops.length ? { savedAt: d.savedAt, ops } : null;
  } catch {
    return null;
  }
}

/**
 * Barre TODAS las copias de lo pendiente del navegador (de cualquier paciente,
 * usuario o clínica): borra las corruptas o de un formato viejo y quita los
 * cambios de más de 48 h; si no queda nada, borra la copia (revisión t8,
 * N-O4). Devuelve cuántas copias borró. Nunca lanza.
 */
export function sweepPendientes(store: KeyValueStore | null, now: number): number {
  if (!store) return 0;
  let borradas = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PENDIENTE_PREFIJO)) keys.push(k);
    }
    for (const k of keys) {
      const c = leerCopia(store.getItem(k));
      const vivos = c ? c.ops.filter((g) => now - g.at < PENDIENTE_CADUCA_MS) : [];
      if (!c || !vivos.length) { store.removeItem(k); borradas++; continue; }
      if (vivos.length !== c.ops.length) store.setItem(k, JSON.stringify({ v: 2, savedAt: c.savedAt, ops: vivos }));
    }
  } catch { /* bloqueado */ }
  return borradas;
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
  private status: SaveStatus = { state: "idle", pending: 0, discarded: 0, recovered: null };
  private listeners = new Set<(s: SaveStatus) => void>();
  private readonly send: SendFn;
  private readonly noteDelay: number;
  private readonly retryDelays: number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private readonly now: () => number;
  private store: KeyValueStore | null = null;
  private storeKey: string | null = null;
  private storePrefix: string | null = null;
  private ownerUser: string | null = null;
  private attachedCount = 0;
  private lastFailStatus: number | null = null;
  /** cuándo hizo el doctor cada escritura pendiente (por opKey) — viaja en la copia */
  private opAt = new Map<string, number>();
  /** la nota antes de empezar a teclear, por diente */
  private noteBase = new Map<number, string>();
  private discardedCount = 0;
  private discardError: string | undefined;
  /** copias de una carga anterior (o de otra pestaña) de este usuario: esperan «Guardar / Descartar» */
  private recovered: OpGuardada[] = [];
  private recoveredKeys: string[] = [];
  private readonly whoAmI: (() => Promise<string | null>) | null;

  constructor(opts: QueueOptions) {
    this.send = opts.send;
    this.noteDelay = opts.noteDelay ?? 1500;
    this.retryDelays = opts.retryDelays ?? [1000, 3000, 8000, 20000, 30000];
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.now = opts.now ?? (() => Date.now());
    this.whoAmI = opts.whoAmI ?? null;
  }

  /* ---------------- copia en el navegador (O1, revisión t8) ---------------- */
  /**
   * Engancha la copia del navegador con la llave de la SESIÓN (clínica +
   * usuario + paciente). Lo que quedó de una carga anterior de ESTE usuario
   * NO se manda solo (revisión t8, N-O2): queda en `recovered` y la pantalla
   * pregunta «Guardar / Descartar». Si la cola estaba enganchada a OTRA sesión
   * (otro usuario o clínica en la misma pestaña), lo de esa sesión se deja en
   * su copia —sin mandarlo con la sesión nueva— y la cola empieza vacía.
   * Devuelve cuántos cambios recuperables encontró.
   */
  bindStorage(store: KeyValueStore | null, prefix: string, userId: string, tabId: string = TAB_ID): number {
    if (!store) return 0;
    const own = `${prefix}:${tabId}`;
    if (this.storeKey === own) return this.recovered.length;
    if (this.storePrefix && this.storePrefix !== prefix) this.abandonarSesion();
    this.store = store;
    this.storeKey = own;
    this.storePrefix = prefix;
    this.ownerUser = userId;
    sweepPendientes(store, this.now());
    const ajenas: string[] = [];
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k !== own && k.startsWith(`${prefix}:`)) ajenas.push(k);
      }
    } catch { /* bloqueado */ }
    const recuperadas: OpGuardada[] = [];
    for (const k of ajenas) {
      const c = leerCopia(store.getItem(k));
      if (!c) continue;
      recuperadas.push(...c.ops.filter((g) => this.now() - g.at < PENDIENTE_CADUCA_MS));
      this.recoveredKeys.push(k);
    }
    // por fecha del cambio, no por el orden de las llaves
    this.recovered = recuperadas.sort((x, y) => x.at - y.at);
    this.persist();
    this.refresh();
    return this.recovered.length;
  }

  /** La pestaña cambió de sesión: lo de la anterior se queda en su copia y no se manda. */
  private abandonarSesion() {
    this.persist();
    this.noteTimers.forEach((id) => this.clearTimer(id));
    this.noteTimers.clear();
    this.noteDrafts.clear();
    this.noteBase.clear();
    this.queue = [];
    this.failed = [];
    this.opAt.clear();
    this.recovered = [];
    this.recoveredKeys = [];
    if (this.retryTimer !== null) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
    this.store = null; this.storeKey = null; this.storePrefix = null; this.ownerUser = null;
  }

  /** Lo recuperado de una carga anterior (en orden de fecha). */
  getRecovered(): OpGuardada[] { return [...this.recovered]; }

  /** «Descartar» lo recuperado: se borra del navegador y no se manda. */
  discardRecovered() {
    try { this.recoveredKeys.forEach((k) => this.store?.removeItem(k)); } catch { /* bloqueado */ }
    this.recovered = [];
    this.recoveredKeys = [];
    this.refresh();
  }

  /**
   * «Guardar» lo recuperado: encola lo que `planRecovery` decidió aplicar
   * sobre lo que hay HOY (ya no es una repetición ciega) y suelta las copias
   * viejas — lo encolado vive ya en la copia propia.
   */
  applyRecovered(ops: SaveOp[]) {
    ops.forEach((op) => this.enqueue(op));
    this.discardRecovered();
  }

  /** Todo lo que aún no está confirmado, en orden, con la nota a medias como nota. */
  private pendingOps(): OpGuardada[] {
    const at = (op: SaveOp) => this.opAt.get(opKey(op)) ?? this.now();
    const notes: OpGuardada[] = [...this.noteDrafts].map(([toothNumber, text]) => {
      const op: SaveOp = { kind: "note", toothNumber, text, prev: this.noteBase.get(toothNumber) };
      return { op, at: at(op) };
    });
    return [...(this.inflight ? [this.inflight] : []), ...this.failed, ...this.queue]
      .map((op) => ({ op, at: at(op) }))
      .concat(notes);
  }

  /** Escribe (o borra) la copia del navegador. Nunca lanza. */
  persist() {
    if (!this.store || !this.storeKey) return;
    try {
      const ops = this.pendingOps();
      if (!ops.length) this.store.removeItem(this.storeKey);
      else this.store.setItem(this.storeKey, JSON.stringify({ v: 2, savedAt: this.now(), ops }));
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

  /**
   * Tras un 401: al volver a la pestaña se reintenta, pero SOLO si la sesión
   * que hay ahora es del mismo usuario (revisión t8, N-O1). Si entró otro, lo
   * pendiente se queda en la copia del dueño y no se manda.
   */
  async retryAfterSession(): Promise<boolean> {
    if (!this.failedBySession()) return false;
    if (this.whoAmI) {
      const quien = await this.whoAmI().catch(() => null);
      if (!quien || (this.ownerUser && quien !== this.ownerUser)) return false;
    }
    this.retryNow();
    return true;
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
    else if (this.discardError) { state = "discarded"; error = this.discardError; }
    else state = this.touched ? "saved" : "idle";
    const last = this.recovered.length ? this.recovered[this.recovered.length - 1].at : 0;
    this.status = {
      state, error,
      pending: this.queue.length + (this.inflight ? 1 : 0) + this.noteDrafts.size + this.failed.length,
      discarded: this.discardedCount,
      recovered: this.recovered.length ? { count: this.recovered.length, at: last } : null,
    };
    this.persist();
    this.listeners.forEach((fn) => fn(this.status));
  }

  /* ---------------- entrada ---------------- */
  /** Encola una escritura. Si había otra de lo mismo esperando (o rechazada), la sustituye. */
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
      this.noteBase.clear();
    } else if (op.kind === "note") {
      // una nota firme sustituye a la que se estaba tecleando de ese diente;
      // conserva la nota de ANTES de la primera tecla (o de la nota que sustituye)
      const t = this.noteTimers.get(op.toothNumber);
      if (t !== undefined) this.clearTimer(t);
      this.noteTimers.delete(op.toothNumber);
      this.noteDrafts.delete(op.toothNumber);
      const diente = op.toothNumber;
      const anterior = [...this.queue, ...this.failed].find((q) => q.kind === "note" && q.toothNumber === diente) as
        { prev?: string } | undefined;
      const prev = anterior?.prev ?? this.noteBase.get(op.toothNumber) ?? op.prev;
      this.noteBase.delete(op.toothNumber);
      op = prev === undefined ? op : { ...op, prev };
    }
    const k = opKey(op);
    this.opAt.set(k, this.now());
    this.queue = this.queue.filter((q) => opKey(q) !== k);
    this.failed = this.failed.filter((q) => opKey(q) !== k);
    this.queue.push(op);
    this.refresh();
    this.pump();
  }

  /** La nota de un diente cambió al teclear: se guarda sola tras una pausa. */
  noteChanged(toothNumber: number, text: string, prev?: string) {
    this.touched = true;
    this.discardError = undefined;
    if (!this.noteBase.has(toothNumber) && prev !== undefined) this.noteBase.set(toothNumber, prev);
    this.noteDrafts.set(toothNumber, text);
    this.opAt.set(`n:${toothNumber}`, this.now());
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
    const prev = this.noteBase.get(toothNumber);
    this.enqueue(prev === undefined ? { kind: "note", toothNumber, text } : { kind: "note", toothNumber, text, prev });
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
    this.failed.forEach((op) => this.opAt.delete(opKey(op)));
    this.failed = [];
    this.failError = undefined;
    this.discardError = undefined;
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
        if (!this.queue.some((q) => opKey(q) === opKey(op))) this.opAt.delete(opKey(op));
        this.refresh();
        this.pump();
      },
      (err) => {
        this.inflight = null;
        // si mientras tanto llegó otra de lo mismo, esa manda y esta sobra
        const superseded = op.kind !== "reset" && this.queue.some((q) => opKey(q) === opKey(op));
        const status = (err as { status?: unknown })?.status;
        this.lastFailStatus = typeof status === "number" ? status : null;
        if (status === 403 || status === 404) {
          // Sin permiso o paciente que no es de esta clínica (revisión t8,
          // N-O5): reintentarlo no lo arreglará nunca. Se descarta —no queda en
          // la copia ni vuelve al abrir— y se dice; la pantalla recarga del
          // servidor para enseñar lo que de verdad hay.
          if (!superseded) this.opAt.delete(opKey(op));
          this.discardedCount++;
          this.discardError = `${errorMessage(err)} Ese cambio se descartó.`;
          this.refresh();
          this.pump();
          return;
        }
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

/**
 * Engancha la copia de lo pendiente con la SESIÓN: clínica y usuario de quien
 * tiene la sesión ahora (los manda la página desde el servidor, o los devuelve
 * el GET). Nunca «la última clínica conocida» del navegador (revisión t8, N-O3).
 */
export function bindBrowserCopy(
  queue: SaveQueue, store: KeyValueStore | null, sesion: { clinicId: string; userId: string }, patientId: string, tabId?: string,
): number {
  return queue.bindStorage(store, pendienteKey(sesion.clinicId, sesion.userId, patientId), sesion.userId, tabId);
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
    else all().forEach((q) => { void q.retryAfterSession(); });
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
  const onFocus = () => all().forEach((q) => { void q.retryAfterSession(); });
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
    // lo que el servidor rechazó (400, sesión vencida) se puede tirar desde aquí
    const tirar = doc.createElement("button");
    tirar.setAttribute("type", "button");
    tirar.setAttribute("data-descartar", "1");
    tirar.textContent = "Descartar";
    Object.assign(tirar.style, btn.style);
    tirar.addEventListener("click", () => getQs().forEach((q) => { if (!q.isAttached()) q.discard(); }));
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
