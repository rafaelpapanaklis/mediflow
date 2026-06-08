// Núcleo de decodificación DICOM, compartido entre el Web Worker
// (dicom-decode.worker.ts) y el fallback en hilo principal de DicomSetViewer.
// Decodifica un corte DICOM sin comprimir a valores HU (rescale slope/intercept
// YA aplicado) guardados en Int16Array — la MITAD de RAM que Float32Array y
// suficiente para el rango HU típico (~-1024..3071). El consumidor (MPR 2D y el
// volumen 3D) lee pixels[i] por índice, exactamente igual que con Float32Array.

import dicomParser from "dicom-parser";

export interface DecodedSlice {
  rows: number;
  cols: number;
  // Valores HU (slope/intercept aplicado), truncados a entero de 16 bits.
  pixels: Int16Array;
  center: number;
  width: number;
  invert: boolean;
  order: number;
}

// Transfer Syntax UIDs sin comprimir que sabemos leer.
const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2",
  "1.2.840.10008.1.2.1",
  "1.2.840.10008.1.2.2",
]);

// ¿El nombre de entrada del .zip parece un corte DICOM? Acepta *.dcm/*.dicom o
// archivos sin extensión (muchos sets traen los cortes sin extensión). El
// llamador debe además descartar las entradas de directorio (f.dir).
export function isDicomEntryName(name: string): boolean {
  return /\.(dcm|dicom)$/i.test(name) || !/\.[a-z0-9]+$/i.test(name);
}

function firstNum(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const v = parseFloat(s.split("\\")[0]);
  return Number.isFinite(v) ? v : fallback;
}

// Decodifica un corte. Devuelve null si está comprimido, a color o es inválido
// (lo saltamos sin romper el set).
export function decodeSlice(buf: ArrayBuffer, fallbackOrder: number): DecodedSlice | null {
  try {
    const byteArray = new Uint8Array(buf);
    const ds = dicomParser.parseDicom(byteArray);
    const transfer = (ds.string("x00020010") || "1.2.840.10008.1.2.1").trim();
    if (!UNCOMPRESSED.has(transfer)) return null;

    const rows = ds.uint16("x00280010") || 0;
    const cols = ds.uint16("x00280011") || 0;
    if (!rows || !cols) return null;
    if ((ds.uint16("x00280002") || 1) !== 1) return null; // solo grises

    const bitsAllocated = ds.uint16("x00280100") || 16;
    const signed = (ds.uint16("x00280103") || 0) === 1;
    const invert = (ds.string("x00280004") || "MONOCHROME2").trim() === "MONOCHROME1";
    const slope = firstNum(ds.string("x00281053"), 1) || 1;
    const intercept = firstNum(ds.string("x00281052"), 0);

    const el = ds.elements.x7fe00010;
    if (!el) return null;
    const frameLen = rows * cols;
    // Int16Array: mitad de RAM que Float32Array. Los HU caben en 16 bits con
    // signo; la asignación out[i] = v trunca a entero (los HU ya lo son cuando
    // slope=1, el caso normal en CT/CBCT).
    const out = new Int16Array(frameLen);
    let minV = Infinity;
    let maxV = -Infinity;

    if (bitsAllocated === 16) {
      // dataOffset puede no estar alineado a 2 bytes: copiamos la región para
      // poder crear una vista Int16/Uint16 válida.
      const slice = byteArray.buffer.slice(el.dataOffset, el.dataOffset + el.length);
      const raw = signed ? new Int16Array(slice) : new Uint16Array(slice);
      const n = Math.min(frameLen, raw.length);
      for (let i = 0; i < n; i++) {
        const v = raw[i] * slope + intercept;
        // HU → Int16: redondea y satura al rango int16. Evita el wraparound
        // silencioso si un set trae RescaleSlope fraccional o densidades muy
        // altas (p. ej. metal en CT). Para CBCT normal (slope=1, HU en rango)
        // hu === v, así que el comportamiento no cambia.
        const hu = v < -32768 ? -32768 : v > 32767 ? 32767 : Math.round(v);
        out[i] = hu;
        if (hu < minV) minV = hu;
        if (hu > maxV) maxV = hu;
      }
    } else {
      const raw = byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
      const n = Math.min(frameLen, raw.length);
      for (let i = 0; i < n; i++) {
        const v = raw[i] * slope + intercept;
        // HU → Int16: redondea y satura al rango int16. Evita el wraparound
        // silencioso si un set trae RescaleSlope fraccional o densidades muy
        // altas (p. ej. metal en CT). Para CBCT normal (slope=1, HU en rango)
        // hu === v, así que el comportamiento no cambia.
        const hu = v < -32768 ? -32768 : v > 32767 ? 32767 : Math.round(v);
        out[i] = hu;
        if (hu < minV) minV = hu;
        if (hu > maxV) maxV = hu;
      }
    }
    if (!Number.isFinite(minV)) {
      minV = 0;
      maxV = 255;
    }

    let dc = firstNum(ds.string("x00281050"), NaN);
    let dw = firstNum(ds.string("x00281051"), NaN);
    if (!Number.isFinite(dc) || !Number.isFinite(dw) || dw <= 0) {
      dc = (minV + maxV) / 2;
      dw = Math.max(1, maxV - minV);
    }

    // Orden: InstanceNumber (x00200013) o, si no, posición Z (x00200032 z).
    let order = parseInt(ds.string("x00200013") || "", 10);
    if (!Number.isFinite(order)) {
      const pos = ds.string("x00200032");
      order = pos ? firstNum(pos.split("\\")[2], fallbackOrder) : fallbackOrder;
    }

    return { rows, cols, pixels: out, center: dc, width: dw, invert, order };
  } catch {
    return null;
  }
}
