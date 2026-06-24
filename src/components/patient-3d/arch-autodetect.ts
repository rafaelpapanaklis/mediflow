// Auto-detección de la CURVA DE LA ARCADA para la panorámica sintética (F4).
// Módulo PURO: sin React, sin DOM, sin RNG. Trabaja sobre el VolumeRef ya cargado
// en memoria (no recarga el .zip) y devuelve puntos de control en mm de mundo (XY),
// la MISMA convención que `panoramic-reslice.ts` y la cruz del MPR: mm = vox * spacing
// (vóxel 0 → 0 mm). El usuario puede editar esos puntos después (es solo un PRE-RELLENO).
//
// Método CLÁSICO (sin deep learning), el mismo que usa el software CBCT comercial
// (Planmeca/Carestream/Sirona/Anatomage), todo sobre el volumen ya decodificado:
//   1) BANDA Z con dientes: el esmalte es lo más denso → perfil de #vóxeles muy densos
//      por corte; se toma la banda alrededor del PICO (coronas/raíces), no todo el
//      volumen (evita base de cráneo/órbitas).
//   2) MIP AXIAL de esa banda sobre una rejilla ISOTRÓPICA en mm (≤ ~220²): máximo gris
//      por columna vertical (eje Z).
//   3) UMBRAL del MIP (Otsu + guarda de fracción) → máscara hueso/diente.
//   4) MORFOLOGÍA: closing (disco ~6 mm), componente conexa MÁS GRANDE, rellenar huecos.
//   5) LÍNEA CENTRAL por método POLAR (robusto): centro en la CONCAVIDAD de la U (no el
//      centroide de la máscara, que cae sobre el hueso). Por cada ángulo, el radial cruza
//      la banda → punto MEDIO de la banda. El sector de la abertura (sin banda) se omite solo.
//   6) AJUSTE + SUAVIZADO (media móvil) recortado a la extensión real (molar a molar).
//   7) ~9-11 PUNTOS equiespaciados por longitud de arco → Vec2[] en mm.
//
// Elegí POLAR sobre ESQUELETO por robustez: la arcada es una U casi convexa hacia afuera,
// así que desde un centro INTERIOR cada radial cruza la banda una sola vez y el orden sale
// directo del ángulo (sin thinning ni poda de espolones). El centro de la concavidad se
// halla de forma robusta y SIN suponer orientación: se "tapa" la abertura posterior con un
// closing grande y el hueco interior resultante (la boca) da el centro. Si algo falla, hay
// un FALLBACK por parábola de mínimos cuadrados en el marco PCA; si tampoco, devuelve null
// y la UI cae al trazado manual de hoy.

import type { Vec2, VolumeRef } from "./panoramic-reslice";

export interface ArchOptions {
  nPoints?: number; // puntos de control de salida (default 9)
  targetGrid?: number; // lado máximo de la rejilla MIP/morfología (default 220)
  closingMm?: number; // disco de closing de la banda dental (default 6)
  zBandMm?: number; // grosor máximo de la banda Z alrededor del pico (default 30)
}

/* -------------------------------------------------------------------------- */
/* Estadística por percentiles del volumen (submuestreo determinista)          */
/* -------------------------------------------------------------------------- */

// Mismo esquema que computeVolStats: submuestrea ~60k vóxeles con desfase primo por
// corte (sin RNG) y lee percentiles por índice. Sirve para el umbral "esmalte".
function samplePercentiles(vol: VolumeRef, ps: number[]): number[] | null {
  const { slices, depth } = vol;
  if (depth === 0 || !slices[0]) return null;
  const per = slices[0].length;
  if (per <= 0) return null;
  const target = 60000;
  let stride = Math.floor((depth * per) / target);
  if (stride < 1) stride = 1;
  const samples: number[] = [];
  for (let z = 0; z < depth; z++) {
    const px = slices[z];
    const len = px.length;
    for (let i = (z * 7919) % stride; i < len; i += stride) samples.push(px[i]);
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const n = samples.length;
  return ps.map((p) => {
    let k = Math.floor(p * (n - 1));
    if (k < 0) k = 0;
    else if (k > n - 1) k = n - 1;
    return samples[k];
  });
}

/* -------------------------------------------------------------------------- */
/* Banda Z (cortes con dientes)                                                */
/* -------------------------------------------------------------------------- */

function movingAvg(arr: number[], win: number): number[] {
  const n = arr.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        s += arr[j];
        c++;
      }
    }
    out[i] = c > 0 ? s / c : 0;
  }
  return out;
}

// Perfil de densidad por corte: #vóxeles que superan el umbral alto (esmalte). La banda
// es el tramo contiguo alrededor del pico por encima del 30% del pico, acotado en mm.
function detectZBand(
  vol: VolumeRef,
  thr: number,
  maxBandMm: number,
): { lo: number; hi: number } {
  const { depth, cols, rows, slices } = vol;
  const prof = new Array<number>(depth).fill(0);
  // Submuestreo en plano (stride 2 en X e Y) — solo importa la FORMA del perfil.
  for (let z = 0; z < depth; z++) {
    const px = slices[z];
    let c = 0;
    for (let y = 0; y < rows; y += 2) {
      const base = y * cols;
      for (let x = 0; x < cols; x += 2) {
        if (px[base + x] >= thr) c++;
      }
    }
    prof[z] = c;
  }
  const s = movingAvg(prof, 2);
  let peak = 0;
  let zp = 0;
  for (let z = 0; z < depth; z++) {
    if (s[z] > peak) {
      peak = s[z];
      zp = z;
    }
  }
  if (peak <= 0) return { lo: 0, hi: depth - 1 }; // sin pico → toda la profundidad
  const lim = peak * 0.3;
  let lo = zp;
  let hi = zp;
  while (lo - 1 >= 0 && s[lo - 1] >= lim) lo--;
  while (hi + 1 < depth && s[hi + 1] >= lim) hi++;
  const sz = vol.sz > 0 ? vol.sz : 1;
  const maxHalf = Math.max(2, Math.round(maxBandMm / 2 / sz));
  if (zp - lo > maxHalf) lo = zp - maxHalf;
  if (hi - zp > maxHalf) hi = zp + maxHalf;
  return { lo, hi };
}

/* -------------------------------------------------------------------------- */
/* MIP axial sobre rejilla ISOTRÓPICA en mm                                    */
/* -------------------------------------------------------------------------- */

interface MipGrid {
  grid: Float32Array; // gw*gh, máximo gris de la banda (gridMin en celdas vacías)
  gw: number;
  gh: number;
  cellMm: number; // mm por celda (isotrópico → morfología/polar limpias)
  gmin: number;
  gmax: number;
}

// MIP por max-pooling: cada celda de la rejilla toma el MÁXIMO de los vóxeles cuyo centro
// cae en ella (en X,Y) y de toda la banda Z. La rejilla está en mm: mm = gx*cellMm. Así
// convertir un punto de la rejilla a mm es solo multiplicar por cellMm (misma convención
// que controlMm). gx = round(vox*spacing/cellMm) = round(mm/cellMm).
function buildMip(vol: VolumeRef, band: { lo: number; hi: number }, targetGrid: number): MipGrid | null {
  const { cols, rows, slices } = vol;
  const sx = vol.sx > 0 ? vol.sx : 1;
  const sy = vol.sy > 0 ? vol.sy : 1;
  const Xspan = (cols - 1) * sx;
  const Yspan = (rows - 1) * sy;
  const maxSpan = Math.max(Xspan, Yspan);
  if (!(maxSpan > 0)) return null;
  const minSp = Math.min(sx, sy) || 1;
  // 1 celda = el espaciado más fino, salvo que el lado mayor exceda targetGrid (ahí se
  // agranda la celda para acotar la rejilla). Igual en ambos ejes → isotrópico en mm.
  const cellMm = Math.max(minSp, maxSpan / targetGrid);
  const gw = Math.floor(Xspan / cellMm) + 1;
  const gh = Math.floor(Yspan / cellMm) + 1;
  if (gw < 4 || gh < 4) return null;

  // Mapas vóxel→celda precomputados (no recalcular en el bucle Z).
  const gxOf = new Int32Array(cols);
  for (let x = 0; x < cols; x++) {
    let g = Math.round((x * sx) / cellMm);
    if (g < 0) g = 0;
    else if (g > gw - 1) g = gw - 1;
    gxOf[x] = g;
  }
  const gyOf = new Int32Array(rows);
  for (let y = 0; y < rows; y++) {
    let g = Math.round((y * sy) / cellMm);
    if (g < 0) g = 0;
    else if (g > gh - 1) g = gh - 1;
    gyOf[y] = g;
  }

  const grid = new Float32Array(gw * gh).fill(-Infinity);
  for (let z = band.lo; z <= band.hi; z++) {
    const px = slices[z];
    for (let y = 0; y < rows; y++) {
      const base = y * cols;
      const row = gyOf[y] * gw;
      for (let x = 0; x < cols; x++) {
        const v = px[base + x];
        const gi = row + gxOf[x];
        if (v > grid[gi]) grid[gi] = v;
      }
    }
  }

  // Celdas nunca escritas → fondo (mínimo de las escritas). Min/max global de la rejilla.
  let gmin = Infinity;
  let gmax = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === -Infinity) continue;
    if (v < gmin) gmin = v;
    if (v > gmax) gmax = v;
  }
  if (!(gmax > gmin)) return null;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === -Infinity) grid[i] = gmin;
  }
  return { grid, gw, gh, cellMm, gmin, gmax };
}

/* -------------------------------------------------------------------------- */
/* Umbral del MIP (Otsu + guarda de fracción de primer plano)                  */
/* -------------------------------------------------------------------------- */

function percentileOfGrid(grid: Float32Array, p: number): number {
  const a = Array.from(grid);
  a.sort((x, y) => x - y);
  let k = Math.floor(p * (a.length - 1));
  if (k < 0) k = 0;
  else if (k > a.length - 1) k = a.length - 1;
  return a[k];
}

function thresholdMip(m: MipGrid): Uint8Array {
  const { grid, gmin, gmax } = m;
  const B = 256;
  const span = gmax - gmin || 1;
  const hist = new Float64Array(B);
  const binOf = (v: number) => {
    let b = Math.floor(((v - gmin) / span) * (B - 1));
    if (b < 0) b = 0;
    else if (b > B - 1) b = B - 1;
    return b;
  };
  for (let i = 0; i < grid.length; i++) hist[binOf(grid[i])]++;
  const total = grid.length;
  // Otsu: maximiza la varianza entre clases.
  let sum = 0;
  for (let b = 0; b < B; b++) sum += b * hist[b];
  let wB = 0;
  let sumB = 0;
  let maxVar = -1;
  let thrB = 0;
  for (let b = 0; b < B; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thrB = b;
    }
  }
  let thr = gmin + (thrB / (B - 1)) * span;
  // Guarda: el MIP tiene muchas celdas de fondo (un pico en el bin 0) → Otsu suele separar
  // fondo de "todo lo demás" e incluir tejido blando. Si el primer plano es demasiado amplio
  // o demasiado escaso, se reemplaza por un percentil (quedarnos con lo más denso = arcada).
  const fracOf = (t: number) => {
    let c = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] >= t) c++;
    return c / total;
  };
  const f = fracOf(thr);
  if (f > 0.45) thr = percentileOfGrid(grid, 0.8);
  else if (f < 0.04) thr = percentileOfGrid(grid, 0.9);
  const mask = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) mask[i] = grid[i] >= thr ? 1 : 0;
  return mask;
}

/* -------------------------------------------------------------------------- */
/* Morfología (todo sobre transformada de distancia chamfer → O(n) por radio)  */
/* -------------------------------------------------------------------------- */

// Distancia (px) de cada celda a la celda `true` más cercana. Chamfer 2 pasos (1, √2).
function distToTrue(mask: Uint8Array, gw: number, gh: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      let v = d[i];
      if (x > 0 && d[i - 1] + a < v) v = d[i - 1] + a;
      if (y > 0 && d[i - gw] + a < v) v = d[i - gw] + a;
      if (x > 0 && y > 0 && d[i - gw - 1] + b < v) v = d[i - gw - 1] + b;
      if (x < gw - 1 && y > 0 && d[i - gw + 1] + b < v) v = d[i - gw + 1] + b;
      d[i] = v;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      let v = d[i];
      if (x < gw - 1 && d[i + 1] + a < v) v = d[i + 1] + a;
      if (y < gh - 1 && d[i + gw] + a < v) v = d[i + gw] + a;
      if (x < gw - 1 && y < gh - 1 && d[i + gw + 1] + b < v) v = d[i + gw + 1] + b;
      if (x > 0 && y < gh - 1 && d[i + gw - 1] + b < v) v = d[i + gw - 1] + b;
      d[i] = v;
    }
  }
  return d;
}

function dilate(mask: Uint8Array, gw: number, gh: number, r: number): Uint8Array {
  const d = distToTrue(mask, gw, gh);
  const o = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) o[i] = d[i] <= r ? 1 : 0;
  return o;
}

function erode(mask: Uint8Array, gw: number, gh: number, r: number): Uint8Array {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = distToTrue(inv, gw, gh);
  const o = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) o[i] = d[i] > r ? 1 : 0;
  return o;
}

function closing(mask: Uint8Array, gw: number, gh: number, r: number): Uint8Array {
  return erode(dilate(mask, gw, gh, r), gw, gh, r);
}

// Rellena huecos: inunda el fondo desde el borde; el fondo no alcanzado = hueco → 1.
function fillHoles(mask: Uint8Array, gw: number, gh: number): Uint8Array {
  const reach = new Uint8Array(mask.length);
  const st: number[] = [];
  const tryPush = (x: number, y: number) => {
    const i = y * gw + x;
    if (!mask[i] && !reach[i]) {
      reach[i] = 1;
      st.push(i);
    }
  };
  for (let x = 0; x < gw; x++) {
    tryPush(x, 0);
    tryPush(x, gh - 1);
  }
  for (let y = 0; y < gh; y++) {
    tryPush(0, y);
    tryPush(gw - 1, y);
  }
  while (st.length) {
    const i = st.pop() as number;
    const x = i % gw;
    const y = (i / gw) | 0;
    if (x > 0) tryPush(x - 1, y);
    if (x < gw - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < gh - 1) tryPush(x, y + 1);
  }
  const o = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) o[i] = mask[i] || !reach[i] ? 1 : 0;
  return o;
}

interface Component {
  mask: Uint8Array;
  size: number;
  cx: number;
  cy: number;
}

// Componente conexa MÁS GRANDE (8-conexa) + su centroide y tamaño.
function largestComponent(mask: Uint8Array, gw: number, gh: number): Component {
  const lab = new Int32Array(mask.length);
  let cur = 0;
  let bestLab = 0;
  let bestSize = 0;
  let bestCx = 0;
  let bestCy = 0;
  const st: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s]) continue;
    cur++;
    let size = 0;
    let sumX = 0;
    let sumY = 0;
    lab[s] = cur;
    st.length = 0;
    st.push(s);
    while (st.length) {
      const i = st.pop() as number;
      const x = i % gw;
      const y = (i / gw) | 0;
      size++;
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= gw) continue;
          const j = ny * gw + nx;
          if (mask[j] && !lab[j]) {
            lab[j] = cur;
            st.push(j);
          }
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLab = cur;
      bestCx = sumX / size;
      bestCy = sumY / size;
    }
  }
  const o = new Uint8Array(mask.length);
  if (bestLab) for (let i = 0; i < mask.length; i++) o[i] = lab[i] === bestLab ? 1 : 0;
  return { mask: o, size: bestSize, cx: bestCx, cy: bestCy };
}

/* -------------------------------------------------------------------------- */
/* Centro de la CONCAVIDAD (interior de la U) — sin suponer orientación        */
/* -------------------------------------------------------------------------- */

// Se "tapa" la abertura posterior con un closing grande y se rellenan huecos: el interior
// de la boca queda como una región cerrada. interior = tapado AND NOT arcada; su componente
// más grande es el espacio bucal y su centroide es un centro polar EXCELENTE (dentro de la U).
function concavityCenter(
  arch: Uint8Array,
  gw: number,
  gh: number,
  cellMm: number,
  fallbackCx: number,
  fallbackCy: number,
): { cx: number; cy: number } {
  const bigR = Math.min(Math.max(gw, gh), Math.round(25 / cellMm)); // tapa hasta ~50 mm de abertura
  const closed = fillHoles(closing(arch, gw, gh, bigR), gw, gh);
  const interior = new Uint8Array(arch.length);
  for (let i = 0; i < arch.length; i++) interior[i] = closed[i] && !arch[i] ? 1 : 0;
  const cc = largestComponent(interior, gw, gh);
  if (cc.size > 8) return { cx: cc.cx, cy: cc.cy };
  return { cx: fallbackCx, cy: fallbackCy }; // degenerado → centroide de la arcada
}

/* -------------------------------------------------------------------------- */
/* Línea central por método POLAR                                              */
/* -------------------------------------------------------------------------- */

// Por cada ángulo el radial cruza la banda dental: se toma el punto MEDIO del tramo de
// primer plano MÁS LARGO (centro de la banda). La abertura posterior queda como el mayor
// hueco angular → se corta ahí para entregar una polilínea abierta de molar a molar.
function polarCenterline(mask: Uint8Array, gw: number, gh: number, cx: number, cy: number): Vec2[] {
  let maxR = 0;
  for (const [x, y] of [
    [0, 0],
    [gw - 1, 0],
    [0, gh - 1],
    [gw - 1, gh - 1],
  ]) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > maxR) maxR = d;
  }
  const rStep = 0.7;
  const angStepDeg = 1.5;
  const nAng = Math.round(360 / angStepDeg);
  const midR: number[] = new Array(nAng).fill(-1);
  for (let ai = 0; ai < nAng; ai++) {
    const ang = (ai * angStepDeg * Math.PI) / 180;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    let bestA = -1;
    let bestB = -1;
    let bestLen = 0;
    let runA = -1;
    let prev = 0;
    for (let r = 0; r <= maxR; r += rStep) {
      const x = Math.round(cx + ca * r);
      const y = Math.round(cy + sa * r);
      const fg = x >= 0 && x < gw && y >= 0 && y < gh ? mask[y * gw + x] : 0;
      if (fg && !prev) runA = r;
      if (!fg && prev) {
        const len = r - rStep - runA;
        if (len > bestLen) {
          bestLen = len;
          bestA = runA;
          bestB = r - rStep;
        }
      }
      prev = fg;
    }
    if (prev) {
      const len = maxR - runA;
      if (len > bestLen) {
        bestLen = len;
        bestA = runA;
        bestB = maxR;
      }
    }
    if (bestLen > 0) midR[ai] = (bestA + bestB) / 2;
  }

  // Mayor hueco angular cíclico (la abertura) → punto de corte.
  let bestGapStart = 0;
  let bestGapLen = -1;
  let runStart = -1;
  let runLen = 0;
  for (let k = 0; k < nAng * 2; k++) {
    const ai = k % nAng;
    if (midR[ai] < 0) {
      if (runLen === 0) runStart = ai;
      runLen++;
      if (runLen > bestGapLen) {
        bestGapLen = runLen;
        bestGapStart = runStart;
      }
    } else {
      runLen = 0;
    }
    if (k >= nAng && runLen === 0) break; // ya cerramos el ciclo
  }
  const startAi = bestGapLen > 0 ? (bestGapStart + bestGapLen) % nAng : 0;

  const pts: Vec2[] = [];
  for (let k = 0; k < nAng; k++) {
    const ai = (startAi + k) % nAng;
    const r = midR[ai];
    if (r < 0) continue;
    const ang = (ai * angStepDeg * Math.PI) / 180;
    pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }
  return pts;
}

/* -------------------------------------------------------------------------- */
/* Suavizado + remuestreo por longitud de arco                                 */
/* -------------------------------------------------------------------------- */

function smoothPts(pts: Vec2[], win: number): Vec2[] {
  const n = pts.length;
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        sx += pts[j].x;
        sy += pts[j].y;
        c++;
      }
    }
    out[i] = { x: sx / c, y: sy / c };
  }
  return out;
}

function resampleByArc(pts: Vec2[], n: number): Vec2[] {
  if (pts.length <= 1) return pts.map((p) => ({ ...p }));
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [{ ...pts[0] }];
  const out: Vec2[] = [];
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const s = (total * j) / (n - 1);
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const f = segLen > 1e-9 ? (s - cum[seg]) / segLen : 0;
    out.push({
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Fallback: parábola por mínimos cuadrados en el marco PCA                     */
/* -------------------------------------------------------------------------- */

// Si el polar no entrega una curva fiable, se ajusta una parábola v = a·u² + b·u + c en el
// marco PCA de la máscara (u = eje mayor = ancho de la arcada). Robusto a la orientación.
function parabolaFallback(mask: Uint8Array, gw: number, gh: number, n: number): Vec2[] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  let mx = 0;
  let my = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (mask[y * gw + x]) {
        xs.push(x);
        ys.push(y);
        mx += x;
        my += y;
      }
    }
  }
  const cnt = xs.length;
  if (cnt < 12) return null;
  mx /= cnt;
  my /= cnt;
  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
  for (let k = 0; k < cnt; k++) {
    const dx = xs[k] - mx;
    const dy = ys[k] - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  cxx /= cnt;
  cxy /= cnt;
  cyy /= cnt;
  // Autovector mayor de [[cxx,cxy],[cxy,cyy]].
  const tr = cxx + cyy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (cxx * cyy - cxy * cxy)));
  const l1 = tr / 2 + disc;
  let ex = cxy;
  let ey = l1 - cxx;
  if (Math.hypot(ex, ey) < 1e-6) {
    ex = 1;
    ey = 0;
  }
  const el = Math.hypot(ex, ey);
  ex /= el;
  ey /= el;
  const fx = -ey;
  const fy = ex;
  // Mínimos cuadrados v = a u² + b u + c (ecuaciones normales 3×3, Cramer).
  let Su4 = 0;
  let Su3 = 0;
  let Su2 = 0;
  let Su1 = 0;
  let Su2v = 0;
  let Suv = 0;
  let Sv = 0;
  const us: number[] = new Array(cnt);
  for (let k = 0; k < cnt; k++) {
    const dx = xs[k] - mx;
    const dy = ys[k] - my;
    const u = dx * ex + dy * ey;
    const v = dx * fx + dy * fy;
    us[k] = u;
    const u2 = u * u;
    Su4 += u2 * u2;
    Su3 += u2 * u;
    Su2 += u2;
    Su1 += u;
    Su2v += u2 * v;
    Suv += u * v;
    Sv += v;
  }
  const det3 = (
    a: number, b: number, c: number,
    d: number, e: number, f: number,
    g: number, h: number, i: number,
  ) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const D = det3(Su4, Su3, Su2, Su3, Su2, Su1, Su2, Su1, cnt);
  if (Math.abs(D) < 1e-9) return null;
  const Da = det3(Su2v, Su3, Su2, Suv, Su2, Su1, Sv, Su1, cnt);
  const Db = det3(Su4, Su2v, Su2, Su3, Suv, Su1, Su2, Sv, cnt);
  const Dc = det3(Su4, Su3, Su2v, Su3, Su2, Suv, Su2, Su1, Sv);
  const a = Da / D;
  const b = Db / D;
  const c = Dc / D;
  // Rango de u recortado (p05..p95) para no extrapolar más allá de la dentición.
  const usort = us.slice().sort((p, q) => p - q);
  const uLo = usort[Math.floor(0.05 * (cnt - 1))];
  const uHi = usort[Math.floor(0.95 * (cnt - 1))];
  if (!(uHi > uLo)) return null;
  const out: Vec2[] = [];
  for (let j = 0; j < n; j++) {
    const u = uLo + ((uHi - uLo) * j) / (n - 1);
    const v = a * u * u + b * u + c;
    out.push({ x: mx + u * ex + v * fx, y: my + u * ey + v * fy });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Orquestación                                                                */
/* -------------------------------------------------------------------------- */

// Detecta la curva de la arcada y devuelve ~nPoints puntos de control en mm de mundo (XY).
// Determinista. Devuelve null si no logra una curva fiable (la UI cae al trazado manual).
export function autoDetectArch(vol: VolumeRef, opts?: ArchOptions): Vec2[] | null {
  const nPoints = Math.max(5, Math.min(15, opts?.nPoints ?? 9));
  const targetGrid = opts?.targetGrid ?? 220;
  const closingMm = opts?.closingMm ?? 6;
  const zBandMm = opts?.zBandMm ?? 30;

  // Guardas de tamaño mínimo: sin esto no hay arcada que detectar.
  if (!vol || !vol.slices || vol.cols < 8 || vol.rows < 8 || vol.depth < 4) return null;

  // 1) Umbral "esmalte" (percentil alto) → banda Z con dientes.
  const pcts = samplePercentiles(vol, [0.99]);
  if (!pcts) return null;
  const band = detectZBand(vol, pcts[0], zBandMm);

  // 2) MIP axial isotrópico de la banda.
  const mip = buildMip(vol, band, targetGrid);
  if (!mip) return null;
  const { gw, gh, cellMm } = mip;

  // 3) Umbral del MIP → 4) morfología: closing, componente más grande, rellenar huecos.
  const thr = thresholdMip(mip);
  const closeR = Math.max(1, Math.round(closingMm / cellMm));
  const cc = largestComponent(closing(thr, gw, gh, closeR), gw, gh);
  // Demasiado pequeña (ruido) o casi todo el FOV (umbral fallido) → fallback/null.
  const frac = cc.size / (gw * gh);
  if (cc.size < 16 || frac > 0.85) {
    const fb = parabolaFallback(thr, gw, gh, nPoints);
    return fb ? fb.map((p) => ({ x: p.x * cellMm, y: p.y * cellMm })) : null;
  }
  const arch = fillHoles(cc.mask, gw, gh);

  // 5) Centro de la concavidad + línea central polar.
  const center = concavityCenter(arch, gw, gh, cellMm, cc.cx, cc.cy);
  const raw = polarCenterline(arch, gw, gh, center.cx, center.cy);

  // 6) Si el polar no cuaja (<5 puntos) → parábola. 7) Suavizar + remuestrear.
  let line = raw;
  if (line.length < 5) {
    const fb = parabolaFallback(arch, gw, gh, nPoints);
    if (!fb) return raw.length >= 3 ? finalize(raw, nPoints, cellMm) : null;
    line = fb;
  }
  return finalize(line, nPoints, cellMm);
}

// Suaviza, remuestrea a nPoints y convierte de rejilla (px isotrópicos) a mm de mundo.
function finalize(line: Vec2[], nPoints: number, cellMm: number): Vec2[] | null {
  if (line.length < 3) return null;
  const smooth = smoothPts(line, 2);
  const sampled = resampleByArc(smooth, Math.min(nPoints, Math.max(3, smooth.length)));
  if (sampled.length < 3) return null;
  return sampled.map((p) => ({ x: p.x * cellMm, y: p.y * cellMm }));
}
