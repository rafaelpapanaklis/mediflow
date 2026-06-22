// Núcleo de decodificación DICOM, compartido entre el Web Worker
// (dicom-decode.worker.ts) y el fallback en hilo principal de DicomSetViewer.
// Decodifica un archivo DICOM a valores HU (rescale slope/intercept YA aplicado)
// guardados en Int16Array — la MITAD de RAM que Float32Array y suficiente para el
// rango HU típico (~-1024..3071). El consumidor (MPR 2D y el volumen 3D) lee
// pixels[i] por índice, exactamente igual que con Float32Array.
//
// Dos rutas de decodificación:
//   - decodeSlice()      : SÍNCRONA, solo DICOM SIN comprimir. La usa el fallback
//                          en hilo principal (jamás carga el códec WASM al main).
//   - decodeSliceAsync() : ASÍNCRONA, además descomprime el PixelData comprimido
//                          (JPEG2000/JPEG-LS/HTJ2K/RLE/JPEG…) con el códec WASM
//                          correcto ANTES de aplicar el pipeline HU. La usa SOLO el
//                          Web Worker → la descompresión nunca corre en el main thread.
//
// Además LEE LA GEOMETRÍA FÍSICA del estudio (PixelSpacing + espaciado entre
// cortes) y la expone en cada corte, para que el MPR y el volumen 3D reconstruyan
// con proporciones reales (sin esto el CBCT/CT sale deformado cuando el espaciado
// en plano != el espaciado entre cortes). Soporta archivos multi-frame
// (NumberOfFrames > 1): un .dcm puede traer varios cortes apilados, por eso
// decodeSlice/decodeSliceAsync devuelven un ARRAY de cortes (normalmente longitud 1).

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

// Transfer Syntax UIDs sin comprimir que leemos directo (sin códec).
const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2", // Implicit VR Little Endian
  "1.2.840.10008.1.2.1", // Explicit VR Little Endian
  "1.2.840.10008.1.2.2", // Explicit VR Big Endian
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

// Cabecera del estudio: todo lo que se lee del DICOM SIN tocar los pixeles. La
// comparten la ruta sin comprimir y la ruta por códec (mismo pipeline HU).
interface SliceHeaders {
  transfer: string;
  rows: number;
  cols: number;
  bitsAllocated: number;
  signed: boolean;
  invert: boolean;
  slope: number;
  intercept: number;
  pixelSpacing: [number, number];
  zSpacing: number;
  framesTag: number; // NumberOfFrames (>=1)
  tagC: number; // WindowCenter (NaN si falta)
  tagW: number; // WindowWidth (NaN si falta)
  baseOrder: number;
}

// Lee la cabecera del dataset ya parseado. Devuelve null si el corte no es
// legible para este visor (sin rows/cols, o a color: solo trabajamos en grises).
function readHeaders(ds: any, fallbackOrder: number): SliceHeaders | null {
  const transfer = (ds.string("x00020010") || "1.2.840.10008.1.2.1").trim();

  const rows = ds.uint16("x00280010") || 0;
  const cols = ds.uint16("x00280011") || 0;
  if (!rows || !cols) return null;
  if ((ds.uint16("x00280002") || 1) !== 1) return null; // solo grises

  const bitsAllocated = ds.uint16("x00280100") || 16;
  const signed = (ds.uint16("x00280103") || 0) === 1;
  const invert = (ds.string("x00280004") || "MONOCHROME2").trim() === "MONOCHROME1";
  const slope = firstNum(ds.string("x00281053"), 1) || 1;
  const intercept = firstNum(ds.string("x00281052"), 0);

  // --- Geometría física (mm) -------------------------------------------------
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

  // NumberOfFrames (0028,0008): cortes apilados en un solo archivo (DICOM
  // enhanced/multi-frame). 1 en el caso normal.
  let framesTag = parseInt(ds.string("x00280008") || "1", 10);
  if (!Number.isFinite(framesTag) || framesTag < 1) framesTag = 1;

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

  return {
    transfer,
    rows,
    cols,
    bitsAllocated,
    signed,
    invert,
    slope,
    intercept,
    pixelSpacing,
    zSpacing,
    framesTag,
    tagC,
    tagW,
    baseOrder,
  };
}

// Decodifica UN frame de pixel data (rows*cols muestras) a HU en Int16, con
// rescale slope/intercept aplicado. Devuelve los pixeles y su min/max (para el
// window/level por defecto cuando el archivo no trae WindowCenter/Width). Sirve
// tanto para bytes leídos directo del archivo (sin comprimir) como para bytes ya
// descomprimidos por el códec.
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

// Arma el DecodedSlice a partir de un frame ya decodificado a HU. Resuelve el
// window/level por defecto (tag de serie o min/max del frame) y la geometría.
function assembleSlice(
  h: SliceHeaders,
  frame: { pixels: Int16Array; minV: number; maxV: number },
  frameIndex: number,
): DecodedSlice {
  let dc = h.tagC;
  let dw = h.tagW;
  if (!Number.isFinite(dc) || !Number.isFinite(dw) || dw <= 0) {
    dc = (frame.minV + frame.maxV) / 2;
    dw = Math.max(1, frame.maxV - frame.minV);
  }
  return {
    rows: h.rows,
    cols: h.cols,
    pixels: frame.pixels,
    center: dc,
    width: dw,
    invert: h.invert,
    order: h.baseOrder + frameIndex,
    pixelSpacing: h.pixelSpacing,
    zSpacing: h.zSpacing,
  };
}

// Ruta SIN comprimir: lee los frames directo del PixelData (x7fe00010) por offset.
// La comparten decodeSlice (sync) y decodeSliceAsync (cuando el corte no está
// comprimido), así el comportamiento es idéntico por ambas vías.
function decodeUncompressedFrames(ds: any, byteArray: Uint8Array, h: SliceHeaders): DecodedSlice[] | null {
  const el = ds.elements.x7fe00010;
  if (!el) return null;
  const frameLen = h.rows * h.cols;
  const bytesPerSample = h.bitsAllocated === 16 ? 2 : 1;
  const frameBytes = frameLen * bytesPerSample;

  // No leemos más allá de lo que realmente cabe en el pixel data.
  let frames = h.framesTag;
  const maxFrames = Math.max(1, Math.floor(el.length / frameBytes));
  if (frames > maxFrames) frames = maxFrames;

  const out: DecodedSlice[] = [];
  for (let f = 0; f < frames; f++) {
    const frameByteOffset = el.dataOffset + f * frameBytes;
    const frame = decodeFrame(byteArray, frameByteOffset, frameLen, h.bitsAllocated, h.signed, h.slope, h.intercept);
    out.push(assembleSlice(h, frame, f));
  }
  return out.length ? out : null;
}

// Decodifica un archivo DICOM SIN comprimir a uno o más cortes (multi-frame).
// Devuelve null si está comprimido, a color o es inválido (lo saltamos sin romper
// el set). Para el caso normal (un frame por archivo) devuelve un array de
// longitud 1. SÍNCRONA: la usa el fallback en hilo principal, que por diseño NO
// descomprime (eso solo ocurre en el worker, vía decodeSliceAsync).
export function decodeSlice(buf: ArrayBuffer, fallbackOrder: number): DecodedSlice[] | null {
  try {
    const byteArray = new Uint8Array(buf);
    const ds = dicomParser.parseDicom(byteArray);
    const h = readHeaders(ds, fallbackOrder);
    if (!h) return null;
    if (!UNCOMPRESSED.has(h.transfer)) return null; // comprimido → la ruta async lo maneja
    return decodeUncompressedFrames(ds, byteArray, h);
  } catch {
    return null;
  }
}

// --- Ruta COMPRIMIDA (códec WASM bajo demanda) -------------------------------

// Carga perezosa de @cornerstonejs/dicom-codec. El import() dinámico hace que
// webpack lo emita como un CHUNK APARTE que solo se baja cuando aparece el primer
// corte comprimido — y como solo lo invoca el worker, jamás se carga en el hilo
// principal. La promesa se memoiza: descomprimir N cortes inicializa el módulo
// (asm.js/WASM) una sola vez.
let codecPromise: Promise<any> | null = null;
function loadCodec(): Promise<any> {
  if (!codecPromise) {
    codecPromise = import("@cornerstonejs/dicom-codec").then((m: any) => m?.default ?? m);
  }
  return codecPromise;
}

// Extrae los bytes COMPRIMIDOS de un frame del PixelData encapsulado, replicando
// la lógica canónica de cornerstone (getEncapsulatedImageFrame): respeta la Basic
// Offset Table si existe; si no, usa un fragmento por frame cuando coinciden, o
// reconstruye la BOT a partir de los marcadores JPEG.
function getEncapsulatedFrame(ds: any, el: any, frameIndex: number, frames: number): Uint8Array {
  if (el.basicOffsetTable && el.basicOffsetTable.length) {
    return dicomParser.readEncapsulatedImageFrame(ds, el, frameIndex);
  }
  const numFragments = el.fragments ? el.fragments.length : 0;
  if (frames === numFragments) {
    // Un fragmento por frame.
    return dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, frameIndex);
  }
  // BOT ausente y varios fragmentos por frame: reconstruimos la BOT.
  const bot = dicomParser.createJPEGBasicOffsetTable(ds, el);
  return dicomParser.readEncapsulatedImageFrame(ds, el, frameIndex, bot);
}

// Convierte la salida del códec (bytes de pixel ya descomprimidos) en un frame HU
// reusando el MISMO decodeFrame del pipeline sin comprimir. La profundidad de bits
// se deriva del tamaño real del buffer (autoritativo sobre la cabecera); el signo,
// del códec si lo reporta, si no del PixelRepresentation del DICOM.
function framePixelsFromDecoded(
  decoded: any,
  h: SliceHeaders,
): { pixels: Int16Array; minV: number; maxV: number } | null {
  const img = decoded && decoded.imageFrame;
  if (!img || !img.byteLength) return null;
  const samples = h.rows * h.cols;
  if (samples <= 0) return null;

  let bytesPerSample = Math.round(img.byteLength / samples);
  if (bytesPerSample < 1) bytesPerSample = 1;
  const bits = bytesPerSample >= 2 ? 16 : 8;

  const dInfo = decoded.imageInfo || {};
  const signed = typeof dInfo.signed === "boolean" ? dInfo.signed : h.signed;

  // Copia los bytes a un buffer propio: los desacopla del heap asm.js/WASM del
  // códec (que se libera/reutiliza tras decode) antes de pasarlos al pipeline.
  const view = ArrayBuffer.isView(img)
    ? new Uint8Array((img as any).buffer, (img as any).byteOffset, (img as any).byteLength)
    : new Uint8Array(img);
  const bytes = new Uint8Array(view);

  return decodeFrame(bytes, 0, samples, bits, signed, h.slope, h.intercept);
}

// Ruta COMPRIMIDA: descomprime cada frame con el códec WASM correcto y aplica el
// pipeline HU. Devuelve null si no hay códec para ese transfer syntax o si ningún
// frame se pudo decodificar (se salta el corte sin romper el set).
async function decodeCompressedFrames(ds: any, h: SliceHeaders): Promise<DecodedSlice[] | null> {
  const el = ds.elements.x7fe00010;
  if (!el) return null;

  const dicomCodec = await loadCodec();
  if (!dicomCodec || typeof dicomCodec.decode !== "function") return null;
  if (typeof dicomCodec.hasCodec === "function" && !dicomCodec.hasCodec(h.transfer)) {
    return null; // transfer syntax sin códec (p. ej. variante no soportada) → saltar
  }

  const imageInfo = {
    rows: h.rows,
    columns: h.cols,
    bitsAllocated: h.bitsAllocated,
    samplesPerPixel: 1,
    signed: h.signed,
    pixelRepresentation: h.signed ? 1 : 0,
  };

  const frames = Math.max(1, h.framesTag);
  const out: DecodedSlice[] = [];
  for (let f = 0; f < frames; f++) {
    let encoded: Uint8Array | undefined;
    try {
      encoded = getEncapsulatedFrame(ds, el, f, frames);
    } catch {
      continue; // fragmento ilegible → saltar este frame
    }
    if (!encoded || !encoded.length) continue;

    let decoded: any;
    try {
      decoded = await dicomCodec.decode(encoded, imageInfo, h.transfer);
    } catch {
      continue; // frame corrupto o códec sin soporte real → saltar
    }

    const frame = framePixelsFromDecoded(decoded, h);
    if (!frame) continue;
    out.push(assembleSlice(h, frame, f));
  }
  return out.length ? out : null;
}

// Decodifica un archivo DICOM a uno o más cortes, descomprimiendo el PixelData
// cuando viene comprimido (JPEG2000/JPEG-LS/HTJ2K/RLE/JPEG…) con el códec WASM
// bajo demanda. ASÍNCRONA y pensada para el Web Worker: la descompresión nunca
// debe correr en el hilo principal. Para DICOM sin comprimir hace exactamente lo
// mismo que decodeSlice (sin cargar el códec). Devuelve null si el corte es
// inválido/sin códec, para saltarlo sin romper el set.
export async function decodeSliceAsync(
  buf: ArrayBuffer,
  fallbackOrder: number,
): Promise<DecodedSlice[] | null> {
  try {
    const byteArray = new Uint8Array(buf);
    const ds = dicomParser.parseDicom(byteArray);
    const h = readHeaders(ds, fallbackOrder);
    if (!h) return null;
    if (UNCOMPRESSED.has(h.transfer)) {
      return decodeUncompressedFrames(ds, byteArray, h);
    }
    return await decodeCompressedFrames(ds, h);
  } catch {
    return null;
  }
}
