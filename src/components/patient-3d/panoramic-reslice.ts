// Reslice CURVO (panorámica sintética) del volumen CBCT — F4, pieza 1.
// Módulo PURO: sin React, sin DOM. Solo geometría física (mm) y muestreo del
// volumen ya decodificado en memoria. Lo consume PanoramicPane (la capa React).
//
// Idea clínica: una panorámica (ortopantomografía) "aplana" la arcada dental. Aquí
// se reconstruye sintéticamente a partir del CBCT: el usuario traza la curva de la
// arcada sobre el corte AXIAL (puntos de control → spline Catmull-Rom), y por cada
// estación equiespaciada a lo largo de esa curva se muestrea una columna vertical
// del volumen (eje Z). El "slab" integra a lo largo de la NORMAL a la curva (grosor
// bucco-lingual) en modo MIP o PROMEDIO, para incluir el espesor del hueso/diente.
//
// Convención de coordenadas (la MISMA que usa la cruz del MPR):
//   - índice de vóxel (continuo) ↔ mundo en mm:  mm = vox * spacing   (vox = mm / spacing)
//     (eje X = columnas·sx, eje Y = filas·sy, eje Z = cortes·sz). Sin origen absoluto:
//     solo importan distancias relativas, así que el vóxel 0 cae en 0 mm.
// NO se inventa otra escala: sx/sy/sz vienen del ScaleInfo ya resuelto del estudio.

export interface Vec2 {
  x: number;
  y: number;
}

// El volumen ya cargado: un Int16Array de píxeles por corte (z) + dimensiones y
// espaciado físico. Se REUSA el volumen en memoria (no se recarga el .zip).
export interface VolumeRef {
  slices: Int16Array[]; // pixels[z][y*cols + x]
  cols: number; // nx (eje X)
  rows: number; // ny (eje Y)
  depth: number; // nz (eje Z) = slices.length
  sx: number; // mm por columna
  sy: number; // mm por fila
  sz: number; // mm entre cortes
}

export type SlabMode = "mip" | "avg";

export interface PanoOptions {
  controlMm: Vec2[]; // puntos de control de la arcada, en mm de mundo (XY)
  slabMm: number; // grosor bucco-lingual integrado a lo largo de la normal
  mode: SlabMode; // MIP (máximo) o PROMEDIO a lo largo del slab
  maxDim?: number; // cota de tamaño del raster de salida (rendimiento). Default 560.
}

export interface PanoResult {
  data: Float32Array; // W*H valores de gris CRUDOS (NaN = fuera del volumen)
  W: number;
  H: number;
  pxMm: number; // mm por píxel (igual en ambos ejes → proporción física real)
  totalArcMm: number; // longitud total de la curva (eje horizontal en mm)
  heightMm: number; // altura física del volumen en Z (eje vertical en mm)
}

// Polilínea densa derivada del spline + tabla de longitud de arco acumulada.
export interface DensePolyline {
  pts: Vec2[];
  cum: number[]; // cum[i] = longitud acumulada hasta pts[i] (cum[0] = 0)
  total: number;
}

const SLAB_STEP_CAP = 64; // tope de muestras a lo largo de la normal (rendimiento)

/* -------------------------------------------------------------------------- */
/* Spline Catmull-Rom (uniforme) + reparametrización por longitud de arco      */
/* -------------------------------------------------------------------------- */

// Catmull-Rom uniforme. Para los extremos se duplica el punto vecino (tangente
// natural en las puntas). Con 2 puntos degenera en una curva suave entre ellos;
// la UI exige ≥3 para una arcada real.
export function catmullRom(points: Vec2[], samplesPerSeg: number): Vec2[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...points[0] }];
  const seg = Math.max(2, Math.floor(samplesPerSeg));
  const out: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1 < 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 > n - 1 ? n - 1 : i + 2];
    for (let k = 0; k < seg; k++) {
      const t = k / seg;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  out.push({ ...points[n - 1] }); // cierra exactamente en el último control
  return out;
}

// Densifica el spline y construye la tabla de longitud de arco.
export function densify(control: Vec2[], samplesPerSeg = 24): DensePolyline {
  const pts = catmullRom(control, samplesPerSeg);
  const cum: number[] = new Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cum[i] = cum[i - 1] + Math.hypot(dx, dy);
  }
  return { pts, cum, total: pts.length ? cum[pts.length - 1] : 0 };
}

// Posición + tangente UNITARIA a la longitud de arco s (mm), acotada a [0,total].
export function sampleAtArc(poly: DensePolyline, s: number): { pos: Vec2; tan: Vec2 } {
  const { pts, cum, total } = poly;
  if (pts.length === 1) return { pos: { ...pts[0] }, tan: { x: 1, y: 0 } };
  const ss = s < 0 ? 0 : s > total ? total : s;
  // Búsqueda binaria del segmento [j, j+1] que contiene ss.
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < ss) lo = mid + 1;
    else hi = mid;
  }
  let j = lo > 0 ? lo - 1 : 0;
  if (j >= pts.length - 1) j = pts.length - 2;
  const segLen = cum[j + 1] - cum[j];
  const f = segLen > 1e-9 ? (ss - cum[j]) / segLen : 0;
  const ax = pts[j].x;
  const ay = pts[j].y;
  const bx = pts[j + 1].x;
  const by = pts[j + 1].y;
  let tx = bx - ax;
  let ty = by - ay;
  const len = Math.hypot(tx, ty);
  if (len > 1e-9) {
    tx /= len;
    ty /= len;
  } else {
    tx = 1;
    ty = 0;
  }
  return { pos: { x: ax + (bx - ax) * f, y: ay + (by - ay) * f }, tan: { x: tx, y: ty } };
}

/* -------------------------------------------------------------------------- */
/* Muestreo trilineal del volumen (bilineal en XY + lineal entre cortes Z)      */
/* -------------------------------------------------------------------------- */

// Valor de gris en el índice de vóxel CONTINUO (x,y,z). Devuelve null si el centro
// cae fuera del volumen (para no contaminar el slab con bordes). Mismo esquema de
// interpolación/recorte de vecinos que usan los planos coronal/sagital del MPR.
function trilinear(vol: VolumeRef, x: number, y: number, z: number): number | null {
  const { cols, rows, depth } = vol;
  if (x < 0 || y < 0 || z < 0 || x > cols - 1 || y > rows - 1 || z > depth - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1 < cols ? x0 + 1 : x0;
  const y1 = y0 + 1 < rows ? y0 + 1 : y0;
  const z1 = z0 + 1 < depth ? z0 + 1 : z0;
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const p0 = vol.slices[z0];
  const p1 = vol.slices[z1];
  const r0 = y0 * cols;
  const r1 = y1 * cols;
  // bilineal dentro de cada corte
  const a0 = p0[r0 + x0] + (p0[r0 + x1] - p0[r0 + x0]) * tx;
  const b0 = p0[r1 + x0] + (p0[r1 + x1] - p0[r1 + x0]) * tx;
  const v0 = a0 + (b0 - a0) * ty;
  const a1 = p1[r0 + x0] + (p1[r0 + x1] - p1[r0 + x0]) * tx;
  const b1 = p1[r1 + x0] + (p1[r1 + x1] - p1[r1 + x0]) * tx;
  const v1 = a1 + (b1 - a1) * ty;
  return v0 + (v1 - v0) * tz; // lineal entre cortes (Z)
}

/* -------------------------------------------------------------------------- */
/* Reslice panorámico                                                          */
/* -------------------------------------------------------------------------- */

// Genera la panorámica sintética. Devuelve null si faltan datos (curva con <2
// puntos, longitud nula o volumen sin profundidad). El resultado son valores de
// gris CRUDOS; el window/level se aplica al PINTAR (cambiar brillo no re-resamplea).
export function reslicePanoramic(vol: VolumeRef, opts: PanoOptions): PanoResult | null {
  const { controlMm, slabMm, mode } = opts;
  if (!controlMm || controlMm.length < 2) return null;
  if (vol.depth < 2 || vol.cols < 2 || vol.rows < 2) return null;

  const poly = densify(controlMm, 24);
  const total = poly.total;
  if (!(total > 1e-6)) return null;

  const sx = vol.sx > 0 ? vol.sx : 1;
  const sy = vol.sy > 0 ? vol.sy : 1;
  const sz = vol.sz > 0 ? vol.sz : 1;
  const minSp = Math.min(sx, sy, sz) || 1;

  const heightMm = (vol.depth - 1) * sz;
  const maxDim = opts.maxDim && opts.maxDim > 0 ? opts.maxDim : 560;
  const longest = Math.max(total, heightMm);
  // 1 px = el espaciado más fino, salvo que el lado más largo exceda maxDim (ahí se
  // agranda el px para acotar el raster). Igual en ambos ejes → proporción real.
  const pxMm = Math.max(minSp, longest / maxDim);

  const W = Math.max(2, Math.round(total / pxMm) + 1);
  const H = Math.max(2, Math.round(heightMm / pxMm) + 1);

  // Muestras a lo largo de la normal (slab). 1 sola si el grosor no llega a 1 px.
  const half = slabMm > 0 ? slabMm / 2 : 0;
  let nSlab = slabMm > pxMm ? Math.floor(slabMm / pxMm) + 1 : 1;
  if (nSlab > SLAB_STEP_CAP) nSlab = SLAB_STEP_CAP;
  if (nSlab < 1) nSlab = 1;

  const data = new Float32Array(W * H);

  // Posiciones de la normal en vóxel, recomputadas por columna (no dependen de Z).
  const vxN = new Float64Array(nSlab);
  const vyN = new Float64Array(nSlab);

  for (let a = 0; a < W; a++) {
    const s = (a / (W - 1)) * total;
    const { pos, tan } = sampleAtArc(poly, s);
    const nx = -tan.y; // normal unitaria (perpendicular a la tangente)
    const ny = tan.x;
    for (let k = 0; k < nSlab; k++) {
      const t = nSlab > 1 ? -half + (k * slabMm) / (nSlab - 1) : 0;
      vxN[k] = (pos.x + t * nx) / sx;
      vyN[k] = (pos.y + t * ny) / sy;
    }
    for (let b = 0; b < H; b++) {
      const voxZ = (b / (H - 1)) * (vol.depth - 1);
      let best = -Infinity;
      let sum = 0;
      let cnt = 0;
      for (let k = 0; k < nSlab; k++) {
        const v = trilinear(vol, vxN[k], vyN[k], voxZ);
        if (v == null) continue;
        if (mode === "mip") {
          if (v > best) best = v;
        } else {
          sum += v;
        }
        cnt++;
      }
      // Fila 0 = parte superior. La imagen pano clínica suele crecer hacia abajo en
      // Z; aquí b=0 es z=0 (primer corte). Se invierte verticalmente al pintar si
      // se desea, pero mantenemos b∝Z directo (el visor ya orienta como el resto).
      data[b * W + a] = cnt === 0 ? NaN : mode === "mip" ? best : sum / cnt;
    }
  }

  return { data, W, H, pxMm, totalArcMm: total, heightMm };
}
