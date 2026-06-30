// Formato del CBCT "lite": un volumen REDUCIDO del estudio, empaquetado en un
// binario compacto (~10-25 MB) que el SERVIDOR genera una vez y el MÓVIL descarga
// en lugar del .zip original (300-600 MB). Un iPhone no puede descargar +
// descomprimir + decodificar el estudio completo sin que iOS recargue la pestaña
// por falta de memoria; el lite evita TODO ese trabajo en el teléfono.
//
// Este archivo es PURO (sin Node, sin DOM): lo usan el generador del servidor
// (src/lib/cbct-lite.ts) para ESCRIBIR y el visor (DicomSetViewer) para LEER.
// Trabaja con ArrayBuffer/DataView/Int16Array, universales en ambos entornos.
//
// Layout (todo little-endian; las plataformas que importan —x86/ARM— son LE, y
// servidor y cliente comparten endianness):
//   [0..3]   magic ASCII "CBL1"
//   [4]      version (u8) = 1
//   [5]      invert (u8, 0/1)            — MONOCHROME1 del estudio
//   [6]      hasRealSpacing (u8, 0/1)    — el PixelSpacing del estudio era real (no [1,1])
//   [7]      pad
//   [8..11]  count (u32)  — número de cortes (D)
//   [12..15] rows  (u32)  — filas por corte (H)
//   [16..19] cols  (u32)  — columnas por corte (W)
//   [20..23] dx (f32, mm/columna)  — espaciado físico YA ajustado por el submuestreo
//   [24..27] dy (f32, mm/fila)
//   [28..31] dz (f32, mm entre cortes)
//   [32..35] center (f32)  — ventana por defecto (el visor recalcula por percentiles)
//   [36..39] width  (f32)
//   [40..63] reservado (ceros)
//   [64..]   píxeles: count*rows*cols valores Int16 LE (cortes concatenados en orden Z)

import type { DecodedSlice } from "./dicom-decode-core";

export const CBCT_LITE_HEADER_BYTES = 64;
// "CBL1" byte a byte (evita depender de TextEncoder en el cliente).
const MAGIC = [0x43, 0x42, 0x4c, 0x31] as const; // C B L 1
export const CBCT_LITE_VERSION = 1;

export interface CbctLiteMeta {
  count: number;
  rows: number;
  cols: number;
  dx: number;
  dy: number;
  dz: number;
  center: number;
  width: number;
  invert: boolean;
  hasRealSpacing: boolean;
}

/**
 * Serializa el volumen reducido a un binario lite. `voxels` son los cortes
 * concatenados en orden Z (length === count*rows*cols). Lo usa el generador del
 * servidor. Lanza si las dimensiones no cuadran (bug del llamador, no entrada).
 */
export function encodeCbctLite(meta: CbctLiteMeta, voxels: Int16Array): Uint8Array {
  const per = meta.rows * meta.cols;
  const n = meta.count * per;
  if (!Number.isInteger(n) || n <= 0) throw new Error("cbct-lite: dimensiones inválidas");
  if (voxels.length !== n) {
    throw new Error(`cbct-lite: voxels.length=${voxels.length} != count*rows*cols=${n}`);
  }
  const buf = new ArrayBuffer(CBCT_LITE_HEADER_BYTES + n * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC[i]);
  dv.setUint8(4, CBCT_LITE_VERSION);
  dv.setUint8(5, meta.invert ? 1 : 0);
  dv.setUint8(6, meta.hasRealSpacing ? 1 : 0);
  dv.setUint32(8, meta.count, true);
  dv.setUint32(12, meta.rows, true);
  dv.setUint32(16, meta.cols, true);
  dv.setFloat32(20, meta.dx, true);
  dv.setFloat32(24, meta.dy, true);
  dv.setFloat32(28, meta.dz, true);
  dv.setFloat32(32, meta.center, true);
  dv.setFloat32(36, meta.width, true);
  // Copia los píxeles en una vista alineada (offset 64 es múltiplo de 2 → válido).
  new Int16Array(buf, CBCT_LITE_HEADER_BYTES, n).set(voxels);
  return new Uint8Array(buf);
}

/**
 * Deserializa el binario lite a la MISMA forma de cortes que el visor ya consume
 * (DecodedSlice[]): así MprPane, Dicom3DVolume, la cruz y la ventana funcionan
 * sin cambios, solo con un volumen más pequeño. Devuelve null si el binario no es
 * un lite válido (magic/version/longitud), para que el visor caiga a su error.
 * Cada corte recibe su propia copia Int16Array (independiente del buffer origen).
 */
export function decodeCbctLite(buf: ArrayBuffer): { meta: CbctLiteMeta; slices: DecodedSlice[] } | null {
  if (!buf || buf.byteLength < CBCT_LITE_HEADER_BYTES) return null;
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) if (dv.getUint8(i) !== MAGIC[i]) return null;
  if (dv.getUint8(4) !== CBCT_LITE_VERSION) return null;
  const invert = dv.getUint8(5) === 1;
  const hasRealSpacing = dv.getUint8(6) === 1;
  const count = dv.getUint32(8, true);
  const rows = dv.getUint32(12, true);
  const cols = dv.getUint32(16, true);
  const dx = dv.getFloat32(20, true);
  const dy = dv.getFloat32(24, true);
  const dz = dv.getFloat32(28, true);
  const center = dv.getFloat32(32, true);
  const width = dv.getFloat32(36, true);
  const per = rows * cols;
  const n = count * per;
  if (count <= 0 || rows <= 0 || cols <= 0) return null;
  if (buf.byteLength < CBCT_LITE_HEADER_BYTES + n * 2) return null;

  const all = new Int16Array(buf, CBCT_LITE_HEADER_BYTES, n);
  const slices: DecodedSlice[] = new Array(count);
  for (let z = 0; z < count; z++) {
    // .slice() copia: cada corte queda con su propio buffer (el visor/worker los
    // trata como independientes; además el volumen 3D transfiere buffers).
    const pixels = all.slice(z * per, (z + 1) * per);
    slices[z] = {
      rows,
      cols,
      pixels,
      center,
      width,
      invert,
      order: z,
      pixelSpacing: [dx, dy],
      zSpacing: dz,
    };
  }
  return { meta: { count, rows, cols, dx, dy, dz, center, width, invert, hasRealSpacing }, slices };
}

// Sufijo del derivado lite hermano en storage (igual patrón que `.web.glb`).
export const CBCT_LITE_SUFFIX = ".lite.bin";
// Variante de ALTA resolución (opt-in "HD" en el visor): 384² en plano vs 256.
export const CBCT_LITE_HI_SUFFIX = ".lite-hi.bin";
export const CBCT_LITE_CONTENT_TYPE = "application/octet-stream";
