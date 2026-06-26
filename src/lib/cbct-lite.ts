// Generador SERVER-ONLY del CBCT "lite": descomprime el .zip del estudio, decodifica
// los cortes (reutilizando el núcleo DICOM del visor, que corre igual en Node) y
// produce un volumen REDUCIDO (~256×256 × ~180 cortes) empaquetado con
// encodeCbctLite. El móvil descarga ESE binario (~10-25 MB) en lugar de los
// 300-600 MB originales, que no caben en la RAM de un iPhone.
//
// Memoria: NO acumula el estudio full-res. Decodifica corte a corte y reduce en
// plano (XY) AL VUELO, reteniendo solo los cortes ya pequeños; el submuestreo en
// Z se aplica después de ordenar. Así el pico del servidor queda muy por debajo
// del estudio completo (cabe holgado en los ~3 GB de una función Vercel Pro).
//
// Patrón análogo al de src/lib/mesh-to-glb.ts (derivado web generado en servidor).

import JSZip from "jszip";
import {
  decodeSliceAsync,
  isDicomEntryName,
  type DecodedSlice,
} from "@/components/patient-3d/dicom-decode-core";
import { encodeCbctLite, type CbctLiteMeta } from "@/components/patient-3d/cbct-lite-shared";

// Topes del volumen lite. ~256² en plano × ~180 cortes Int16 ≈ 23 MB máx.
const TARGET_XY = 256;
const TARGET_Z = 180;

// Box-average de un corte Int16 (rows×cols) a (rows/yStep)×(cols/xStep). Promediar
// (no decimar) reduce el aliasing y conserva trabéculas. No-op si los factores son 1.
function downsampleSliceXY(
  px: Int16Array,
  rows: number,
  cols: number,
  xStep: number,
  yStep: number,
): { pixels: Int16Array; rows: number; cols: number } {
  if (xStep <= 1 && yStep <= 1) return { pixels: px, rows, cols };
  const W = Math.max(1, Math.floor(cols / xStep));
  const H = Math.max(1, Math.floor(rows / yStep));
  const out = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = y * yStep;
    for (let x = 0; x < W; x++) {
      const x0 = x * xStep;
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < yStep; dy++) {
        const r = y0 + dy;
        if (r >= rows) break;
        const rowOff = r * cols;
        for (let dx = 0; dx < xStep; dx++) {
          const c = x0 + dx;
          if (c >= cols) break;
          sum += px[rowOff + c];
          n++;
        }
      }
      out[y * W + x] = n > 0 ? Math.round(sum / n) : 0;
    }
  }
  return { pixels: out, rows: H, cols: W };
}

interface ReducedSlice {
  pixels: Int16Array;
  rows: number;
  cols: number;
  order: number;
  center: number;
  width: number;
  invert: boolean;
  pixelSpacing: [number, number];
  zSpacing: number;
}

export interface BuildCbctLiteResult {
  bytes: Uint8Array;
  meta: CbctLiteMeta;
  sourceSlices: number; // cortes del estudio ANTES del submuestreo en Z (para logging)
}

/**
 * Construye el binario lite a partir del .zip del CBCT. Lanza con un mensaje claro
 * si el zip no trae cortes legibles. `input` acepta lo que JSZip entiende (Blob /
 * ArrayBuffer / Uint8Array) — en el endpoint llega el Blob de Supabase Storage.
 */
export async function buildCbctLite(input: ArrayBuffer | Uint8Array | Blob): Promise<BuildCbctLiteResult> {
  // JSZip en Node NO soporta Blob (su lectura de Blob usa FileReader, solo navegador).
  // supabase.storage.download() devuelve un Blob -> convertir a Uint8Array, o JSZip lanza
  // "Can't read the data of the loaded zip file".
  const zipInput =
    input instanceof Uint8Array || input instanceof ArrayBuffer
      ? input
      : new Uint8Array(await (input as Blob).arrayBuffer());
  const zip = await JSZip.loadAsync(zipInput);
  const entries = (Object.values(zip.files) as any[]).filter((f) => !f.dir && isDicomEntryName(f.name));
  if (entries.length === 0) throw new Error("El .zip no contiene cortes DICOM legibles");

  // 1) Decodifica cada entrada y reduce XY AL VUELO (descarta el full-res).
  let xStep = 0;
  let yStep = 0;
  let baseRows = 0;
  let baseCols = 0;
  const reduced: ReducedSlice[] = [];
  for (const entry of entries) {
    let frames: DecodedSlice[] | null = null;
    try {
      const buf: ArrayBuffer = await entry.async("arraybuffer");
      frames = await decodeSliceAsync(buf, reduced.length);
    } catch {
      frames = null; // corte inválido / comprimido no soportado: se salta
    }
    if (!frames) continue;
    for (const s of frames) {
      if (baseRows === 0) {
        baseRows = s.rows;
        baseCols = s.cols;
        xStep = Math.max(1, Math.ceil(s.cols / TARGET_XY));
        yStep = Math.max(1, Math.ceil(s.rows / TARGET_XY));
      }
      // CBCT real es homogéneo; un corte de dims distintas (raro) se omite para
      // mantener el volumen rectangular.
      if (s.rows !== baseRows || s.cols !== baseCols) continue;
      const ds = downsampleSliceXY(s.pixels, s.rows, s.cols, xStep, yStep);
      reduced.push({
        pixels: ds.pixels,
        rows: ds.rows,
        cols: ds.cols,
        order: s.order,
        center: s.center,
        width: s.width,
        invert: s.invert,
        pixelSpacing: s.pixelSpacing,
        zSpacing: s.zSpacing,
      });
    }
  }
  if (reduced.length === 0) throw new Error("No se pudo decodificar ningún corte del estudio");

  // 2) Orden Z real por `order` (el zip puede traer los cortes desordenados).
  reduced.sort((a, b) => a.order - b.order);

  // 3) Submuestreo en Z: 1 de cada zStep para no pasar de TARGET_Z cortes.
  const zStep = Math.max(1, Math.ceil(reduced.length / TARGET_Z));
  const picked: ReducedSlice[] = [];
  for (let i = 0; i < reduced.length; i += zStep) picked.push(reduced[i]);

  const count = picked.length;
  const rows = picked[0].rows;
  const cols = picked[0].cols;
  const per = rows * cols;

  // 4) Concatena los píxeles + spacing físico AJUSTADO por los factores de reducción
  //    (cada vóxel del lite cubre xStep/yStep/zStep vóxeles originales, así que el mm
  //    por vóxel se multiplica — las proporciones físicas se conservan).
  const voxels = new Int16Array(count * per);
  for (let z = 0; z < count; z++) {
    const p = picked[z].pixels;
    voxels.set(p.length === per ? p : p.subarray(0, per), z * per);
  }
  const base = picked[0];
  const ps = base.pixelSpacing || [1, 1];
  const hasRealSpacing = !!(ps && (ps[0] !== 1 || ps[1] !== 1));
  const mid = picked[Math.floor(count / 2)] || base;
  const meta: CbctLiteMeta = {
    count,
    rows,
    cols,
    dx: (ps[0] || 1) * xStep,
    dy: (ps[1] || 1) * yStep,
    dz: (base.zSpacing || 1) * zStep,
    center: mid.center,
    width: mid.width,
    invert: base.invert,
    hasRealSpacing,
  };
  return { bytes: encodeCbctLite(meta, voxels), meta, sourceSlices: reduced.length };
}
