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

// Contrato de mensajes worker → hilo principal. Estaba implícito (todo `any`) y
// se escribe aquí para que el compilador vigile lo que sale del worker: los
// campos de orden y orientación de DecodedSlice (orderSource, imagePosition,
// planeNormal) viajan dentro de `slices` y tienen que llegar intactos.
//
// 🔴 Todo lo que se añada a DecodedSlice DEBE ser clonable por structured clone
// y ser un valor JSON simple (string, number, array de números). En concreto NO
// puede ser un TypedArray: si es una vista sobre `pixels.buffer`, la lista de
// transferencia de abajo DETACHA ese buffer y el campo llega vacío al otro lado;
// y si es un buffer propio, se copia entero por corte y se pierde el cero-copia.
// Si el clonado falla, postMessage lanza DataCloneError -> el catch de abajo
// manda {type:"error"} -> DicomSetViewer cae al decodificador del hilo principal,
// que por diseño NO descomprime: los estudios JPEG2000 dejarían de abrirse.
export type DecodeWorkerOut =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; slices: DecodedSlice[] }
  | { type: "error"; message: string };

// Scope del worker SIN tipos DOM (evita el choque de libs dom/webworker en el
// tsconfig del proyecto, que solo incluye "dom"). `self` existe en el worker.
const ctx: any = self;

// postMessage tipado: la única puerta de salida del worker pasa por aquí, así
// un cambio en el contrato de arriba se ve en compilación y no en pantalla.
function post(msg: DecodeWorkerOut, transfer?: any[]): void {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

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
    post({ type: "progress", done: 0, total });

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
        post({ type: "progress", done, total });
      }
    }

    // Transfiere los buffers de pixeles: el hilo principal los recibe sin copiar.
    // Cada corte tiene su propio Int16Array.buffer, así que la lista no repite.
    // El resto del corte —incluidos orderSource, imagePosition y planeNormal— va
    // por clonado estructural, que es lo correcto: son valores pequeños y no
    // deben detacharse.
    const transfer = slices.map((s) => s.pixels.buffer);
    post({ type: "done", slices }, transfer);
  } catch (err) {
    post({
      type: "error",
      message: String((err as any)?.message || err || "decode error"),
    });
  }
};
