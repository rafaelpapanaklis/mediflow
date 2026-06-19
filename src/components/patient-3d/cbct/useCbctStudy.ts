"use client";

// ─────────────────────────────────────────────────────────────────────────────
// useCbctStudy — CARGADOR DICOM REAL del visor CBCT rediseñado (WS2-T7).
//
// Reusa EXACTAMENTE el pipeline probado de DicomSetViewer (cache IndexedDB de
// cortes decodificados → descarga del .zip con cache de blobs → decode en Web
// Worker, con fallback al hilo principal → cache del decodificado), pero en vez
// de PINTAR, DEVUELVE los datos para que el visor rediseñado los consuma. NO
// duplica la decodificación: reutiliza dicom-decode.worker.ts + dicom-decode-
// core.ts + dicom-cache.ts (solo replica el delgado "driver" del worker, que es
// orquestación, no decodificación).
//
// Además DERIVA mmPorPixel REAL por plano desde las cabeceras (PixelSpacing),
// reemplazando el FOV fijo del prototipo (§5 INTEGRACION.md). El contrato
// (types.ts) define mmPorPixel[plane] = "mm que abarca el ancho normalizado
// completo (0→1) del plano" = cols × PixelSpacing.x (etc.).
//
// Reglas del repo: tsconfig NO strict, SIN target ES2015 → nada de for...of
// sobre Map/Set; bucles por índice en las rutas calientes.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { fetchWithCache, getDecodedSlices, putDecodedSlices } from "@/lib/dicom-cache";
import { decodeSlice, isDicomEntryName, type DecodedSlice } from "../dicom-decode-core";
import type { Plane } from "./types";

export type CbctStudyStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface CbctDims {
  cols: number;
  rows: number;
  depth: number;
}

export interface CbctStudy {
  status: CbctStudyStatus;
  progress: { done: number; total: number };
  /** Cortes decodificados (HU Int16), ordenados por `order`. Vacío hasta ready. */
  slices: DecodedSlice[];
  /** Dimensiones del volumen (cols×rows×depth) o null hasta ready. */
  dims: CbctDims | null;
  /** Escala REAL por plano: mm del ancho normalizado completo (0→1). */
  mmPorPixel: Record<Plane, number>;
  /** Window/level por defecto (HU) del corte medio, o null hasta ready. */
  defaultHU: { center: number; width: number } | null;
  /** Espaciado nominal (mm) para el header: min(sx, sy, zSpacing). */
  espaciadoMm: number | null;
}

// mmPorPixel de respaldo mientras no hay estudio (0 = "sin escala aún"). El
// contrato exige Record<Plane,number>; geometry.mmBetween devuelve 0, no NaN.
const FALLBACK_MM: Record<Plane, number> = { axial: 0, coronal: 0, sagital: 0, vol3d: 0 };

// Deriva la escala física por plano + dimensiones desde el PRIMER corte. Lectura
// DEFENSIVA de pixelSpacing/zSpacing: la cache vieja no los tipa aunque el
// structured-clone los conserve en runtime (igual que Dicom3DVolume los lee).
function deriveMm(slices: DecodedSlice[]): {
  mmPorPixel: Record<Plane, number>;
  dims: CbctDims;
  espaciadoMm: number;
} {
  const first: any = slices[0];
  const cols: number = first.cols;
  const rows: number = first.rows;
  const depth = slices.length;
  const sp = first.pixelSpacing; // [Δx(columna), Δy(fila)] en mm (ya invertido)
  const sx = sp && sp[0] > 0 ? sp[0] : 1; // mm por columna (eje X)
  const sy = sp && sp[1] > 0 ? sp[1] : 1; // mm por fila (eje Y)
  const zRaw = first.zSpacing;
  const sz = zRaw && zRaw > 0 ? zRaw : sy; // mm entre cortes (eje Z)
  // "mm que abarca el ancho normalizado completo (0→1)" por plano:
  //   axial   ancho = X (cols·sx)
  //   coronal ancho = X (cols·sx)   [alto = Z]
  //   sagital ancho = Y (rows·sy)   [alto = Z]
  //   vol3d   nominal = X (cols·sx)
  const xSpan = cols * sx;
  const ySpan = rows * sy;
  const mmPorPixel: Record<Plane, number> = {
    axial: xSpan,
    coronal: xSpan,
    sagital: ySpan,
    vol3d: xSpan,
  };
  return { mmPorPixel, dims: { cols, rows, depth }, espaciadoMm: Math.min(sx, sy, sz) };
}

// ── Driver del Web Worker (orquestación; el decode vive en el worker/core) ────

function createDecodeWorker(): Worker | null {
  try {
    if (typeof window === "undefined" || typeof Worker === "undefined") return null;
    // Ruta relativa a ESTE módulo (cbct/) → patient-3d/dicom-decode.worker.ts.
    return new Worker(new URL("../dicom-decode.worker.ts", import.meta.url));
  } catch {
    return null;
  }
}

type DecodeProgress = (done: number, total: number) => void;

function decodeWithWorker(
  blob: Blob,
  onProgress: DecodeProgress,
  onWorker: (w: Worker) => void,
): Promise<DecodedSlice[]> {
  return new Promise((resolve, reject) => {
    const worker = createDecodeWorker();
    if (!worker) {
      reject(new Error("worker unavailable"));
      return;
    }
    onWorker(worker);
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      if (msg.type === "progress") {
        onProgress(msg.done, msg.total);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.slices as DecodedSlice[]);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message || "worker error"));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("worker error"));
    };
    worker.postMessage({ type: "decode", blob });
  });
}

// Fallback en hilo principal (cede el hilo cada 2 cortes). Solo si el worker no
// bundlea/instancia o falla en runtime. Reutiliza decodeSlice del core.
async function decodeOnMain(
  blob: Blob,
  onProgress: DecodeProgress,
  isCancelled: () => boolean,
): Promise<DecodedSlice[]> {
  const zip = await JSZip.loadAsync(blob);
  const entries = (Object.values(zip.files) as any[]).filter(
    (f) => !f.dir && isDicomEntryName(f.name),
  );
  const total = entries.length;
  onProgress(0, total);
  const out: DecodedSlice[] = [];
  let done = 0;
  for (let i = 0; i < entries.length; i++) {
    if (isCancelled()) return out;
    try {
      const buf = await entries[i].async("arraybuffer");
      const s = decodeSlice(buf, done); // array de cortes (1 normal, >1 multiframe)
      if (s) {
        for (let k = 0; k < s.length; k++) out.push(s[k]);
      }
    } catch {
      /* corte inválido: se salta */
    }
    done++;
    if (done % 2 === 0 || done === total) {
      onProgress(done, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}

export interface UseCbctStudyOpts {
  fileId: string;
  url: string;
  /** Si es false, no carga (lazy). Default true. */
  enabled?: boolean;
}

export function useCbctStudy({ fileId, url, enabled = true }: UseCbctStudyOpts): CbctStudy {
  const [status, setStatus] = useState<CbctStudyStatus>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [slices, setSlices] = useState<DecodedSlice[]>([]);
  const [derived, setDerived] = useState<{
    mmPorPixel: Record<Plane, number>;
    dims: CbctDims;
    espaciadoMm: number;
  } | null>(null);
  const [defaultHU, setDefaultHU] = useState<{ center: number; width: number } | null>(null);

  // La signed URL cambia en cada apertura (TTL corto); el fileId es estable. El
  // efecto se re-ejecuta por fileId, NO por url (ver DicomSetViewer): así no
  // re-decodifica al reabrir el mismo estudio. urlRef da la última url al miss.
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!enabled || !fileId) return;
    let cancelled = false;
    let activeWorker: Worker | null = null;
    const isCancelled = () => cancelled;

    const finalize = (arr: DecodedSlice[]) => {
      if (arr.length === 0) {
        setStatus("empty");
        return;
      }
      arr.sort((a, b) => a.order - b.order);
      const mid = Math.floor(arr.length / 2);
      setSlices(arr);
      setDerived(deriveMm(arr));
      setDefaultHU({ center: arr[mid].center, width: arr[mid].width });
      setStatus("ready");
    };

    setStatus("loading");
    setProgress({ done: 0, total: 0 });
    (async () => {
      try {
        // 1) ¿Cortes ya decodificados en cache? Salta descarga + decode.
        const cached = await getDecodedSlices(fileId);
        if (cancelled) return;
        if (cached && cached.length > 0) {
          finalize(cached as unknown as DecodedSlice[]);
          return;
        }
        // 2) Descarga el .zip (cache de blobs por fileId).
        const blob = await fetchWithCache(fileId, urlRef.current);
        if (cancelled) return;
        // 3) Decodifica en Web Worker (fallback al hilo principal).
        const onProgress: DecodeProgress = (done, total) => {
          if (!cancelled) setProgress({ done, total });
        };
        let decoded: DecodedSlice[];
        try {
          decoded = await decodeWithWorker(blob, onProgress, (w) => {
            activeWorker = w;
          });
        } catch {
          if (cancelled) return;
          decoded = await decodeOnMain(blob, onProgress, isCancelled);
        }
        if (cancelled) return;
        finalize(decoded);
        // 4) Cachea el decodificado (best-effort) para próximas aperturas.
        if (decoded.length > 0) void putDecodedSlices(fileId, decoded as any);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (activeWorker) activeWorker.terminate();
    };
    // Depende de fileId (estable) + enabled; NO de url (urlRef arriba).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, enabled]);

  return {
    status,
    progress,
    slices,
    dims: derived ? derived.dims : null,
    mmPorPixel: derived ? derived.mmPorPixel : FALLBACK_MM,
    defaultHU,
    espaciadoMm: derived ? derived.espaciadoMm : null,
  };
}

export default useCbctStudy;
