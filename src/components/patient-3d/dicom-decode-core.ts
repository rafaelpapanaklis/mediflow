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
// en plano != el espaciado entre cortes). Desde el arreglo de orientación lee
// también la POSICIÓN del corte (ImagePositionPatient) y la ORIENTACIÓN del plano
// (ImageOrientationPatient), y ordena por la posición física proyectada sobre la
// normal en lugar de por InstanceNumber. Soporta archivos multi-frame
// (NumberOfFrames > 1): un .dcm puede traer varios cortes apilados, por eso
// decodeSlice/decodeSliceAsync devuelven un ARRAY de cortes (normalmente longitud 1).

import dicomParser from "dicom-parser";

// De dónde salió el `order` de un corte. Las dos ramas producen números en
// UNIDADES DISTINTAS, y por eso este campo viaja con cada corte:
//   "position" → milímetros con signo sobre la normal del plano (criterio bueno).
//   "instance" → un índice entero sin significado físico (último recurso).
// Ordenar un set donde conviven las dos ramas no lo invierte: lo BARAJA (un
// InstanceNumber 1..300 y una posición −120..+60 mm se intercalan). Cualquier
// consumidor que ordene por `order` debe comprobar antes que todos los cortes
// comparten `orderSource`.
export type SliceOrderSource = "position" | "instance";

// ImageOrientationPatient (0020,0037) tal cual: los seis cosenos directores del
// vector de FILA (indices 0-2) y del de COLUMNA (3-5), en el sistema del paciente
// (LPS: X+ = izquierda, Y+ = posterior, Z+ = superior). Se conserva crudo ademas
// de la normal porque la normal sola NO basta para rotular los bordes: dice hacia
// donde mira el corte, no si la columna 0 del raster cae a la derecha o a la
// izquierda del paciente. Esa respuesta esta en el vector de fila.
export type ImageOrientation = [number, number, number, number, number, number];

export interface DecodedSlice {
  rows: number;
  cols: number;
  // Valores HU (slope/intercept aplicado), truncados a entero de 16 bits.
  pixels: Int16Array;
  center: number;
  width: number;
  invert: boolean;
  order: number;
  // --- Orden y orientación ---------------------------------------------------
  // Unidad y procedencia de `order` (ver SliceOrderSource). Obligatorio a
  // propósito: un corte sin procedencia declarada es un corte que nadie puede
  // ordenar con criterio.
  orderSource: SliceOrderSource;
  // ImagePositionPatient (0020,0032) = esquina del primer píxel en el sistema
  // del paciente, en mm. `null` cuando el tag falta — NO se inventa un origen:
  // el consumidor tiene que poder distinguir "está en el origen" de "no se sabe".
  imagePosition: [number, number, number] | null;
  // Normal del plano del corte, unitaria: producto cruz de los vectores de fila
  // y columna de ImageOrientationPatient (0020,0037). Cuando ese tag falta o es
  // degenerado se asume el axial estándar (0,0,1), que es lo que hace un CBCT
  // dental normal. Con `orderSource === "position"` se cumple que
  // order === imagePosition · planeNormal.
  planeNormal: [number, number, number];
  // ImageOrientationPatient crudo, o `null` cuando el estudio no lo declara (o lo
  // declara degenerado). NO se sustituye por el axial estandar: `planeNormal` cae
  // a (0,0,1) para poder ordenar, pero rotular R/L/A/P/S/I a partir de una
  // suposicion seria escribir sobre la imagen del paciente una lateralidad que el
  // estudio nunca dijo. Sin este campo, quien rotula no puede distinguir
  // "orientacion estandar" de "orientacion desconocida".
  imageOrientation: ImageOrientation | null;
  // SeriesInstanceUID (0020,000E) — la IDENTIDAD de la serie, tal cual la escribe
  // el equipo. Es el ÚNICO dato que dice de verdad qué cortes forman un volumen;
  // todo lo demás (misma matriz, misma orientación, posiciones que encajan) son
  // indicios que se pueden cumplir entre dos adquisiciones distintas del mismo
  // paciente. `null` si el estudio no lo trae, y entonces hay que conformarse con
  // los indicios.
  seriesUid: string | null;
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

// Lee un tag DICOM multivaluado ("a\b\c") como los `expected` primeros números.
// Devuelve null si el tag falta o si no llega a `expected` valores finitos: en
// geometría medio vector es tan inútil como ninguno, y es preferible caer al
// fallback declarado que ordenar un estudio con una coordenada a medias.
//
// Acepta que SOBREN componentes en vez de exigir el número exacto, porque hay
// escritores que dejan una barra invertida final ("-12.5\-3.2\40.1\") y eso
// produce un cuarto elemento vacío. Con la comparación exacta, un archivo así
// perdía su posición y caía al índice del .zip — justo lo que este arreglo
// viene a quitar de en medio.
function leadingNums(s: string | undefined, expected: number): number[] | null {
  if (!s) return null;
  const parts = s.split("\\");
  if (parts.length < expected) return null;
  const out: number[] = new Array(expected);
  for (let i = 0; i < expected; i++) {
    // parseFloat tolera el relleno con espacios del VR "DS" de DICOM.
    const v = parseFloat(parts[i]);
    if (!Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out;
}

// Normal del plano = producto cruz de los vectores de fila y columna de
// ImageOrientationPatient, normalizada a longitud 1 (así proyectar la posición
// sobre ella da milímetros reales, no una escala arbitraria).
//
// Devuelve null si el resultado es DEGENERADO —vectores nulos, paralelos o
// basura—. Sin esa guarda un IOP malformado daría normal (0,0,0), el producto
// punto valdría 0 para TODOS los cortes y el volumen entero empataría: el sort
// los dejaría en el orden de llegada del .zip sin un solo síntoma en pantalla.
export function planeNormalFrom(iop: readonly number[]): [number, number, number] | null {
  const [rx, ry, rz, cx, cy, cz] = iop;
  const nx = ry * cz - rz * cy;
  const ny = rz * cx - rx * cz;
  const nz = rx * cy - ry * cx;
  const len = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  return [nx / len, ny / len, nz / len];
}

// Posición REAL de cada frame de un archivo multi-frame.
//
// El tag raíz ImagePositionPatient (0020,0032) describe UN corte. En un DICOM
// enhanced/multi-frame la posición de cada frame vive en otro sitio:
//   PerFrameFunctionalGroupsSequence (5200,9230)
//     → item[f] → PlanePositionSequence (0020,9113)
//       → item[0] → ImagePositionPatient (0020,0032)
//
// Antes esto no se leía y la posición de los frames 1..N se SINTETIZABA sumando
// `zSpacing` sobre la normal. Eso no era una lectura, era una suposición con
// forma de dato, y se cerraba en círculo: el visor medía después el espaciado
// restando esas posiciones, recuperaba exactamente el número que él mismo había
// inventado, y lo declaraba "calibrado" y "regular". Si además los frames reales
// iban en sentido decreciente, el volumen quedaba del revés con una "S" impresa
// donde estaba lo inferior.
//
// O están las posiciones de TODOS los frames, o no sirve ninguna: con la mitad,
// el sort mezcla frames medidos con frames supuestos, que es el caso que este
// arreglo entero viene a evitar.
function readFramePositions(ds: any, frames: number): ([number, number, number] | null)[] | null {
  if (frames < 2) return null;
  const items = ds?.elements?.x52009230?.items;
  if (!Array.isArray(items) || items.length < frames) return null;
  const out: ([number, number, number] | null)[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const plane = items[f]?.dataSet?.elements?.x00209113?.items?.[0]?.dataSet;
    const v = plane ? leadingNums(plane.string("x00200032"), 3) : null;
    if (!v) return null; // un frame sin posición invalida el lote entero
    out[f] = [v[0], v[1], v[2]];
  }
  return out;
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
  baseOrder: number; // orden del frame 0; en mm si orderSource==="position"
  orderSource: SliceOrderSource;
  imagePosition: [number, number, number] | null; // IPP del frame 0 (mm)
  planeNormal: [number, number, number]; // unitaria
  imageOrientation: ImageOrientation | null; // IOP crudo (null si falta/degenerado)
  seriesUid: string | null; // SeriesInstanceUID (0020,000E)
  // Posición LEÍDA de cada frame (multi-frame conforme). `null` = archivo de un
  // solo frame, o multi-frame que no las declara. Ver readFramePositions.
  framePositions: ([number, number, number] | null)[] | null;
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

  // --- Orden de los cortes ---------------------------------------------------
  // CRITERIO PRIMARIO: la posición FÍSICA del corte, ImagePositionPatient
  // (0020,0032) proyectada sobre la normal del plano. Es lo único que el
  // estándar garantiza monótono a lo largo del eje de adquisición, y además sale
  // en milímetros, así que la diferencia entre cortes consecutivos es espaciado
  // real (no hace falta creerse SliceThickness).
  //
  // InstanceNumber (0020,0013) baja a ÚLTIMO RECURSO: es un número de catálogo,
  // no una coordenada. Hay equipos que lo reinician por serie, que lo reutilizan
  // entre series del mismo estudio y que lo emiten en sentido contrario a la
  // adquisición; ordenar por él da un volumen invertido o entrelazado que se ve
  // "casi bien" y solo se detecta midiendo.
  // Identidad de la serie. Se lee ANTES que la geometría porque es lo que decide
  // qué cortes forman un volumen; la geometría solo describe cada uno.
  const seriesUid = (ds.string("x0020000e") || "").trim() || null;
  const iop = leadingNums(ds.string("x00200037"), 6);
  const ipp = leadingNums(ds.string("x00200032"), 3);
  // Sin ImageOrientationPatient (o con uno degenerado) asumimos el plano axial
  // estándar: la normal es +Z y proyectar sobre ella es quedarse con la z de la
  // posición, que es exactamente el comportamiento que se quiere para un CBCT
  // dental. La normal SIEMPRE tiene valor; `imagePosition` puede no tenerlo.
  const normalFromIop = iop ? planeNormalFrom(iop) : null;
  const planeNormal: [number, number, number] = normalFromIop || [0, 0, 1];
  // El IOP crudo solo se conserva si produjo una normal VALIDA: un IOP degenerado
  // (vectores nulos o paralelos) no describe ningun plano, y guardarlo invitaria a
  // rotular bordes con basura. O sirve para las dos cosas, o no sirve para ninguna.
  const imageOrientation: ImageOrientation | null =
    iop && normalFromIop ? [iop[0], iop[1], iop[2], iop[3], iop[4], iop[5]] : null;

  // Multi-frame: o se leen las posiciones de TODOS sus frames, o este archivo no
  // aporta geometría. Un multi-frame sin ellas no puede declararse "position":
  // sabríamos dónde está su primer frame y no dónde están los demás, y ese medio
  // dato es justo el que antes se completaba a ojo.
  const framePositions = readFramePositions(ds, framesTag);
  const frameGeometryUnknown = framesTag > 1 && !framePositions;

  // Un enhanced multi-frame CONFORME no trae ImagePositionPatient en la raíz: su
  // sitio está dentro de PerFrameFunctionalGroupsSequence, frame a frame. Exigir
  // el tag raíz mandaba justo esos archivos —los que MEJOR declaran su geometría—
  // a la rama de "no se sabe", con las posiciones ya leídas y en la mano.
  const anchor = framePositions ? framePositions[0] : ipp;

  let baseOrder: number;
  let orderSource: SliceOrderSource;
  if (anchor && !frameGeometryUnknown) {
    baseOrder = anchor[0] * planeNormal[0] + anchor[1] * planeNormal[1] + anchor[2] * planeNormal[2];
    orderSource = "position";
  } else {
    // Sin posición no hay geometría de la que tirar: InstanceNumber y, si
    // tampoco está, el índice de entrada que nos pasa el llamador.
    const inst = parseInt(ds.string("x00200013") || "", 10);
    baseOrder = Number.isFinite(inst) ? inst : fallbackOrder;
    orderSource = "instance";
  }
  const imagePosition: [number, number, number] | null = anchor
    ? [anchor[0], anchor[1], anchor[2]]
    : null;

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
    orderSource,
    imagePosition,
    planeNormal,
    imageOrientation,
    seriesUid,
    framePositions,
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
  // Posición y orden de ESTE frame. Tres casos, y ninguno inventa nada:
  //
  //  1) Multi-frame CONFORME (framePositions): la posición del frame se LEYÓ de
  //     PerFrameFunctionalGroupsSequence. `order` es su proyección sobre la
  //     normal, igual que en un archivo de un solo corte, así que se mantiene la
  //     invariante order === imagePosition · planeNormal y un consumidor puede
  //     derivar el espaciado real restando cortes.
  //  2) Archivo de UN frame con posición: frameIndex es 0, no hay desplazamiento
  //     que aplicar y `order` es el de la cabecera.
  //  3) Multi-frame SIN posiciones por frame: readHeaders ya lo degradó a
  //     "instance", así que `order` vuelve a ser un ÍNDICE y el frame suma 1,
  //     exactamente como antes de todo este arreglo. Se conserva la posición del
  //     frame 0 (esa sí consta, es el tag raíz) y los demás quedan en null: no se
  //     sabe dónde están, y decirlo es lo único honesto — antes se rellenaban
  //     sumando `zSpacing`, un número que a menudo era el GROSOR del corte y no
  //     el paso, y que el visor luego "medía" de vuelta creyéndolo un dato.
  const perFrame = h.framePositions ? h.framePositions[frameIndex] : null;
  const ip = h.imagePosition;
  let imagePosition: [number, number, number] | null;
  let order: number;
  if (perFrame) {
    imagePosition = [perFrame[0], perFrame[1], perFrame[2]];
    order = perFrame[0] * h.planeNormal[0] + perFrame[1] * h.planeNormal[1] + perFrame[2] * h.planeNormal[2];
  } else {
    imagePosition = ip && frameIndex === 0 ? [ip[0], ip[1], ip[2]] : null;
    order = h.baseOrder + frameIndex; // "instance" ⇒ índice; un solo frame ⇒ +0
  }

  return {
    rows: h.rows,
    cols: h.cols,
    pixels: frame.pixels,
    center: dc,
    width: dw,
    invert: h.invert,
    order,
    orderSource: h.orderSource,
    imagePosition,
    // Array propio por corte: el consumidor no debe poder mutar la normal de
    // todo el estudio escribiendo en la de un corte.
    planeNormal: [h.planeNormal[0], h.planeNormal[1], h.planeNormal[2]],
    // Copia propia por corte, por lo mismo que la normal: nadie debe poder mutar
    // la orientacion del estudio entero escribiendo en la de un corte.
    imageOrientation: h.imageOrientation
      ? [
          h.imageOrientation[0],
          h.imageOrientation[1],
          h.imageOrientation[2],
          h.imageOrientation[3],
          h.imageOrientation[4],
          h.imageOrientation[5],
        ]
      : null,
    seriesUid: h.seriesUid,
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
