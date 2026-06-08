/* ============================================================
   Odontograma v2 — ADAPTER
   Bridges the real /api/odontogram (extended by WS3-T1 to carry
   `conditionId`) with the records shape consumed by the UI.
   Build-time safe: these are plain fetch calls; they compile and run
   regardless of whether the extended fields are live yet.
   ============================================================ */
import type { Records, ToothRecord } from "./types";

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

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await safeJson<{ error?: string; reason?: string; hint?: string }>(res);
  if (data?.error) return data.hint ? `${data.error} — ${data.hint}` : data.error;
  if (data?.reason) return String(data.reason);
  return `${fallback} (HTTP ${res.status})`;
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
    if (e.surface != null) {
      if (!rec.surfaces[e.surface]) rec.surfaces[e.surface] = [];
      if (!rec.surfaces[e.surface].includes(e.conditionId)) {
        rec.surfaces[e.surface].push(e.conditionId);
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
  const res = await fetch(`${BASE}?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "No se pudo cargar el odontograma"));
  const data = await safeJson<{ entries: OdontogramEntry[]; notes?: Record<string, string> }>(res);
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
  return records;
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

/** Add / upsert a condition (or a note via NOTE_CONDITION_ID). */
export async function putFinding(args: PutArgs): Promise<void> {
  const res = await fetch(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: args.patientId,
      toothNumber: args.toothNumber,
      surface: args.surface ?? null,
      conditionId: args.conditionId,
      notes: args.notes ?? null,
    }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "No se pudo guardar el hallazgo"));
}

export interface DeleteArgs {
  patientId: string;
  toothNumber: number;
  surface?: string | null;
  conditionId: string;
}

/** Remove a single condition (or a note via NOTE_CONDITION_ID). */
export async function deleteFinding(args: DeleteArgs): Promise<void> {
  const res = await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: args.patientId,
      toothNumber: args.toothNumber,
      surface: args.surface ?? null,
      conditionId: args.conditionId,
    }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "No se pudo quitar el hallazgo"));
}

/**
 * Persist (or clear) the per-tooth clinical note via the DEDICATED endpoint.
 * PUT /api/odontogram/note — an empty / whitespace-only note clears it
 * (the API treats empty as a delete). The main PUT rejects "__note__".
 */
export async function setNote(patientId: string, toothNumber: number, text: string): Promise<void> {
  const res = await fetch(`${BASE}/note`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, toothNumber, note: text ?? "" }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "No se pudo guardar la nota"));
}

/** Clear the entire chart for a patient (POST /api/odontogram/reset). */
export async function resetOdontogram(patientId: string): Promise<void> {
  const res = await fetch(`${BASE}/reset?patientId=${encodeURIComponent(patientId)}`, { method: "POST" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "No se pudo limpiar el odontograma"));
}
