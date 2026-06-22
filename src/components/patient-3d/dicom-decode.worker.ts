// Web Worker de decodificación del SET CBCT: descomprime el .zip (jszip) y
// decodifica cada corte DICOM a HU Int16 FUERA del hilo principal, para que la
// UI no se congele varios segundos (el cuello de botella era jszip + dicom-parser
// + rescale corriendo en el main thread). Devuelve los cortes con sus buffers
// TRANSFERIDOS (cero copia de vuelta al hilo principal).
//
// Aquí también se DESCOMPRIME el DICOM comprimido (JPEG2000/JPEG-LS/HTJ2K/RLE/
// JPEG…) vía decodeSliceAsync → @cornerstonejs/dicom-codec (códec WASM bajo
// demanda), siempre dentro del worker: la descompresión jamás corre en el main thread.
//
// El bundler de Next (webpack 5) emite este archivo como un chunk de worker
// aparte gracias a `new Worker(new URL("./dicom-decode.worker.ts", import.meta.url))`
// en DicomSetViewer. Si el bundling fallara, DicomSetViewer cae a decodificar
// en el hilo principal (con cesión fina) — esa ruta de respaldo solo lee DICOM
// SIN comprimir, por diseño (no se carga el códec WASM al main thread).

import JSZip from "jszip";
import { decodeSliceAsync, isDicomEntryName, type DecodedSlice } from "./dicom-decode-core";

// Scope del worker SIN tipos DOM (evita el choque de libs dom/webworker en el
// tsconfig del proyecto, que solo incluye "dom"). `self` existe en el worker.
const ctx: any = self;

ctx.onmessage = async (e: MessageEvent) => {
  const data = e.data || {};
  if (data.type !== "decode") return;
  const blob: Blob = data.blob;
  try {
    // El Blob llega clonado por referencia (sus bytes pesados NO se copiaron al
    // hacer postMessage); jszip lo lee directo.
    const zip = await JSZip.loadAsync(blob);
    const entries = (Object.values(zip.files) as any[]).filter(
      (f) => !f.dir && isDicomEntryName(f.name),
    );
    const total = entries.length;
    ctx.postMessage({ type: "progress", done: 0, total });

    const slices: DecodedSlice[] = [];
    let done = 0;
    for (const entry of entries) {
      try {
        const buf: ArrayBuffer = await entry.async("arraybuffer");
        // decodeSliceAsync devuelve un array de cortes (1 normal, >1 multi-frame) y
        // descomprime con el códec WASM si el corte viene comprimido (JPEG2000/LS/…).
        const s = await decodeSliceAsync(buf, done);
        if (s) slices.push(...s);
      } catch {
        /* corte inválido: se salta sin romper el set */
      }
      done++;
      if (done % 4 === 0 || done === total) {
        ctx.postMessage({ type: "progress", done, total });
      }
    }

    // Transfiere los buffers de pixeles: el hilo principal los recibe sin copiar.
    // Cada corte tiene su propio Int16Array.buffer, así que la lista no repite.
    const transfer = slices.map((s) => s.pixels.buffer);
    ctx.postMessage({ type: "done", slices }, transfer);
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: String((err as any)?.message || err || "decode error"),
    });
  }
};
