// Helpers PUROS compartidos por el visor CBCT en rejilla 2×2 (MPR) y sus paneles.
// Sin React, sin DOM: solo geometría física (mm), estadística por percentiles del
// estudio y presets de ventana. Los consumen DicomSetViewer (orquestador) y
// MprPane (un plano) — y, desde el arreglo de geometría, también el generador del
// binario lite del SERVIDOR (src/lib/cbct-lite.ts), que apila el volumen del
// móvil y tiene que hacerlo con el MISMO criterio de orden que el escritorio.
// Mantener este archivo libre de efectos colaterales.

import {
  planeNormalFrom,
  type DecodedSlice,
  type SliceOrderSource,
  type ImageOrientation,
} from "./dicom-decode-core";

// Reusamos el corte ya decodificado del núcleo (HU en Int16 + geometría física).
export type Slice = DecodedSlice;

// Plano 2D del volumen. El 3D (volumen) lo maneja el orquestador aparte.
export type PlaneKey = "axial" | "coronal" | "sagittal";

// Herramienta activa sobre los planos 2D. "crosshair" = navegar moviendo la cruz
// sincronizada; "pan" = desplazar; "measure"/"probe" = como antes.
export type Tool = "crosshair" | "pan" | "measure" | "probe";

// De dónde sale el espaciado en plano (mm/px). Precedencia clínica:
//   pixel-spacing (0028,0030) = medida reconstruida (CT/CBCT) -> exacta.
//   imager-pixel-spacing (0018,1164) = en el detector (pano/periapical) -> la
//     proyección amplía la anatomía (magnificación) -> aproximada.
//   none = sin metadato de escala -> NO se puede dar mm (se muestra px).
export type SpacingSource = "pixel-spacing" | "imager-pixel-spacing" | "none";

export interface ScaleInfo {
  sx: number; // mm por columna (eje X)
  sy: number; // mm por fila (eje Y)
  sz: number; // mm entre cortes (eje Z)
  xySource: SpacingSource; // fuente del espaciado en plano
  zCalibrated: boolean; // sz viene de SpacingBetweenSlices/SliceThickness (no derivado)
  // El espaciado entre cortes NO es constante en el estudio: los deltas medidos
  // entre posiciones consecutivas se desvían de la mediana mas de lo tolerable.
  // `sz` sigue siendo la mediana (el mejor valor unico posible), pero cualquier
  // medida a lo largo de Z arrastra ese error, y el visor debe decirlo en vez de
  // presentar un milimetro que no se cumple en todo el volumen. Ausente/false =
  // espaciado regular o sin posiciones con las que comprobarlo.
  zVariable?: boolean;
}

// Estado de calibración de UNA medición. "approx" = magnificación de proyección;
// "uncal" = sin escala mm fiable (se reporta en px, nunca un mm inventado).
export type CalibStatus = "exact" | "approx" | "uncal";

// Posición de la CRUZ en coordenadas de VÓXEL (índices enteros). Las tres vistas
// MPR comparten esta posición: cada plano fija una coordenada (su normal) y los
// otros dos se reposicionan a la misma coordenada del MUNDO (mm) automáticamente,
// porque cada raster se escala con el espaciado físico del estudio.
export interface Cross {
  x: number; // columna (eje X)
  y: number; // fila (eje Y)
  z: number; // corte (eje Z)
}

// El peor estado domina la medición (un eje sin calibrar invalida el mm).
export function worstStatus(a: CalibStatus, b: CalibStatus): CalibStatus {
  const rank: Record<CalibStatus, number> = { exact: 0, approx: 1, uncal: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(v);
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Tamaño del raster de salida de un plano: 1 px = el espaciado más fino, para no
// perder resolución nativa y dar proporciones físicas reales. Acotado a MAXDIM por
// lado (rendimiento; el lienzo se reescala al contenedor). Compartido por el
// pintado de la imagen y la matemática de medición, para que coincidan exacto.
export const MAXDIM = 1024;
export function rasterDims(nA: number, sA: number, nB: number, sB: number): { W: number; H: number } {
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
}

// Escala INFERIDA de un corte ya decodificado (siempre disponible, instantánea).
// El núcleo solo captura PixelSpacing (0028,0030) y cae a [1,1] si falta; por eso:
// espaciado real (!= [1,1]) -> pixel-spacing exacto; [1,1]/ausente -> sin escala.
// El caso ImagerPixelSpacing-solo (pano) lo refina el orquestador leyendo el header.
export function inferScale(s: Slice): ScaleInfo {
  const ps = s.pixelSpacing;
  const sx = ps && ps[0] > 0 ? ps[0] : 1;
  const sy = ps && ps[1] > 0 ? ps[1] : 1;
  const zRaw = s.zSpacing;
  const sz = zRaw && zRaw > 0 ? zRaw : sy;
  const hasReal = !!(ps && (ps[0] !== 1 || ps[1] !== 1));
  return { sx, sy, sz, xySource: hasReal ? "pixel-spacing" : "none", zCalibrated: hasReal };
}

// Geometría de UN plano: ejes en plano (nA·sA × nB·sB), su identidad (X/Y/Z) y el
// tamaño del raster físico. Es la misma matemática que usaba la vista única, ahora
// parametrizada por `plane` para poder pintar los tres planos a la vez.
export interface PlaneGeom {
  cols: number;
  rows: number;
  depth: number;
  sx: number;
  sy: number;
  sz: number;
  nA: number; // muestras eje horizontal del raster
  sA: number; // mm/muestra eje horizontal
  nB: number; // muestras eje vertical del raster
  sB: number; // mm/muestra eje vertical
  axisA: "X" | "Y" | "Z";
  axisB: "X" | "Y" | "Z";
  W: number;
  H: number;
  sc: ScaleInfo;
}

export function planeGeom(
  cols: number,
  rows: number,
  depth: number,
  plane: PlaneKey,
  sc: ScaleInfo,
): PlaneGeom | null {
  if (cols <= 0 || rows <= 0 || depth <= 0) return null;
  const { sx, sy, sz } = sc;
  let nA: number;
  let sA: number;
  let nB: number;
  let sB: number;
  let axisA: "X" | "Y" | "Z";
  let axisB: "X" | "Y" | "Z";
  if (plane === "coronal") {
    // Plano (X,Z) en Y fijo.
    nA = cols;
    sA = sx;
    nB = depth;
    sB = sz;
    axisA = "X";
    axisB = "Z";
  } else if (plane === "sagittal") {
    // Plano (Y,Z) en X fijo.
    nA = rows;
    sA = sy;
    nB = depth;
    sB = sz;
    axisA = "Y";
    axisB = "Z";
  } else {
    // axial: plano (X,Y) en Z fijo.
    nA = cols;
    sA = sx;
    nB = rows;
    sB = sy;
    axisA = "X";
    axisB = "Y";
  }
  const { W, H } = rasterDims(nA, sA, nB, sB);
  return { cols, rows, depth, sx, sy, sz, nA, sA, nB, sB, axisA, axisB, W, H, sc };
}

/* -------------------------------------------------------------------------- */
/* Rotulado anatómico de los bordes (R/L/A/P/S/I)                             */
/* -------------------------------------------------------------------------- */

// Letras del sistema del paciente. DICOM trabaja en LPS: X+ = IZQUIERDA del
// paciente, Y+ = POSTERIOR, Z+ = SUPERIOR (craneal). De ahí salen las seis:
//   R/L = derecha/izquierda del PACIENTE (no de quien mira la pantalla),
//   A/P = anterior/posterior, S/I = superior/inferior.
export type AnatomicLetter = "R" | "L" | "A" | "P" | "S" | "I";

// Una letra por borde del plano, o `null` en el borde cuyo sentido NO se puede
// derivar. Nullable a propósito y no `string`: hay estudios que declaran la
// orientación del plano (ImageOrientationPatient) pero no la posición
// (ImagePositionPatient). En esos se sabe qué queda a izquierda y a derecha —eso
// vive en el IOP— y NO se sabe hacia dónde crece la pila de cortes, porque el
// orden salió de InstanceNumber, que es un número de catálogo y hay equipos que
// lo emiten al revés de la adquisición. Rellenar ese hueco con la suposición
// habitual sería pintar una "S" sobre un volumen que puede venir del revés.
export interface EdgeLabels {
  left: AnatomicLetter | null;
  right: AnatomicLetter | null;
  top: AnatomicLetter | null;
  bottom: AnatomicLetter | null;
}

type Vec3 = [number, number, number];

// Normaliza a longitud 1. Devuelve null si el vector es nulo o tiene basura: sin
// dirección no hay letra que dar. El IOP DEBERÍA venir ya unitario, pero hay
// escritores que emiten cosenos con error de redondeo acumulado; normalizar es
// gratis y deja las tres direcciones comparables entre sí.
function unit(v: readonly number[]): Vec3 | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function neg(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

// Letra del eje LPS DOMINANTE de una dirección del paciente. Se queda con la
// componente de mayor valor absoluto porque un borde de la pantalla admite UNA
// letra: un eje del raster que apunte a 30° entre anterior y superior se rotula
// con la que más manda, no con las dos. El empate exacto (45°) se resuelve por
// orden X > Y > Z: da igual cuál se elija, pero tiene que ser determinista para
// que dos repintados del mismo estudio no alternen la letra.
function letterOf(v: Vec3): AnatomicLetter | null {
  const ax = Math.abs(v[0]);
  const ay = Math.abs(v[1]);
  const az = Math.abs(v[2]);
  const m = Math.max(ax, ay, az);
  if (!Number.isFinite(m) || m < 1e-6) return null;
  if (m === ax) return v[0] > 0 ? "L" : "R";
  if (m === ay) return v[1] > 0 ? "P" : "A";
  return v[2] > 0 ? "S" : "I";
}

// Un eje del raster de un plano: qué eje del VOLUMEN recorre y en qué sentido.
// `axis`: X = índice de columna, Y = índice de fila, Z = índice de corte.
// `sense`: +1 si ese índice CRECE hacia la derecha (eje horizontal) o hacia
// ABAJO (eje vertical) del lienzo; −1 si crece en el sentido contrario.
interface RasterAxis {
  axis: "X" | "Y" | "Z";
  sense: 1 | -1;
}

// De dónde sale el SENTIDO de cada eje del raster. Es la mitad del problema: la
// otra mitad (qué dirección del paciente es cada eje del volumen) la da el IOP,
// pero si el sentido está mal la letra queda INVERTIDA, que es peor que no poner
// ninguna —afirma una lateralidad falsa sobre la imagen de un paciente—.
//
// El bucle de pintado de MprPane recorre el lienzo con `a` (columna del raster,
// a = 0 es el borde IZQUIERDO) y `b` (fila del raster, b = 0 es el borde
// SUPERIOR: `createImageData` se rellena por filas y `putImageData` la deposita
// en el origen del lienzo). Qué índice del volumen lee cada uno:
//   axial    horizontal = índice de COLUMNA, creciendo hacia la derecha
//            vertical   = índice de FILA,    creciendo hacia abajo
//   coronal  horizontal = índice de COLUMNA, creciendo hacia la derecha
//            vertical   = índice de CORTE, por `sampleDepthAtRow`
//   sagital  horizontal = índice de FILA,    creciendo hacia la derecha
//            vertical   = índice de CORTE, por `sampleDepthAtRow`
//
// Los cuatro ejes EN PLANO crecen hacia la derecha y hacia abajo, y por eso su
// `sense` es +1; coincide con `planeGeom`, que asigna a esos mismos ejes (axisA
// horizontal, axisB vertical) el número de muestras y el mm/muestra. El eje
// vertical de los dos reformateados es el único que puede ir al revés, y lo hace
// a través de `sampleDepthAtRow` — una sola función, compartida con las pruebas.
//
// Esta tabla es el ÚNICO sitio donde vive ese hecho. Si algún día el pintado
// voltea un eje, se cambia aquí el signo y las letras siguen solas; mientras la
// tabla y el bucle no se toquen a la vez, no pueden desincronizarse en silencio.
const RASTER_AXES: Record<PlaneKey, { h: RasterAxis; v: RasterAxis }> = {
  axial: { h: { axis: "X", sense: 1 }, v: { axis: "Y", sense: 1 } },
  // El vertical de los reformateados es -1 porque MprPane los pinta VOLTEADOS:
  // recorre la pila de cortes hacia ARRIBA (fila 0 del raster = ultimo corte), de
  // modo que el extremo +normal --el superior del paciente en una adquisicion
  // normal-- queda en el borde de arriba, que es la convencion radiologica. Ese
  // volteo solo se aplica cuando el orden de la pila es FISICO; cuando no lo es,
  // MprPane pinta sin voltear y este rotulado devuelve a null los bordes que
  // dependen de Z, asi que la tabla y la imagen no pueden discrepar.
  coronal: { h: { axis: "X", sense: 1 }, v: { axis: "Z", sense: -1 } },
  sagittal: { h: { axis: "Y", sense: 1 }, v: { axis: "Z", sense: -1 } },
};

// Letras de los cuatro bordes de un plano MPR, derivadas de la orientación REAL
// del estudio. `null` = el estudio no declara orientación y aquí no se inventa
// ninguna (ver `imageOrientation` en dicom-decode-core: `planeNormal` cae a
// (0,0,1) para poder ORDENAR, así que un (0,0,1) no prueba que el estudio dijera
// nada; la señal de "se sabe / no se sabe" es `imageOrientation`).
//
// TRAMPA DE NOMENCLATURA DICOM: el "vector de FILA" del IOP (índices 0-2) NO es
// la dirección en la que avanzan las filas; es la dirección que se recorre
// AVANZANDO POR UNA FILA, es decir la del índice de COLUMNA. Y el "vector de
// COLUMNA" (índices 3-5) es la del índice de FILA. Leerlos al revés intercambia
// las letras de los bordes con las de arriba/abajo sin que nada más falle.
//   +X del volumen (columna crece) → vector de FILA    = iop[0..2]
//   +Y del volumen (fila crece)    → vector de COLUMNA = iop[3..5]
//   +Z del volumen (corte crece)   → ver abajo
//
// El eje Z no está en el IOP: sale del ORDEN de la pila. El visor ordena los
// cortes ascendiendo por `order`, y cuando ese orden es FÍSICO se cumple
// order = imagePosition · planeNormal, así que subir de índice de corte es
// avanzar en el sentido +planeNormal. Si NO es físico, el sentido de Z es
// DESCONOCIDO y se devuelven a null los bordes que dependen de él en vez de
// suponer el habitual.
//
// Quién decide eso es el LLAMADOR (`zPhysicalOrder`), no este módulo mirando
// `s.orderSource`. Y no es un capricho: el CBCT lite de móvil declara
// `orderSource: "instance"` en TODOS sus cortes aunque el servidor los haya
// apilado con la geometría del .zip original, así que el corte no sabe la
// respuesta. Además el mismo booleano gobierna el volteo del pintado en MprPane;
// compartirlo es lo que impide el fallo peor de todos: una imagen sin voltear
// rotulada con la letra del volteo, es decir S e I intercambiadas.
//
// Al plano coronal y al sagital se les rotula con el IOP del corte de
// ADQUISICIÓN (todos los de una serie comparten orientación) porque son cortes
// sintéticos del mismo volumen: no tienen IOP propio, pero sus ejes SÍ son ejes
// de ese volumen, y la orientación del volumen es justo lo que describe el IOP.
//
// VERIFICACIÓN con un estudio estándar (IOP = 1\0\0\0\1\0 ⇒ normal +Z)
// y orden físico:
//   axial   → izquierda R, derecha L, arriba A, abajo P
//   coronal → izquierda R, derecha L, arriba S, abajo I
//   sagital → izquierda A, derecha P, arriba S, abajo I
// Las tres filas son la convención radiológica. Que coronal y sagital salgan
// con S arriba depende del volteo del pintado descrito en RASTER_AXES: si
// alguien lo quita de MprPane y olvida esta tabla, el rotulado pasa a mentir
// sin que nada más falle. Es el único acoplamiento real de este archivo puro
// con el pintado, y por eso está escrito en los dos sitios.
export function edgeLabelsFor(
  plane: PlaneKey,
  s: Slice,
  // ¿La pila de cortes está ordenada por geometría real (y por tanto MprPane la
  // pinta volteada)? Lo sabe el orquestador, que es quien conoce la procedencia
  // del volumen: .zip decodificado aquí, o binario lite apilado en el servidor.
  zPhysicalOrder: boolean,
): EdgeLabels | null {
  const iop = s.imageOrientation;
  if (!iop) return null; // el estudio no lo declara → no se rotula nada

  const rowDir = unit([iop[0], iop[1], iop[2]]); // dirección de +X del volumen
  const colDir = unit([iop[3], iop[4], iop[5]]); // dirección de +Y del volumen
  if (!rowDir || !colDir) return null;
  // Sentido de +Z del volumen, solo si el orden de la pila es físico.
  //
  // Se DERIVA del IOP (producto cruz de las dos direcciones de arriba) y no se
  // lee de `s.planeNormal`. Son el mismo vector en un corte que viene del .zip,
  // pero no en uno que viene del binario lite: ahí `planeNormal` es el eje con el
  // que se ordenó —nada, porque el volumen llegó ya apilado— y el dato real es el
  // IOP que el binario transporta. Derivarlo aquí hace imposible que la letra
  // salga de un vector y el resto del rótulo de otro.
  const sliceDir = zPhysicalOrder ? unit(planeNormalFrom(iop) || []) : null;

  const dirOf = (axis: "X" | "Y" | "Z"): Vec3 | null =>
    axis === "X" ? rowDir : axis === "Y" ? colDir : sliceDir;

  const ax = RASTER_AXES[plane];
  const h = dirOf(ax.h.axis);
  const v = dirOf(ax.v.axis);
  // Dirección del paciente hacia la que apunta el borde DERECHO y el INFERIOR.
  const toRight = h ? (ax.h.sense === 1 ? h : neg(h)) : null;
  const toBottom = v ? (ax.v.sense === 1 ? v : neg(v)) : null;

  // Cada borde se rotula con la dirección a la que se AVANZA yendo hacia él, que
  // es la convención de los visores clínicos: la "R" del borde izquierdo dice que
  // por ese lado de la imagen está la derecha del paciente.
  return {
    right: toRight ? letterOf(toRight) : null,
    left: toRight ? letterOf(neg(toRight)) : null,
    bottom: toBottom ? letterOf(toBottom) : null,
    top: toBottom ? letterOf(neg(toBottom)) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Encuadre en pantalla (el lienzo se re-mide cuando cambia el layout)         */
/* -------------------------------------------------------------------------- */

// Techos del BÚFER del lienzo de un corte. El bucle bilineal es O(W·H) y se
// repite en CADA repintado (girar la rueda repinta), así que el lienzo no puede
// seguir al contenedor sin freno: un panel maximizado en HiDPI pediría ~4 Mpx
// por corte. Acotamos lado y área; el 3D tiene su propio techo equivalente.
export const MAX_VIEW_SIDE = 2048;
export const MAX_VIEW_PIXELS = 2_600_000;
// Por encima de 2 no se distingue y cuadruplica el trabajo. Mismo tope que ya
// usaba el volumen 3D (Dicom3DVolume), para no tener dos criterios de nitidez.
export const MAX_DPR = 2;

// Caja CSS del corte dentro de su contenedor conservando la proporción FÍSICA
// del estudio (mm reales, no píxeles): "contain", nunca estirar. Lo que sobre
// queda como margen y lo centra el flex del panel.
export function fitContain(
  extA: number,
  extB: number,
  boxW: number,
  boxH: number,
): { w: number; h: number } {
  if (extA <= 0 || extB <= 0 || boxW <= 0 || boxH <= 0) return { w: 0, h: 0 };
  const ratio = extA / extB;
  let w = boxW;
  let h = w / ratio;
  if (h > boxH) {
    h = boxH;
    w = h * ratio;
  }
  return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
}

// Tamaño del búfer para una caja CSS que YA tiene la proporción del estudio.
// Sube a píxeles de dispositivo (nitidez en HiDPI) pero nunca por encima de la
// resolución NATIVA del estudio —interpolar de más solo gasta CPU sin añadir
// detalle— y siempre bajo los techos de arriba. Devuelve el búfer, no la caja:
// la caja CSS manda en el layout y el búfer solo en cuántas muestras se pintan.
export function viewRasterDims(
  g: PlaneGeom,
  cssW: number,
  cssH: number,
  dpr: number,
): { W: number; H: number } {
  const d = Math.max(1, Math.min(MAX_DPR, dpr || 1));
  const w0 = Math.max(1, cssW) * d;
  const h0 = Math.max(1, cssH) * d;
  const pmm = Math.min(g.sA, g.sB) || 1;
  // Nativo = 1 muestra por el espaciado más fino (sin el tope de `rasterDims`).
  let k = Math.min(1, (g.nA * g.sA) / pmm / w0, (g.nB * g.sB) / pmm / h0);
  k = Math.min(k, MAX_VIEW_SIDE / Math.max(w0, h0));
  k = Math.min(k, Math.sqrt(MAX_VIEW_PIXELS / (w0 * h0)));
  return { W: Math.max(1, Math.round(w0 * k)), H: Math.max(1, Math.round(h0 * k)) };
}

/* -------------------------------------------------------------------------- */
/* Estadística por percentiles del estudio (auto-ventana + presets)            */
/* -------------------------------------------------------------------------- */

// El CBCT NO entrega Hounsfield estables: una ventana FIJA (HU absolutos) no cae
// bien en todos los estudios. Trabajamos en valores de gris RELATIVOS: muestreamos
// el volumen y sacamos percentiles, de los que derivamos la auto-ventana (p1/p99)
// y los presets de densidad. Así el contraste sale bien "por defecto" en cualquier
// CBCT sin números mágicos. Ver reference_dental_viewer_research (CBCT≠HU).
export interface VolStats {
  min: number;
  max: number;
  p01: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
}

// Submuestrea el volumen (≈50k muestras) saltando vóxeles para no recorrer
// millones. Desfase primo por corte para no muestrear siempre la misma esquina
// (suele ser aire). Determinista (sin RNG). Ordena y lee percentiles por índice.
export function computeVolStats(slices: Slice[]): VolStats | null {
  if (!slices || slices.length === 0) return null;
  const depth = slices.length;
  const per = slices[0].pixels.length;
  if (per <= 0) return null;
  const target = 50000;
  const totalApprox = depth * per;
  let stride = Math.floor(totalApprox / target);
  if (stride < 1) stride = 1;

  const samples: number[] = [];
  for (let z = 0; z < depth; z++) {
    const px = slices[z].pixels;
    const len = px.length;
    let i = (z * 7919) % stride; // desfase primo por corte
    for (; i < len; i += stride) samples.push(px[i]);
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const n = samples.length;
  const at = (p: number) => {
    let k = Math.floor(p * (n - 1));
    if (k < 0) k = 0;
    else if (k > n - 1) k = n - 1;
    return samples[k];
  };
  return {
    min: samples[0],
    max: samples[n - 1],
    p01: at(0.01),
    p05: at(0.05),
    p25: at(0.25),
    p50: at(0.5),
    p75: at(0.75),
    p95: at(0.95),
    p99: at(0.99),
  };
}

export type WindowKey = "auto" | "bone" | "tissue" | "air";
export interface WindowCW {
  c: number;
  w: number;
}

// Ventana a partir de un rango [lo,hi] de valores de gris (centro/ancho). w>=1.
function win(lo: number, hi: number): WindowCW {
  return { c: (lo + hi) / 2, w: Math.max(1, hi - lo) };
}

// Presets de 1 clic derivados de los percentiles del estudio (relativos, robustos
// en CBCT). auto = la auto-ventana p1/p99 que ya usaba el visor.
export function presetWindow(s: VolStats, key: WindowKey): WindowCW {
  if (key === "bone") return win(s.p50, s.p99); // tejido duro: hueso/diente con contraste
  if (key === "tissue") return win(s.p25, s.p75); // banda media: tejido blando
  if (key === "air") return win(s.p01, s.p50); // baja densidad: aire/cavidades y sus paredes
  return win(s.p01, s.p99); // auto = p1/p99 (rango real del estudio)
}

export const WINDOW_PRESETS: { key: WindowKey; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "bone", label: "Hueso" },
  { key: "tissue", label: "Tejido" },
  { key: "air", label: "Aire" },
];

/* -------------------------------------------------------------------------- */
/* Orden de la pila, espaciado MEDIDO y homogeneidad del set                   */
/* -------------------------------------------------------------------------- */
//
// Estas funciones vivían dentro de DicomSetViewer.tsx, que es un componente de
// cliente. Están aquí por dos razones, y la segunda es la que importa:
//   (1) son puras y se pueden probar sin montar React;
//   (2) el GENERADOR DEL LITE (src/lib/cbct-lite.ts) corre en el SERVIDOR y apila
//       el volumen que ve el MÓVIL. Mientras cada lado tuvo su propio criterio de
//       orden, el mismo estudio salía apilado de una forma en el escritorio y de
//       otra en el teléfono, y nadie podía verlo desde ninguno de los dos.
// Un solo sitio, los dos lados.

// Forma MÍNIMA que necesita cada función. Se piden estructuras y no `Slice`
// entero porque el generador del lite trabaja con cortes ya reducidos, que no
// llevan píxeles del original: si estas funciones exigieran `Slice`, el servidor
// no podría llamarlas y volveríamos a tener dos criterios.
export interface OrderedSlice {
  order: number;
  orderSource: SliceOrderSource;
}
export interface PositionedSlice extends OrderedSlice {
  imagePosition: [number, number, number] | null;
  planeNormal: [number, number, number];
}
export interface OrientedSlice {
  imageOrientation: ImageOrientation | null;
}
export interface RasterSlice {
  rows: number;
  cols: number;
}
export interface SeriesSlice {
  // Un registro rescatado de la caché de IndexedDB de una versión anterior no lo
  // trae; ahí llega `undefined` y la clave cae a los indicios, que es como se
  // comportaba antes. Por eso es opcional y no obligatorio.
  seriesUid?: string | null;
}

// Umbral de irregularidad del eje Z. "Desviación" se define POR DELTA contra la
// mediana: |delta − mediana| / mediana > 0.10 en ALGÚN par de cortes consecutivos
// marca el estudio como irregular. Se compara contra la mediana y no contra el
// delta anterior porque el número que el visor va a usar como `sz` ES la mediana:
// lo que importa clínicamente es cuánto miente ese milímetro en el PEOR par, no
// cuánto cambia el paso de un par al siguiente. Y basta con uno: un único salto
// de corte ya invalida cualquier medida que cruce esa zona del volumen.
const Z_IRREGULAR_TOL = 0.1;

// Por debajo de esto, dos cortes están en la MISMA posición (corte repetido en el
// .zip, o ruido de redondeo del VR "DS" de DICOM, que es texto decimal). Ningún
// CBCT resuelve una décima de micra, así que ningún estudio real cae aquí por ser
// fino: si el delta es menor, es que no hay delta.
const Z_SAME_POSITION_MM = 1e-4;

export interface MeasuredZ {
  // mm entre cortes medidos del propio estudio, o `null` cuando HAY posiciones
  // pero no separan nada (todos los cortes en el mismo sitio). `null` NO es
  // "no se midió": es "se midió y no hay distancia", que es justo lo que hay
  // que denunciar. Quien lo reciba debe caer al espaciado del header para no
  // colapsar el raster, pero sin declararlo calibrado.
  sz: number | null;
  variable: boolean; // el espaciado NO es constante (ver Z_IRREGULAR_TOL)
  // Las posiciones NO avanzan siempre en el mismo sentido: la pila sube y luego
  // baja. Es distinto de `variable` y por eso viaja aparte: un estudio al que le
  // falta un corte tiene el paso irregular y SIGUE siendo un volumen bien
  // apilado —se puede voltear y rotular S/I sin mentir—, mientras que uno plegado
  // no está apilado en absoluto y ahí "hacia dónde crece la pila" no significa
  // nada. Mezclarlos costaba las letras a cualquier estudio con un corte de menos.
  folded: boolean;
}

// ¿Es un vector 3D utilizable? Un ImagePositionPatient a medias (un NaN en una
// componente) proyecta a NaN y contaminaría los deltas de sus DOS vecinos, así
// que o sirven las tres componentes o el corte no aporta posición. Vale igual
// para la normal del plano.
function usableVec3(v: readonly number[] | null | undefined): v is [number, number, number] {
  return !!v && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * Espaciado real entre cortes, MEDIDO de ImagePositionPatient en vez de creído del
 * header. Se llama con el set YA ORDENADO: proyecta la posición de cada corte
 * sobre un ÚNICO eje de referencia, saca las distancias entre cortes CONSECUTIVOS
 * y devuelve su mediana —afinada por extremos cuando el paso es regular— más el
 * veredicto de si ese paso es constante.
 *
 * Por qué gana al header: SpacingBetweenSlices (0018,0088) es OPCIONAL —hay
 * equipos que no lo emiten— y SliceThickness (0018,0050) es otra cosa: el GROSOR
 * del corte no es el PASO entre cortes; con solapamiento o con hueco son números
 * distintos, y el visor estaba usando el grosor como si fuera el paso. Las
 * posiciones, en cambio, son el dato que el propio equipo escribió corte a corte:
 * restarlas da el paso que el volumen tiene DE VERDAD.
 *
 * Por qué la MEDIANA y no la media: un corte que falte en el .zip crea un delta
 * doble. La media reparte ese error por todo el volumen (todas las medidas salen
 * mal, todas un poco); la mediana lo ignora (el volumen sigue bien salvo en ese
 * salto, que se denuncia aparte con `variable`).
 *
 * Por qué además el AFINADO POR EXTREMOS: la mediana hereda la precisión con la
 * que el equipo escribió las posiciones. Con un paso real de 0.125 mm y un
 * ImagePositionPatient a dos decimales, los deltas alternan 0.12 y 0.13 y la
 * mediana se queda con uno de los dos: 4 % de error, por debajo del umbral de
 * irregularidad, así que ni siquiera se avisa. Dividir el RECORRIDO TOTAL entre
 * el número de pasos reparte ese redondeo (≤0.01 mm en todo el estudio) entre
 * todos los huecos y devuelve 0.125 con error de micras. Solo se aplica cuando el
 * paso es REGULAR y se midieron TODOS los pares: si falta un corte o hay uno
 * repetido, el recorrido total ya no son (n−1) pasos y el afinado mentiría — ahí
 * manda la mediana, que es robusta justo a eso.
 *
 * Por qué UN eje de referencia y no la normal de cada corte: restar proyecciones
 * hechas sobre ejes distintos no da una distancia, da basura. Si algún corte
 * llegara girado respecto al primero, sus deltas se saldrán de la mediana y el
 * estudio quedará marcado como irregular — que es exactamente lo que es.
 *
 * Devuelve null cuando no hay NADA que medir (menos de dos cortes, o ninguno con
 * posición utilizable): ahí manda la cadena del header, sin nada que objetar.
 */
export function measureZSpacing(slices: readonly PositionedSlice[]): MeasuredZ | null {
  const n = slices.length;
  if (n < 2) return null; // con un solo corte no hay distancia que medir

  // Eje de referencia = la normal del PRIMER corte con posición usable.
  // `planeNormal` siempre viene del núcleo (cae al axial (0,0,1) si falta el
  // IOP), pero un set restaurado de la caché de IndexedDB pudo decodificarse con
  // una versión anterior que no escribía el campo: si no es un vector usable se
  // asume el mismo axial estándar que asume el núcleo, no se aborta la medida.
  const seed = slices.find((s) => usableVec3(s.imagePosition));
  if (!seed) return null; // ningún corte trae posición: no hay nada que medir
  let axis: [number, number, number] = [0, 0, 1];
  const nv = seed.planeNormal;
  if (usableVec3(nv)) {
    const len = Math.hypot(nv[0], nv[1], nv[2]);
    // Normalizar de nuevo cuesta nada y protege de una normal no unitaria: la
    // proyección tiene que salir en MILÍMETROS, no en una escala arbitraria.
    if (len > 1e-6) axis = [nv[0] / len, nv[1] / len, nv[2] / len];
  }

  // Proyección de cada corte sobre el eje (mm con signo). null = corte sin
  // posición; NO se le inventa una interpolando entre los vecinos.
  const proj: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = slices[i].imagePosition;
    proj[i] = usableVec3(p) ? p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2] : null;
  }

  // Deltas entre cortes CONSECUTIVOS EN EL ARRAY. Si uno de los dos no tiene
  // posición, el par se salta ENTERO en vez de medir contra el siguiente que sí
  // la tenga: esa distancia "por encima del hueco" valdría dos espaciados y
  // ensuciaría la mediana y la detección de irregularidad con un salto que no
  // existe — el corte de en medio está, solo que sin coordenada.
  const deltas: number[] = [];
  let duplicated = false; // hay dos cortes en la MISMA posición
  // ¿La pila AVANZA siempre en el mismo sentido? Es distinto de "el paso es
  // constante": una pila puede tener todos los pasos de 1 mm y aun así ir 0→4 y
  // volver 4→0, lo que significa que el sort no dejó un volumen, dejó un pliegue.
  // El valor absoluto de los deltas —que es correcto para medir un espaciado— no
  // lo ve, así que el sentido se vigila aparte.
  let direction = 0; // +1 sube, −1 baja, 0 aún sin decidir
  let folded = false;
  for (let i = 1; i < n; i++) {
    const a = proj[i - 1];
    const b = proj[i];
    if (a === null || b === null) continue;
    const signed = b - a;
    if (Math.abs(signed) >= Z_SAME_POSITION_MM) {
      const dir = signed > 0 ? 1 : -1;
      if (direction === 0) direction = dir;
      else if (dir !== direction) folded = true;
    }
    // Valor absoluto: el SIGNO depende del sentido de la normal (un set puede ir
    // de superior a inferior); el espaciado es una distancia y nunca es negativo.
    const d = Math.abs(signed);
    if (!Number.isFinite(d)) continue;
    if (d < Z_SAME_POSITION_MM) {
      // Un cero NO entra en la mediana: con unos cuantos cortes repetidos la
      // arrastraría hacia 0, y un `sz` de 0 colapsa el raster de coronal/sagital
      // a una franja de 1 px (rasterDims hace nB·sz) y deja el volumen sin
      // profundidad física. Pero SÍ cuenta como irregularidad: un corte repetido
      // es, literalmente, un paso que el estudio no cumple.
      duplicated = true;
      continue;
    }
    deltas.push(d);
  }

  if (deltas.length === 0) {
    // Había posiciones y NINGUNA separaba nada: el estudio entero está apilado en
    // el mismo sitio. Antes esto devolvía null y se perdía el `duplicated` que se
    // acababa de calcular: sin `sz` no había medida, sin medida no había
    // `zVariable`, y sin `zVariable` el visor no avisaba de NADA — el único caso
    // en el que la geometría es basura demostrada pasaba mudo, y encima con el
    // volteo y las letras S/I puestas encima. Se devuelve la denuncia sin `sz`.
    return duplicated ? { sz: null, variable: true, folded } : null;
  }

  // Mediana clásica: con un número PAR de deltas, el promedio de los dos
  // centrales. Con espaciado regular los dos centrales son el mismo número y la
  // distinción da igual; solo difieren cuando el estudio YA es irregular, y ahí
  // ningún `sz` único es correcto — por eso ese caso viaja con `variable`.
  const sorted = deltas.slice().sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  const med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  // Con un SOLO delta la mediana es ese delta: sigue siendo una medida entre dos
  // posiciones reales del estudio, que es mejor que el número declarado en el
  // header. La guarda final es la que importa: `sz` nunca sale 0 ni negativo.
  if (!Number.isFinite(med) || med <= 0) return null;

  // Una pila plegada NO es un volumen: se denuncia igual que un paso irregular.
  let variable = duplicated || folded;
  for (let i = 0; i < deltas.length && !variable; i++) {
    if (Math.abs(deltas[i] - med) / med > Z_IRREGULAR_TOL) variable = true;
  }

  let sz = med;
  // Afinado por extremos (ver la cabecera). Las dos condiciones son necesarias:
  //   · `!variable` deja fuera los pasos irregulares, los cortes repetidos y —lo
  //     importante— las pilas PLEGADAS;
  //   · `deltas.length === n - 1` comprueba que TODOS los pares consecutivos se
  //     midieron: basta que un corte no traiga posición para que el recorrido
  //     total deje de ser (n−1) pasos.
  //
  // Sin el `folded`, esto era una REGRESIÓN de su propio arreglo: un .zip con dos
  // series axiales de lateralidad opuesta y z solapado se ordena por la normal de
  // CADA corte y luego se proyecta sobre UNA, así que las posiciones salen
  // 4,3,2,1,0,1,2,3,4,5 — todos los deltas valen 1, ningún paso se desvía de la
  // mediana, y el recorrido total |5−4| repartido entre 9 pasos daba 0.111 mm en
  // vez de 1. El coronal salía nueve veces más aplastado y la regla escribía
  // milímetros sin un solo "≈". La mediana sola acertaba; el afinado es lo que
  // rompía, así que el afinado es lo que se acota.
  if (!variable && deltas.length === n - 1) {
    const first = proj[0];
    const last = proj[n - 1];
    if (first !== null && last !== null) {
      const span = Math.abs(last - first) / (n - 1);
      if (Number.isFinite(span) && span > 0) sz = span;
    }
  }
  return { sz, variable, folded };
}

/**
 * Ordena el set EN SITIO para que el índice del array sea el eje Z del volumen.
 * Sustituye al `arr.sort((a, b) => a.order - b.order)` de siempre, que dejó de
 * ser suficiente cuando `order` pasó a poder venir en milímetros con signo.
 *
 * (a) Set HOMOGÉNEO: la resta ordena bien aunque `order` sea negativo. El
 *     comparador solo usa el SIGNO de la diferencia, y −120 < −60 < 0 < 60 se
 *     cumple igual que entre enteros positivos; no hay nada que arreglar ahí. Lo
 *     único que rompería la comparación es un `order` NO FINITO: un NaN hace que
 *     el comparador deje de ser consistente y el resultado del sort queda
 *     indefinido (el motor no promete nada), sin un solo síntoma en pantalla. Por
 *     eso los no finitos se mandan al final de forma explícita.
 *
 * (b) Set MEZCLADO (cortes con `orderSource === "position"`, en mm, conviviendo
 *     con cortes "instance", que son índices): esos `order` NO son comparables
 *     entre sí. Ordenar la mezcla no invierte el volumen, lo BARAJA — un
 *     InstanceNumber 1..300 se intercala entre posiciones de −120 a +60 mm y el
 *     estudio queda entrelazado. Defensa: manda la procedencia MAYORITARIA. Los
 *     cortes de esa procedencia se ordenan entre ellos por `order`; los de la
 *     otra se quedan ANCLADOS en la ranura en la que llegaron del .zip.
 *     · Por qué no mandar el set entero al orden de llegada: tirar la geometría de
 *       299 cortes buenos porque uno perdió su ImagePositionPatient es pagar
 *       carísimo un corte.
 *     · Por qué no reordenar también la minoría: no hay con qué. Al faltar el IPP,
 *       el núcleo ya escribió InstanceNumber (o el índice del .zip) en `order` y no
 *       conserva ninguna otra magnitud, así que desde aquí no existe forma de
 *       traducir ese número a milímetros.
 *     · CONSECUENCIA que hay que asumir: los cortes anclados quedan donde el .zip
 *       los puso, no donde les tocaría por anatomía. El volumen se ve correcto
 *       salvo en esas ranuras. `measureZSpacing` salta los pares que tocan un
 *       corte sin posición, así que la mediana del espaciado no se contamina con
 *       ellos, y el visor avisa con el motivo "mixed-order".
 *
 * (c) EMPATES (`order` idéntico en dos cortes, típico de multi-frame mal
 *     etiquetado o de un .zip con el mismo corte dos veces): se rompen por índice
 *     de llegada EXPLÍCITAMENTE. Array.prototype.sort es estable desde ES2019,
 *     pero apoyar la integridad de un volumen clínico en una promesa del motor —y
 *     en que nadie la rompa al tocar el comparador— es innecesario cuando el
 *     desempate cabe en una resta.
 */
export function sortSlicesForVolume<T extends OrderedSlice>(arr: T[]): void {
  const n = arr.length;
  if (n < 2) return;

  // Decorar-ordenar-desdecorar: el índice de llegada viaja con cada corte para
  // poder desempatar y para poder anclar en el caso mezclado.
  const tagged = arr.map((s, i) => ({ s, i }));
  const byOrder = (a: { s: T; i: number }, b: { s: T; i: number }) => {
    // `order` no finito → al final del todo, no en medio del volumen.
    const ka = Number.isFinite(a.s.order) ? a.s.order : Number.POSITIVE_INFINITY;
    const kb = Number.isFinite(b.s.order) ? b.s.order : Number.POSITIVE_INFINITY;
    // Se compara con < / > y NO restando. Restar tiene dos trampas a la vez: la
    // resta de dos ±Infinity da NaN (y un comparador que devuelve NaN deja el
    // resultado del sort indefinido), y descartar ese NaN como si fuera un empate
    // colaba el corte no finito EN MEDIO del volumen en lugar de mandarlo al
    // final. Comparando no hay ningún caso que produzca NaN.
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.i - b.i; // empate exacto → orden de llegada del .zip (ver (c) arriba)
  };

  // Un corte restaurado de la caché de IndexedDB que se decodificó con una
  // versión anterior no trae `orderSource`; cuenta como "instance", que es lo que
  // su `order` era entonces. Así un set viejo entero sigue siendo homogéneo y se
  // ordena como siempre, en vez de parecer una mezcla y activar el modo anclado.
  let positions = 0;
  for (let i = 0; i < n; i++) if (arr[i].orderSource === "position") positions++;

  if (positions === 0 || positions === n) {
    tagged.sort(byOrder);
    for (let i = 0; i < n; i++) arr[i] = tagged[i].s;
    return;
  }

  // Mezcla: gana la procedencia mayoritaria. En un empate exacto 50/50 gana la
  // posición, que es el criterio FÍSICO (el otro es un número de catálogo).
  const majorPos = positions * 2 >= n;
  const movable = tagged.filter((t) => (t.s.orderSource === "position") === majorPos).sort(byOrder);
  let k = 0;
  for (let i = 0; i < n; i++) {
    // `tagged` conserva el orden de LLEGADA (el filter de arriba trabajó sobre una
    // copia), así que se puede leer mientras se reescribe `arr` sin pisarse.
    const arrived = tagged[i].s;
    arr[i] = (arrived.orderSource === "position") === majorPos ? movable[k++].s : arrived;
  }
}

// Tolerancia por componente al comparar dos ImageOrientationPatient. Los cosenos
// vienen como texto decimal y hay escritores que los emiten con distinto número
// de cifras corte a corte; 1e-4 en un coseno son ~0.006°, mil veces menos que
// cualquier diferencia real entre dos series, y mil veces más que el redondeo.
const IOP_SAME_TOL = 1e-4;

/**
 * ¿Todos los cortes comparten la MISMA orientación de adquisición?
 *
 * Importa porque el visor rotula los bordes con el ImageOrientationPatient del
 * PRIMER corte y lo aplica a todo el volumen. Eso es correcto dentro de una serie
 * —todos sus cortes comparten orientación por definición— pero el decodificador
 * acepta CUALQUIER archivo DICOM del .zip, y un .zip de paciente trae a menudo el
 * volumen axial y un scout lateral en la misma carpeta. Mezclados, el scout se
 * cuela en el volumen y el panel axial acaba pintando un corte sagital con las
 * letras R/L/A/P del axial: una lateralidad afirmada sobre la imagen equivocada.
 *
 * `true` también cuando NINGUNO declara orientación: no hay nada que contradiga
 * a nada, y quien rotula ya se calla solo al ver el `imageOrientation` en null.
 * `false` en cuanto conviven declarados y no declarados: eso ya son dos cosas
 * distintas dentro del mismo volumen.
 */
export function sameOrientation(slices: readonly OrientedSlice[]): boolean {
  if (slices.length < 2) return true;
  const first = slices[0].imageOrientation;
  for (let i = 1; i < slices.length; i++) {
    const iop = slices[i].imageOrientation;
    if (first === null || iop === null) {
      if (first !== iop) return false; // uno declara y el otro no
      continue;
    }
    for (let k = 0; k < 6; k++) {
      if (Math.abs(first[k] - iop[k]) > IOP_SAME_TOL) return false;
    }
  }
  return true;
}

/**
 * Clave de SERIE de un corte.
 *
 * PRIMERO el `SeriesInstanceUID` (0020,000E), que es la identidad que el propio
 * equipo le puso a la adquisición. Todo lo demás son INDICIOS, y los indicios se
 * pueden cumplir entre dos series distintas del mismo paciente: dos campos de
 * visión (0.3 y 0.15 mm/px) con la misma matriz y la misma orientación caen en la
 * misma clave por raster+IOP y se apilan juntos, con el doble de escala en media
 * pila y un salto de dos centímetros en el coronal, sin un solo aviso. El UID los
 * separa sin discutir. Se combina con el raster porque el visor indexa los píxeles
 * con el `cols` del primer corte y una serie mal formada podría variarlo.
 *
 * SI NO HAY UID —hay .zip anonimizados que lo borran— se cae a los indicios:
 * raster y orientación juntos. Los dos van en la misma clave porque los dos
 * rompen el volumen, cada uno a su manera, y separarlos deja pasar el caso peor:
 *   · RASTER distinto → el visor indexa `pixels[y*cols + x]` con el `cols` del
 *     primer corte. Si el intruso es más pequeño, `undefined` acaba en un
 *     Uint8ClampedArray como 0 (franja negra); si es más grande, el stride
 *     equivocado produce una imagen NÍTIDA Y FALSA, que es el peor de los dos.
 *   · ORIENTACIÓN distinta con el MISMO raster → nada falla al pintar, y por eso
 *     es el más peligroso: el rotulado saca las letras del IOP de `slices[0]` y
 *     las estampa sobre cortes de la otra serie. Con dos series axiales de
 *     lateralidad opuesta (IOP `1\0\0\0\1\0` y `-1\0\0\0\-1\0`) el panel axial
 *     pinta R donde está la izquierda del paciente. Una letra ausente se puede
 *     tolerar; una INVERTIDA sobre la imagen de un paciente, no.
 *
 * La orientación se cuantiza a 1e-4 por componente (~0.006°) para que dos cortes
 * de la misma serie con distinto número de decimales caigan en la misma clave.
 * Los cortes sin IOP forman su propia clave: no se pueden mezclar con los que sí
 * lo declaran, porque de esos no se sabe si comparten adquisición.
 */
function seriesKey(s: RasterSlice & OrientedSlice & SeriesSlice): string {
  if (s.seriesUid) return `${s.seriesUid}|${s.rows}x${s.cols}`;
  const iop = s.imageOrientation;
  const dir = iop ? iop.map((v) => Math.round(v * 1e4)).join(",") : "sin-iop";
  return `${s.rows}x${s.cols}|${dir}`;
}

/**
 * Se queda con la SERIE MAYORITARIA del archivo y descarta el resto.
 *
 * MAYORITARIA y no "la del primer corte", que es lo que parecía obvio y estaba
 * mal. Este filtro corre ANTES de ordenar (si no, quedarían huecos en el
 * volumen), así que el primer corte es el que venga primero DENTRO DEL .zip, y
 * ese orden lo pone el sistema de archivos. Un .zip de paciente trae a menudo el
 * volumen y un scout lateral, y si el scout entra primero, tomarlo como
 * referencia tira los 300 cortes buenos y deja el estudio reducido a la imagen de
 * localización — sin ningún error, porque después TODO lo que se juzga (la
 * orientación, la separación, la procedencia) se calcula sobre lo que quedó, y lo
 * que quedó es homogéneo y coherente consigo mismo.
 *
 * En un empate exacto gana la serie del primer corte: da igual cuál se elija,
 * pero tiene que ser determinista para que dos aperturas del mismo estudio no
 * enseñen series distintas.
 *
 * Devuelve el MISMO array cuando no sobra nada, para no forzar un repintado por
 * identidad en el caso normal, que es el de todos los estudios sanos.
 */
export function keepDominantSeries<T extends RasterSlice & OrientedSlice & SeriesSlice>(
  slices: T[],
): T[] {
  if (slices.length < 2) return slices;
  // Recuento por serie. Son un puñado de claves como mucho: un .zip con más de
  // dos o tres series distintas no es un estudio, es una carpeta.
  const tally = new Map<string, number>();
  const keys: string[] = new Array(slices.length);
  for (let i = 0; i < slices.length; i++) {
    const key = seriesKey(slices[i]);
    keys[i] = key;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  if (tally.size === 1) return slices;
  let bestKey = keys[0];
  let bestCount = tally.get(bestKey) || 0;
  tally.forEach((count, key) => {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  });
  return slices.filter((_, i) => keys[i] === bestKey);
}

/**
 * ¿La pila está apilada por GEOMETRÍA REAL del paciente?
 *
 * De este booleano cuelgan tres cosas a la vez —el volteo vertical de
 * coronal/sagital, el volteo del volumen 3D y de la panorámica, y el rotulado
 * S/I— y por eso vive en UNA función y no en cada consumidor: si dos de ellos lo
 * dedujeran por su cuenta podrían discrepar, y una imagen sin voltear con la
 * letra del volteo afirma una anatomía invertida, que es el peor resultado de los
 * tres.
 *
 * Las tres condiciones, y ninguna sobra:
 *   · TODOS los cortes con procedencia física. Con una mezcla, los `order` están
 *     en unidades distintas (mm con signo e índices) y el volumen queda
 *     intercalado, no invertido.
 *   · UNA sola orientación. Sin ella, "hacia dónde crece la pila" no significa
 *     nada porque cada serie crece hacia otro lado.
 *   · Una separación REAL medida. Trescientos cortes que declaran la MISMA
 *     posición cumplen las dos anteriores y sin embargo su orden es el de llegada
 *     del .zip: la posición está, pero no ordenó nada.
 *
 * La usan el visor (para el volteo y las letras) y el generador del lite (para
 * marcar el binario como "positioned"). Es la misma pregunta y tiene que tener la
 * misma respuesta en los dos lados; escrita dos veces, se separan en el primer
 * arreglo que toque solo una.
 */
export function isPhysicallyOrdered(
  slices: readonly (OrderedSlice & OrientedSlice)[],
  measured: MeasuredZ | null,
): boolean {
  if (slices.length === 0) return false;
  if (!measured || measured.sz === null) return false;
  // Una pila plegada no es una pila: no hay un sentido de crecimiento que voltear
  // ni una S que poner arriba. Se mira `folded` y NO `variable` a propósito — a un
  // estudio al que le falta un corte el paso le sale irregular y sin embargo está
  // perfectamente apilado, y quitarle las letras por eso sería perder información
  // correcta por un defecto que ya se avisa aparte.
  if (measured.folded) return false;
  for (const s of slices) if (s.orderSource !== "position") return false;
  return sameOrientation(slices);
}

/* -------------------------------------------------------------------------- */
/* Eje vertical volteado: las cuatro conversiones acopladas                    */
/* -------------------------------------------------------------------------- */
//
// Cuando la pila está apilada por geometría real, MprPane pinta el coronal y el
// sagital VOLTEADOS en vertical: la fila 0 del raster lee el ÚLTIMO corte, de modo
// que el extremo +normal —el superior del paciente en una adquisición normal—
// queda arriba, que es la convención radiológica.
//
// De ese volteo cuelgan CINCO cosas que tienen que decir exactamente lo mismo: el
// pintado del coronal, el del sagital, la cruz del overlay, el clic→vóxel y la
// sonda de densidad. Si dos de ellas discrepan, la sonda devuelve el valor de un
// vóxel distinto del que se está viendo: la medición miente y no hay ningún
// síntoma en pantalla.
//
// Por eso las conversiones viven AQUÍ y no como funciones locales del componente.
// No es un capricho de orden: mientras estuvieron dentro de MprPane, la única
// forma de probarlas era reescribirlas en el archivo de pruebas, y una prueba que
// reimplementa lo que comprueba no comprueba nada — se puede romper el pintado y
// la prueba sigue en verde.

/** Fila de raster volteada. `h` = alto del raster en filas. */
export function flipRowIndex(b: number, h: number, flip: boolean): number {
  return flip ? h - 1 - b : b;
}

/** Coordenada normalizada 0..1 volteada (cruz, clic y sonda). */
export function flipNormV(v: number, flip: boolean): number {
  return flip ? 1 - v : v;
}

/**
 * Índice de vóxel → normalizado 0..1, apuntando al CENTRO del vóxel.
 * Inversa exacta de `normToVox`.
 */
export function voxToNorm(vox: number, n: number): number {
  return n > 0 ? (vox + 0.5) / n : 0;
}

/**
 * Normalizado 0..1 → índice de vóxel (vecino más cercano), acotado. El centro del
 * vóxel v cae en (v+0.5)/n, así que el inverso exacto es t·n − 0.5.
 */
export function normToVox(t: number, n: number): number {
  if (n <= 0) return 0;
  const v = Math.round(t * n - 0.5);
  if (v < 0) return 0;
  if (v > n - 1) return n - 1;
  return v;
}

/**
 * Coordenada CONTINUA del corte que se pinta en la fila `b` del raster. Es la
 * fórmula literal del bucle de pintado de los planos reformateados:
 * muestreo por CENTRO DE PÍXEL, con el volteo aplicado sobre el índice de fila.
 *
 * Está aquí para que se pueda comprobar contra `normToVox(flipNormV(v))` —el
 * camino del clic y de la sonda— sin montar React. Las dos tienen que dar el
 * mismo vóxel para el mismo punto de la pantalla, y esa igualdad es lo único que
 * garantiza que la sonda mida donde el usuario cree que está midiendo.
 */
export function sampleDepthAtRow(b: number, rasterH: number, depth: number, flip: boolean): number {
  return ((flipRowIndex(b, rasterH, flip) + 0.5) * depth) / rasterH - 0.5;
}
