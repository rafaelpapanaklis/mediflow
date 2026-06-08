// Núcleo de decodificación DICOM, compartido entre el Web Worker
// (dicom-decode.worker.ts) y el fallback en hilo principal de DicomSetViewer.
// Decodifica un archivo DICOM sin comprimir a valores HU (rescale slope/intercept
// YA aplicado) guardados en Int16Array — la MITAD de RAM que Float32Array y
// suficiente para el rango HU típico (~-1024..3071). El consumidor (MPR 2D y el
// volumen 3D) lee pixels[i] por índice, exactamente igual que con Float32Array.
//
// Además LEE LA GEOMETRÍA FÍSICA del estudio (PixelSpacing + espaciado entre
// cortes) y la expone en cada corte, para que el MPR y el volumen 3D reconstruyan
// con proporciones reales (sin esto el CBCT/CT sale deformado cuando el espaciado
// en plano != el espaciado entre cortes). Soporta archivos multi-frame
// (NumberOfFrames > 1): un .dcm puede traer varios cortes apilados, por eso
// decodeSlice devuelve un ARRAY de cortes (normalmente de longitud 1).

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
  // --- Geometría física (mm) -------------------------------------------------
  // La consume el MPR (DicomSetViewer) y el volumen 3D (Dicom3DVolume) para
  // reconstruir con proporciones reales.
  // pixelSpacing = [x, y] = [columna, fila] en mm. OJO: el tag DICOM PixelSpacing
  // (0028,0030) viene como "fila\columna" = [Δy, Δx]; aquí lo exponemos YA
  // invertido a [Δx, Δy] para el consumidor. Default [1,1] si el tag falta.
  pixelSpacing: [number, number];
  // zSpacing = mm entre centros de cortes adyacentes. SpacingBetweenSlices
  // (0018,0088) preferido; si no, SliceThickness (0018,0050); si no, asume
  // isotrópico con el espaciado de fila. Default razonable si todo falta.
  zSpacing: number;
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

// Decodifica UN frame de pixel data (rows*cols muestras) a HU en Int16, con
// rescale slope/intercept aplicado. Devuelve los pixeles y su min/max (para el
// window/level por defecto cuando el archivo no trae WindowCenter/Width).
function decodeFrame(
  byteArray: Uint8Array,
  frameByteOffset: number,
  frameLen: number,
  bitsAllocated: number,
  signed: boolean,
  slope: number,
  intercept: number,
): { pixels: Int16Array; minV: number; maxV: number } {
  // Int16Array: mitad de RAM que Float32Array. Los HU caben en 16 bits con
  // signo; la asignación out[i] = v trunca a entero (los HU ya lo son cuando
  // slope=1, el caso normal en CT/CBCT).
  const out = new Int16Array(frameLen);
  let minV = Infinity;
  let maxV = -Infinity;

  if (bitsAllocated === 16) {
    // dataOffset puede no estar alineado a 2 bytes: copiamos la región del frame
    // para poder crear una vista Int16/Uint16 válida.
    const start = byteArray.byteOffset + frameByteOffset;
    const slice = byteArray.buffer.slice(start, start + frameLen * 2);
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
    const raw = byteArray.subarray(frameByteOffset, frameByteOffset + frameLen);
    const n = Math.min(frameLen, raw.length);
    for (let i = 0; i < n; i++) {
      const v = raw[i] * slope + intercept;
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
  return { pixels: out, minV, maxV };
}

// Decodifica un archivo DICOM a uno o más cortes (multi-frame). Devuelve null si
// está comprimido, a color o es inválido (lo saltamos sin romper el set). Para el
// caso normal (un frame por archivo) devuelve un array de longitud 1.
export function decodeSlice(buf: ArrayBuffer, fallbackOrder: number): DecodedSlice[] | null {
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

    // --- Geometría física (mm) -----------------------------------------------
    // PixelSpacing (0028,0030) = "fila\columna" = [Δy, Δx]. Lo exponemos como
    // [x, y] = [Δcolumna, Δfila]. Si solo viene un valor, asume píxel cuadrado.
    let sx = 1;
    let sy = 1;
    const psStr = ds.string("x00280030");
    if (psStr) {
      const parts = psStr.split("\\");
      const rowSp = parseFloat(parts[0]); // Δy (entre filas)
      const colSp = parseFloat(parts[1]); // Δx (entre columnas)
      if (Number.isFinite(rowSp) && rowSp > 0) sy = rowSp;
      if (Number.isFinite(colSp) && colSp > 0) sx = colSp;
      else if (Number.isFinite(rowSp) && rowSp > 0) sx = rowSp; // un solo valor → cuadrado
    }
    const pixelSpacing: [number, number] = [sx, sy];
    // zSpacing: SpacingBetweenSlices (0018,0088) → SliceThickness (0018,0050) →
    // espaciado de fila (isotrópico) → 1.
    let zSpacing = firstNum(ds.string("x00180088"), NaN);
    if (!Number.isFinite(zSpacing) || zSpacing <= 0) zSpacing = firstNum(ds.string("x00180050"), NaN);
    if (!Number.isFinite(zSpacing) || zSpacing <= 0) zSpacing = sy;
    if (!Number.isFinite(zSpacing) || zSpacing <= 0) zSpacing = 1;

    const el = ds.elements.x7fe00010;
    if (!el) return null;
    const frameLen = rows * cols;
    const bytesPerSample = bitsAllocated === 16 ? 2 : 1;
    const frameBytes = frameLen * bytesPerSample;

    // NumberOfFrames (0028,0008): cortes apilados en un solo archivo (DICOM
    // enhanced/multi-frame). 1 en el caso normal. No leemos más allá de lo que
    // realmente cabe en el pixel data.
    let frames = parseInt(ds.string("x00280008") || "1", 10);
    if (!Number.isFinite(frames) || frames < 1) frames = 1;
    const maxFrames = Math.max(1, Math.floor(el.length / frameBytes));
    if (frames > maxFrames) frames = maxFrames;

    // Window/Level de la serie (tag); fallback al min/max de cada frame.
    const tagC = firstNum(ds.string("x00281050"), NaN);
    const tagW = firstNum(ds.string("x00281051"), NaN);

    // Orden base: InstanceNumber (x00200013) o, si no, posición Z (x00200032 z).
    // En multi-frame, cada frame suma su índice para conservar la secuencia.
    let baseOrder = parseInt(ds.string("x00200013") || "", 10);
    if (!Number.isFinite(baseOrder)) {
      const pos = ds.string("x00200032");
      baseOrder = pos ? firstNum(pos.split("\\")[2], fallbackOrder) : fallbackOrder;
    }

    const out: DecodedSlice[] = [];
    for (let f = 0; f < frames; f++) {
      const frameByteOffset = el.dataOffset + f * frameBytes;
      const { pixels, minV, maxV } = decodeFrame(
        byteArray,
        frameByteOffset,
        frameLen,
        bitsAllocated,
        signed,
        slope,
        intercept,
      );
      let dc = tagC;
      let dw = tagW;
      if (!Number.isFinite(dc) || !Number.isFinite(dw) || dw <= 0) {
        dc = (minV + maxV) / 2;
        dw = Math.max(1, maxV - minV);
      }
      out.push({
        rows,
        cols,
        pixels,
        center: dc,
        width: dw,
        invert,
        order: baseOrder + f,
        pixelSpacing,
        zSpacing,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
