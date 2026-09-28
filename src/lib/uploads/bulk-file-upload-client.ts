"use client";

/**
 * Cliente de la subida DIRECTA en BLOQUE de archivos del expediente (paso 2/3
 * de src/app/api/import/patient-files/*). Mismo espíritu que
 * direct-upload-client.ts (PUT por XHR con progreso real, limpieza si algo
 * falla) pero para MUCHOS archivos de MUCHOS pacientes en una sola pasada:
 *
 *   1. POST .../sign     (UN solo POST con todo el lote)
 *   2. PUT  <signedUrl>  (uno por archivo, con concurrencia acotada)
 *   3. POST .../confirm  (UN solo POST con lo que sí se subió)
 *
 * Un archivo que falla NO tumba el lote: cada uno termina con su propio
 * resultado (éxito, duplicado omitido, o error con mensaje).
 */

import {
  MAX_BULK_FILE_BYTES,
  MAX_BULK_FILE_LABEL,
  extOfName,
  isBulkFileExt,
} from "@/lib/uploads/patient-bulk-file-upload";

/** Cuántos PUT concurrentes como máximo — no saturar la conexión del usuario. */
const CONCURRENCIA = 4;

export interface BulkFileInput {
  file: File;
  patientId: string;
  category: string;
}

export interface BulkUploadResult {
  file: File;
  patientId: string;
  ok: boolean;
  id?: string;
  url?: string;
  skippedDuplicate?: boolean;
  error?: string;
  code?: string;
}

export interface BulkUploadOptions {
  /** Se llama cada vez que un archivo TERMINA (éxito, duplicado u error). */
  onItemDone?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

/** PUT del archivo al signed URL, sin progreso por archivo (el lote reporta por CONTEO de archivos, no por bytes). */
function putFile(signedUrl: string, file: File, contentType: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onSignalAbort = () => xhr.abort();
    const done = (fn: () => void) => { signal?.removeEventListener("abort", onSignalAbort); fn(); };

    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return done(resolve);
      done(() => reject(new Error(`La subida falló (${xhr.status})`)));
    };
    xhr.onerror = () => done(() => reject(new Error("Se interrumpió la conexión")));
    xhr.ontimeout = () => done(() => reject(new Error("La subida tardó demasiado")));
    xhr.onabort = () => done(() => reject(new Error("Subida cancelada")));

    if (isAborted(signal)) return done(() => reject(new Error("Subida cancelada")));
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    xhr.send(file);
  });
}

async function conConcurrencia<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * Sube un lote de archivos ya emparejados (paso 1 hecho por quien llama, vía
 * POST /api/import/patient-files/match). Valida de cortesía formato/tamaño
 * antes de gastar una firma en un archivo que de todas formas iba a rebotar.
 */
export async function uploadPatientFilesBulk(
  inputs: BulkFileInput[],
  opts: BulkUploadOptions = {},
): Promise<BulkUploadResult[]> {
  const total = inputs.length;
  if (total === 0) return [];
  const results: BulkUploadResult[] = inputs.map((inp) => ({ file: inp.file, patientId: inp.patientId, ok: false }));
  let doneCount = 0;
  const marcar = () => opts.onItemDone?.(++doneCount, total);

  // Validación de cortesía (el servidor vuelve a validar todo).
  const aptos: number[] = [];
  inputs.forEach((inp, i) => {
    const ext = extOfName(inp.file.name);
    if (!isBulkFileExt(ext)) {
      results[i] = { ...results[i], error: `Formato no permitido (.${ext || "?"})` };
      marcar();
      return;
    }
    if (inp.file.size > MAX_BULK_FILE_BYTES) {
      results[i] = { ...results[i], error: `Pesa más de ${MAX_BULK_FILE_LABEL}`, code: "FILE_TOO_LARGE" };
      marcar();
      return;
    }
    aptos.push(i);
  });
  if (aptos.length === 0) return results;

  const signRes = await fetch("/api/import/patient-files/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: aptos.map((i) => ({
        index: i,
        patientId: inputs[i].patientId,
        name: inputs[i].file.name,
        size: inputs[i].file.size,
        contentType: inputs[i].file.type,
      })),
    }),
  });
  if (!signRes.ok) {
    const j = await signRes.json().catch(() => ({}));
    const msg = String(j?.error ?? "No se pudo preparar la subida");
    for (const i of aptos) { results[i] = { ...results[i], error: msg }; marcar(); }
    return results;
  }
  const signJson = (await signRes.json()) as {
    signed: Array<{ index: number; path: string; token: string; signedUrl: string; contentType: string }>;
    skipped: Array<{ index: number; reason: string }>;
    errors: Array<{ index: number; error: string; code?: string }>;
  };

  for (const s of signJson.skipped) { results[s.index] = { ...results[s.index], ok: true, skippedDuplicate: true }; marcar(); }
  for (const e of signJson.errors) { results[e.index] = { ...results[e.index], error: e.error, code: e.code }; marcar(); }

  if (signJson.signed.length === 0) return results;

  const subidos = await conConcurrencia(signJson.signed, CONCURRENCIA, async (s) => {
    try {
      await putFile(s.signedUrl, inputs[s.index].file, s.contentType, opts.signal);
      return { ...s, ok: true as const };
    } catch (e) {
      // Best-effort: limpia el objeto a medias.
      fetch("/api/import/patient-files/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [{ patientId: inputs[s.index].patientId, path: s.path }] }),
        keepalive: true,
      }).catch(() => {});
      results[s.index] = { ...results[s.index], error: (e as Error).message };
      marcar();
      return { ...s, ok: false as const };
    }
  });

  const aConfirmar = subidos.filter((s) => s.ok);
  if (aConfirmar.length === 0) return results;

  const confirmRes = await fetch("/api/import/patient-files/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: aConfirmar.map((s) => ({
        index: s.index,
        patientId: inputs[s.index].patientId,
        path: s.path,
        name: inputs[s.index].file.name,
        category: inputs[s.index].category,
      })),
    }),
  });
  if (!confirmRes.ok) {
    const j = await confirmRes.json().catch(() => ({}));
    const msg = String(j?.error ?? "No se pudo registrar el archivo");
    for (const s of aConfirmar) { results[s.index] = { ...results[s.index], error: msg }; marcar(); }
    return results;
  }
  const confirmJson = (await confirmRes.json()) as {
    created: Array<{ index: number; id: string; name: string; url: string }>;
    errors: Array<{ index: number; error: string; code?: string }>;
  };
  for (const c of confirmJson.created) { results[c.index] = { ...results[c.index], ok: true, id: c.id, url: c.url }; marcar(); }
  for (const e of confirmJson.errors) { results[e.index] = { ...results[e.index], ok: false, error: e.error, code: e.code }; marcar(); }

  return results;
}
