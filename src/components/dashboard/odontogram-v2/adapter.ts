/* ============================================================
   Odontograma v2 — ADAPTER
   Bridges the real /api/odontogram (extended by WS3-T1 to carry
   `conditionId`) with the records shape consumed by the UI.
   Build-time safe: these are plain fetch calls; they compile and run
   regardless of whether the extended fields are live yet.
   ============================================================ */
import type { Records, ToothRecord } from "./types";
import { classify, SURFACE_NAMES } from "./data";

/* ---------- la cara incisal ----------
   La pantalla llama «I» (Incisal) al centro de los anteriores y «O» al de los
   posteriores; la base solo conoce M | D | V | L | O (el enum de la API y el
   importador, que ya guarda «incisal» como «O»). Hasta ws1-t11 la «I» viajaba
   tal cual: la API la rechazaba con 400 y el hallazgo incisal nunca se
   guardaba (en vivo se revertía sin aviso; en «Guardar consulta» tumbaba la
   sincronización entera). Se traduce aquí, en la frontera: la base sigue con
   sus cinco letras y la pantalla con las suyas. */
export function toServerSurface(surface: string | null | undefined): string | null {
  if (surface == null) return null;
  return surface === "I" ? "O" : surface;
}
export function fromServerSurface(toothNumber: number, surface: string | null): string | null {
  if (surface === "O" && !classify(toothNumber).posterior) return "I";
  return surface;
}

/** Nombre de la cara tal como está en la base, para mostrar: «O» de un anterior es «Incisal». */
export function rotuloCara(toothNumber: number | null | undefined, surface: string | null | undefined): string | null {
  if (!surface) return null;
  const letter = toothNumber ? fromServerSurface(toothNumber, surface) ?? surface : surface;
  return SURFACE_NAMES[letter as keyof typeof SURFACE_NAMES]?.es ?? surface;
}

const BASE = "/api/odontogram";

/** Sentinel conditionId used to persist a per-tooth clinical note. */
export const NOTE_CONDITION_ID = "__note__";

/**
 * Server entry — the EXTENDED shape (WS3-T1 adds `conditionId`).
 * One condition per (toothNumber, surface) row; notes ride the "__note__" row.
 */
export interface OdontogramEntry {
  id?: string;
  toothNumber: number;
  surface: string | null;
  conditionId: string;
  notes?: string | null;
  updatedAt?: string;
}

/* ---------- robust response reading (never throws on empty/HTML body) ---------- */
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    const raw = await res.text();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Error de una escritura con el código HTTP (0 = no hubo respuesta: sin red,
 * servidor caído, petición cortada). La cola de autoguardado lo usa para
 * decidir si reintentar (0, 408, 429, 5xx) o parar y avisar (resto de 4xx:
 * sin permiso, paciente no encontrado, datos inválidos).
 */
export class OdontogramHttpError extends Error {
  status: number;
  /** código de la respuesta (`forbidden`, `patient_not_found`, `two_factor_required`…), si lo hubo */
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "OdontogramHttpError";
    this.status = status;
    this.code = code;
  }
}

/** Opciones de las escrituras. `keepalive` deja terminar la petición aunque la pestaña se cierre. */
export interface WriteOptions { keepalive?: boolean }

/** Una escritura que no responde en este tiempo se da por perdida y se reintenta (es idempotente). */
const WRITE_TIMEOUT_MS = 20_000;

async function send(url: string, init: RequestInit, opts: WriteOptions | undefined, fallback: string): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WRITE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, keepalive: !!opts?.keepalive, signal: ctl.signal });
  } catch {
    // el texto del navegador («Failed to fetch», «Load failed») no le dice nada a la clínica
    throw new OdontogramHttpError(`${fallback}: ${ctl.signal.aborted ? "el servidor no respondió" : "sin conexión"}`, 0);
  } finally {
    clearTimeout(timer);
  }
  // una redirección seguida (al login) no es un guardado: se trata como sesión vencida
  if (res.redirected) throw new OdontogramHttpError(SESION_VENCIDA, 401, "unauthorized");
  if (!res.ok) throw await httpError(res, fallback);
}

export const SESION_VENCIDA = "Tu sesión venció, vuelve a entrar. Lo que marcaste sigue pendiente en esta pestaña (no la cierres) y se guardará al volver.";

/** Códigos de la API del odontograma → lo que entiende la clínica. */
const MENSAJES: Record<string, string> = {
  unauthorized: SESION_VENCIDA,
  forbidden: "Tu usuario no tiene permiso para editar el odontograma.",
  patient_not_found: "No se encontró al paciente en esta clínica.",
  invalid_payload: "El cambio no es válido y no se pudo guardar.",
  invalid_tooth: "Ese diente no existe en el odontograma.",
  payload_too_large: "Son demasiados hallazgos para guardarlos de una vez.",
  missing_patientId: "Falta el paciente.",
  schema_not_migrated: "El odontograma no está disponible en este servidor; avisa a soporte.",
  internal_error: "Falló el servidor.",
};

/** La respuesta de error, en español y con su código (la cola decide con él). */
async function httpError(res: Response, fallback: string): Promise<OdontogramHttpError> {
  if (res.status === 401) return new OdontogramHttpError(SESION_VENCIDA, 401, "unauthorized");
  const data = await safeJson<{ error?: string; code?: string }>(res);
  const code = data?.error ?? "";
  if (MENSAJES[code]) return new OdontogramHttpError(`${fallback}: ${MENSAJES[code]}`, res.status, code);
  // el 403 del reto 2FA (middleware) ya trae su texto en español y un `code` propio
  if (data?.code && data.error) return new OdontogramHttpError(data.error, res.status, data.code);
  if (res.status >= 500) return new OdontogramHttpError(`${fallback}: falló el servidor (${res.status}).`, res.status, code || null);
  return new OdontogramHttpError(`${fallback} (error ${res.status}).`, res.status, code || null);
}

/* ============================================================
   entriesToRecords — flat server entries → records map
   - conditionId === "__note__"  → records[fdi].note
   - surface != null             → records[fdi].surfaces[surface] includes id
   - surface == null             → records[fdi].tooth includes id
   ============================================================ */
export function entriesToRecords(entries: OdontogramEntry[]): Records {
  const records: Records = {};
  for (const e of entries) {
    const fdi = e.toothNumber;
    if (!records[fdi]) records[fdi] = { surfaces: {}, tooth: [] };
    const rec: ToothRecord = records[fdi];

    if (e.conditionId === NOTE_CONDITION_ID) {
      rec.note = e.notes ?? "";
      continue;
    }
    const surface = fromServerSurface(fdi, e.surface);
    if (surface != null) {
      if (!rec.surfaces[surface]) rec.surfaces[surface] = [];
      if (!rec.surfaces[surface].includes(e.conditionId)) {
        rec.surfaces[surface].push(e.conditionId);
      }
    } else if (!rec.tooth.includes(e.conditionId)) {
      rec.tooth.push(e.conditionId);
    }
  }
  return records;
}

/* ============================================================
   READ
   ============================================================ */
export async function fetchRecords(patientId: string): Promise<Records> {
  return (await fetchOdontogram(patientId)).records;
}

/** Lo que devuelve la lectura: el odontograma y de quién es la sesión que lo pidió. */
export interface OdontogramRead {
  records: Records;
  /** clínica y usuario de la SESIÓN (no del paciente): de quién es lo pendiente del autoguardado */
  clinicId: string | null;
  userId: string | null;
  /** filas tal cual (letras de la base) */
  entries: OdontogramEntry[];
}

/** Lee el odontograma. Sin red, el error sale en español (revisión t8, O3). */
export async function fetchOdontogram(patientId: string): Promise<OdontogramRead> {
  const fallback = "No se pudo cargar el odontograma";
  let res: Response;
  try {
    res = await fetch(`${BASE}?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
  } catch {
    // el «Failed to fetch» / «Load failed» del navegador no le dice nada a la clínica
    throw new OdontogramHttpError(`${fallback}: sin conexión. Lo que marques se enviará en cuanto vuelva la red; no cierres esta pestaña.`, 0);
  }
  if (res.redirected) throw new OdontogramHttpError(SESION_VENCIDA, 401, "unauthorized");
  if (!res.ok) throw await httpError(res, fallback);
  const data = await safeJson<{
    entries: OdontogramEntry[]; notes?: Record<string, string>;
    clinicId?: string; userId?: string;
  }>(res);
  const records = entriesToRecords(data?.entries ?? []);
  // Per-tooth notes arrive in a SEPARATE `notes` map keyed by toothNumber — the
  // API does NOT return them as "__note__" entries (see WS3-T1 contract).
  const notes = data?.notes ?? {};
  for (const [tooth, note] of Object.entries(notes)) {
    if (!note) continue;
    const fdi = Number(tooth);
    if (!records[fdi]) records[fdi] = { surfaces: {}, tooth: [] };
    records[fdi].note = note;
  }
  return {
    records,
    clinicId: typeof data?.clinicId === "string" ? data.clinicId : null,
    userId: typeof data?.userId === "string" ? data.userId : null,
    entries: data?.entries ?? [],
  };
}

/* ============================================================
   MUTATIONS
   ============================================================ */
export interface PutArgs {
  patientId: string;
  toothNumber: number;
  surface?: string | null;
  conditionId: string;
  notes?: string | null;
}

/** Add / upsert a condition. Idempotente en el servidor: repetirla no duplica. */
export async function putFinding(args: PutArgs, opts?: WriteOptions): Promise<void> {
  await send(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: args.patientId,
      toothNumber: args.toothNumber,
      surface: toServerSurface(args.surface),
      conditionId: args.conditionId,
      notes: args.notes ?? null,
    }),
  }, opts, "No se pudo guardar el hallazgo");
}

export interface DeleteArgs {
  patientId: string;
  toothNumber: number;
  surface?: string | null;
  conditionId: string;
}

/** Remove a single condition. Borrar lo que ya no está no es error (deleted: 0). */
export async function deleteFinding(args: DeleteArgs, opts?: WriteOptions): Promise<void> {
  await send(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: args.patientId,
      toothNumber: args.toothNumber,
      surface: toServerSurface(args.surface),
      conditionId: args.conditionId,
    }),
  }, opts, "No se pudo quitar el hallazgo");
}

/**
 * Persist (or clear) the per-tooth clinical note via the DEDICATED endpoint.
 * PUT /api/odontogram/note — an empty / whitespace-only note clears it
 * (the API treats empty as a delete). The main PUT rejects "__note__".
 */
export async function setNote(patientId: string, toothNumber: number, text: string, opts?: WriteOptions): Promise<void> {
  await send(`${BASE}/note`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, toothNumber, note: text ?? "" }),
  }, opts, "No se pudo guardar la nota");
}

/** Clear the entire chart for a patient (POST /api/odontogram/reset). */
export async function resetOdontogram(patientId: string, opts?: WriteOptions): Promise<void> {
  await send(`${BASE}/reset?patientId=${encodeURIComponent(patientId)}`, { method: "POST" }, opts, "No se pudo limpiar el odontograma");
}

/** Un diente tocado en una consulta: cómo estaba al tocarlo y cómo lo dejó el doctor. */
export interface CambioDiente { base: ToothRecord; now: ToothRecord }

/**
 * «Guardar consulta» (ws1-t11, revisión t4 O4): manda SOLO el cambio de los
 * dientes que el doctor tocó y el servidor lo aplica dentro de su transacción
 * sobre lo que haya en ese momento (POST /api/odontogram/sync con `cambios`).
 * Así no pisa lo que otra pestaña autoguardó, ni siquiera en el mismo diente.
 */
export async function syncCambios(patientId: string, cambios: Record<number, CambioDiente>): Promise<void> {
  const out: Record<number, CambioDiente> = {};
  for (const [fdi, c] of Object.entries(cambios)) {
    const n = Number(fdi);
    const conv = recordsForServer({ [n]: c.base ?? { surfaces: {}, tooth: [] } })[n];
    const conv2 = recordsForServer({ [n]: c.now ?? { surfaces: {}, tooth: [] } })[n];
    out[n] = { base: conv, now: conv2 };
  }
  const res = await fetch(`${BASE}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, cambios: out }),
  });
  if (!res.ok) throw await httpError(res, "No se pudo actualizar el odontograma");
}

/** Las caras con la letra de la base (la «I» de los anteriores viaja como «O»). */
export function recordsForServer(records: Records): Records {
  const out: Records = {};
  for (const [fdi, rec] of Object.entries(records)) {
    const surfaces: Record<string, string[]> = {};
    for (const [letter, ids] of Object.entries(rec.surfaces ?? {})) {
      const key = toServerSurface(letter) as string;
      surfaces[key] = [...new Set([...(surfaces[key] ?? []), ...ids])];
    }
    out[Number(fdi)] = { ...rec, surfaces };
  }
  return out;
}

/**
 * @deprecated Revisión t8 (N-O6): sin uso. El modo `records` de
 * /api/odontogram/sync ya no reemplaza el odontograma (podía borrar lo que otra
 * pestaña autoguardó): hasta el 1-dic-2026 solo AÑADE lo que falta (pestañas
 * con el JS de antes del despliegue) y después responde 410. «Guardar consulta»
 * usa `syncCambios` (solo los dientes tocados). Se deja la función, sin uso.
 */
export async function syncOdontogram(patientId: string, records: Records): Promise<void> {
  const res = await fetch(`${BASE}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, records: recordsForServer(records) }),
  });
  if (!res.ok) throw await httpError(res, "No se pudo sincronizar el odontograma");
}
