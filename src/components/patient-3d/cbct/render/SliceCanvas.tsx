"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SliceCanvas — pinta UN corte 2D (axial/coronal/sagital) del CBCT en un <canvas>
// desde los DecodedSlice (HU Int16) del cargador real (WS2-T7).
//
// Porta el rasterizado con PROPORCIÓN FÍSICA real + muestreo BILINEAL de
// DicomSetViewer (PixelSpacing × zSpacing), así el CBCT no sale deformado ni con
// escalones entre cortes. El raster mide 1px = el espaciado más fino del plano
// (acotado a MAXDIM) → su tamaño natural ES la "caja de imagen": el overlay de
// anotaciones de T5 se alinea contra esa misma caja (CSS object-fit: contain).
//
// Window/level: el modelo del visor rediseñado reduce HU a brillo/contraste
// (0..100). Aquí los mapeamos al window/level real (HU) alrededor de un window
// base del estudio (defaultCenter/defaultWidth, o el corte medio). El `preset`
// no se usa aquí: el panel (T6) lo traduce a brillo/contraste.
//
// Reglas del repo: tsconfig NO strict, SIN target ES2015 → bucles por índice.
// NOTA (decisión WS2-T7 "solo data"): este módulo queda LISTO; T5 lo enchufa al
// Stage como render real del corte. No se monta todavía en el visor en vivo.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { DecodedSlice } from "../../dicom-decode-core";
import type { HUState } from "../types";

export type SlicePlane = "axial" | "coronal" | "sagital";

export interface SliceCanvasProps {
  slices: DecodedSlice[];
  plane: SlicePlane;
  /** índice 1..N del corte (se clampa al rango del plano). */
  sliceIndex: number;
  hu: HUState;
  /** window/level base (HU) del estudio; si falta usa el corte medio. */
  defaultCenter?: number;
  defaultWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** reporta el tamaño natural del raster (caja de imagen) para alinear overlays. */
  onBox?: (w: number, h: number) => void;
}

const MAXDIM = 1024;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

// brillo/contraste ∈ [0,100], 50 = neutro → window/level (HU) alrededor del base:
//   center = baseC - ((brillo-50)/50) · baseW   (brillo↑ ⇒ más claro)
//   width  = baseW · (1.5 - contraste/100)       (contraste↑ ⇒ ventana angosta)
function huWindow(hu: HUState, baseC: number, baseW: number): { lo: number; span: number } {
  const brillo = clamp(hu.brillo, 0, 100);
  const contraste = clamp(hu.contraste, 0, 100);
  const center = baseC - ((brillo - 50) / 50) * baseW;
  let width = baseW * (1.5 - contraste / 100);
  if (width < 1) width = 1;
  return { lo: center - width / 2, span: width };
}

export function SliceCanvas({
  slices,
  plane,
  sliceIndex,
  hu,
  defaultCenter,
  defaultWidth,
  className,
  style,
  onBox,
}: SliceCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // onBox por ref: evita re-ejecutar el efecto si el padre pasa un closure nuevo.
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || slices.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cols = slices[0].cols;
    const rows = slices[0].rows;
    const depth = slices.length;
    const mid = Math.floor(depth / 2);
    const baseC = typeof defaultCenter === "number" ? defaultCenter : slices[mid].center;
    const baseW = typeof defaultWidth === "number" ? defaultWidth : slices[mid].width;
    const { lo, span } = huWindow(hu, baseC, baseW);
    const inv = slices[mid].invert;

    // Espaciado físico (mm). Lectura defensiva (cache vieja → isotrópico).
    const sp: any = slices[0];
    const psp = sp.pixelSpacing;
    const sx = psp && psp[0] > 0 ? psp[0] : 1; // mm por columna (X)
    const sy = psp && psp[1] > 0 ? psp[1] : 1; // mm por fila (Y)
    const zRaw = sp.zSpacing;
    const sz = zRaw && zRaw > 0 ? zRaw : sy; // mm entre cortes (Z)

    const toGray = (huv: number) => {
      let g = ((huv - lo) / (span || 1)) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      return inv ? 255 - g : g;
    };

    // Tamaño del raster: 1px = espaciado más fino del plano (acotado a MAXDIM).
    const raster = (nA: number, sA: number, nB: number, sB: number) => {
      const pmm = Math.min(sA, sB) || 1;
      let W = Math.max(1, Math.round((nA * sA) / pmm));
      let H = Math.max(1, Math.round((nB * sB) / pmm));
      const m = Math.max(W, H);
      if (m > MAXDIM) {
        const k = MAXDIM / m;
        W = Math.max(1, Math.round(W * k));
        H = Math.max(1, Math.round(H * k));
      }
      return { W, H };
    };

    const paint = (W: number, H: number, sample: (a: number, b: number) => number) => {
      canvas.width = W;
      canvas.height = H;
      const img = ctx.createImageData(W, H);
      const data = img.data;
      let j = 0;
      for (let b = 0; b < H; b++) {
        for (let a = 0; a < W; a++) {
          const g = toGray(sample(a, b));
          data[j] = data[j + 1] = data[j + 2] = g;
          data[j + 3] = 255;
          j += 4;
        }
      }
      ctx.putImageData(img, 0, 0);
      if (onBoxRef.current) onBoxRef.current(W, H);
    };

    if (plane === "axial") {
      // Plano (X,Y) en Z fijo: corte nativo, reescalado a proporción física.
      const z = clamp(Math.round(sliceIndex) - 1, 0, depth - 1);
      const px = slices[z].pixels;
      const { W, H } = raster(cols, sx, rows, sy);
      paint(W, H, (a, b) => {
        const fx = ((a + 0.5) * cols) / W - 0.5;
        const fy = ((b + 0.5) * rows) / H - 0.5;
        const x = clamp(fx, 0, cols - 1);
        const y = clamp(fy, 0, rows - 1);
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1 < cols ? x0 + 1 : x0;
        const y1 = y0 + 1 < rows ? y0 + 1 : y0;
        const tx = x - x0;
        const ty = y - y0;
        const r0 = y0 * cols;
        const r1 = y1 * cols;
        const top = px[r0 + x0] + (px[r0 + x1] - px[r0 + x0]) * tx;
        const bot = px[r1 + x0] + (px[r1 + x1] - px[r1 + x0]) * tx;
        return top + (bot - top) * ty;
      });
    } else if (plane === "coronal") {
      // Plano (X,Z) en Y fijo: ancho = X (cols·sx), alto = Z (depth·sz).
      const y = clamp(Math.round(sliceIndex) - 1, 0, rows - 1);
      const yb = y * cols;
      const { W, H } = raster(cols, sx, depth, sz);
      paint(W, H, (a, b) => {
        const fx = ((a + 0.5) * cols) / W - 0.5;
        const fz = ((b + 0.5) * depth) / H - 0.5;
        const x = clamp(fx, 0, cols - 1);
        const z = clamp(fz, 0, depth - 1);
        const x0 = Math.floor(x);
        const x1 = x0 + 1 < cols ? x0 + 1 : x0;
        const z0 = Math.floor(z);
        const z1 = z0 + 1 < depth ? z0 + 1 : z0;
        const tx = x - x0;
        const tz = z - z0;
        const p0 = slices[z0].pixels;
        const p1 = slices[z1].pixels;
        const top = p0[yb + x0] + (p0[yb + x1] - p0[yb + x0]) * tx;
        const bot = p1[yb + x0] + (p1[yb + x1] - p1[yb + x0]) * tx;
        return top + (bot - top) * tz;
      });
    } else {
      // sagital: plano (Y,Z) en X fijo: ancho = Y (rows·sy), alto = Z (depth·sz).
      const x = clamp(Math.round(sliceIndex) - 1, 0, cols - 1);
      const { W, H } = raster(rows, sy, depth, sz);
      paint(W, H, (a, b) => {
        const fy = ((a + 0.5) * rows) / W - 0.5;
        const fz = ((b + 0.5) * depth) / H - 0.5;
        const y = clamp(fy, 0, rows - 1);
        const z = clamp(fz, 0, depth - 1);
        const y0 = Math.floor(y);
        const y1 = y0 + 1 < rows ? y0 + 1 : y0;
        const z0 = Math.floor(z);
        const z1 = z0 + 1 < depth ? z0 + 1 : z0;
        const ty = y - y0;
        const tz = z - z0;
        const p0 = slices[z0].pixels;
        const p1 = slices[z1].pixels;
        const c0 = y0 * cols + x;
        const c1 = y1 * cols + x;
        const left = p0[c0] + (p0[c1] - p0[c0]) * ty;
        const right = p1[c0] + (p1[c1] - p1[c0]) * ty;
        return left + (right - left) * tz;
      });
    }
  }, [slices, plane, sliceIndex, hu, defaultCenter, defaultWidth]);

  return <canvas ref={ref} className={className} style={style} />;
}

export default SliceCanvas;
