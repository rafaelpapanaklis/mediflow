/* ============================================================
   tooth3d-faces — identifica las caras (O/I · M · D · V · L) sobre la
   malla real de un diente y las deja escritas por vértice como PESOS
   continuos (suman 1 junto con la raíz). El shader de Tooth3D pinta cada
   hallazgo mezclando esos pesos, así la mancha sigue la forma real del
   diente y el borde entre caras queda suave en vez de dentado.

   Geometría de referencia (LEEME de los modelos): Y = eje largo, corona
   hacia −Y en superiores y +Y en inferiores; vestibular = +Z; lado derecho
   del paciente = espejo del izquierdo.

   Cómo se clasifica un vértice (posición p en metros, normal n):
   - Corona/raíz: por altura a lo largo de Y. El cuello (unión
     amelocementaria) se estima con la longitud de corona de Wheeler
     (tooth3d-model.ts) porque el modelo está a la longitud total de Wheeler.
   - Oclusal/Incisal: normal apuntando hacia la punta de la corona
     (vertientes internas de las cúspides, fosas, rebordes) y en la mitad
     alta de la corona. En anteriores, además, el 18 % más alto de la
     corona (el borde incisal) entra entero.
   - Vestibular/Lingual vs Mesial/Distal: por el ángulo en el plano
     horizontal, normalizando la corona a un cuadrado (los ángulos diedros
     caen en las diagonales) y mezclando la dirección radial con la normal.
   - Mesial/Distal: mesial es hacia la línea media. Con V = +Z y Y arriba
     el sistema es dextrógiro, así que +X es la IZQUIERDA del paciente:
     en cuadrantes izquierdos (2, 3, 6, 7) mesial = −X; en los derechos
     (1, 4, 5, 8), que son espejo, mesial = +X. Comprobado a ojo sobre
     26/36 (cúspide de Carabelli y cúspide distal del primer molar inferior).
   ============================================================ */
import * as THREE from "three";
import type { ToothMeta } from "./types";

/** Orden fijo de las regiones en los atributos y en los uniforms. */
export const FACE_ORDER = ["C", "M", "D", "V", "L", "R"] as const; // C = O/I (centro), R = raíz
export type FaceSlot = (typeof FACE_ORDER)[number];

export function faceSlotOf(letter: string): number {
  if (letter === "O" || letter === "I") return 0;
  const i = FACE_ORDER.indexOf(letter as FaceSlot);
  return i < 0 ? -1 : i;
}

export interface FaceInfo {
  /** +1 si la corona apunta a +Y (inferiores), −1 si a −Y (superiores) */
  tipSign: 1 | -1;
  /** +1 si mesial es +X, −1 si es −X */
  mesialSign: 1 | -1;
  /** longitud total del modelo (m) y caja envolvente global */
  length: number;
  bbox: THREE.Box3;
  /** cota Y del cuello estimado y de la punta de la corona (m) */
  neckY: number;
  tipY: number;
  crownLen: number;
  /** semiejes de la corona en X y Z (m) */
  halfX: number;
  halfZ: number;
  /** centroide de cada cara (m), índice = FACE_ORDER */
  centroids: THREE.Vector3[];
  /** posición sugerida para la etiqueta de cada cara (fuera del diente) */
  labelPos: THREE.Vector3[];
  /** ápices radiculares (uno por raíz según meta.roots) */
  apices: THREE.Vector3[];
  /** vértice vestibular más saliente a media corona (para el bracket) */
  buccalPoint: THREE.Vector3;
}

export function mesialSign(meta: ToothMeta): 1 | -1 {
  return meta.right ? 1 : -1;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Suaviza los pesos por adyacencia de triángulos (media con los vecinos):
 *  quita el ruido de las normales en surcos y fisuras sin mover las fronteras. */
function smoothWeights(g: THREE.BufferGeometry, w1: Float32Array, w2: Float32Array, iters: number) {
  const idx = g.index;
  if (!idx) return;
  const n = w1.length / 4;
  const acc = new Float32Array(n * 6);
  const cnt = new Uint16Array(n);
  const ia = idx.array as ArrayLike<number>;
  for (let it = 0; it < iters; it++) {
    acc.fill(0); cnt.fill(0);
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t], b = ia[t + 1], c = ia[t + 2];
      const tri = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const v = tri[k], o1 = tri[(k + 1) % 3], o2 = tri[(k + 2) % 3];
        for (let j = 0; j < 4; j++) acc[v * 6 + j] += w1[o1 * 4 + j] + w1[o2 * 4 + j];
        for (let j = 0; j < 2; j++) acc[v * 6 + 4 + j] += w2[o1 * 2 + j] + w2[o2 * 2 + j];
        cnt[v] += 2;
      }
    }
    for (let v = 0; v < n; v++) {
      const c = cnt[v];
      if (!c) continue;
      let sum = 0;
      const tmp = [0, 0, 0, 0, 0, 0];
      for (let j = 0; j < 6; j++) {
        const own = j < 4 ? w1[v * 4 + j] : w2[v * 2 + j - 4];
        tmp[j] = 0.5 * own + 0.5 * (acc[v * 6 + j] / c);
        sum += tmp[j];
      }
      for (let j = 0; j < 6; j++) {
        const val = sum > 0 ? tmp[j] / sum : tmp[j];
        if (j < 4) w1[v * 4 + j] = val; else w2[v * 2 + j - 4] = val;
      }
    }
  }
}

/**
 * Escribe `aFaceW` (vec4: C, M, D, V) y `aFaceW2` (vec2: L, raíz) en cada
 * geometría y devuelve la información derivada. Las geometrías se comparten
 * entre montajes (caché de tooth3d-model), así que esto se hace una vez.
 */
export function classifyFaces(geometries: THREE.BufferGeometry[], meta: ToothMeta, crownLen: number): FaceInfo {
  const tipSign: 1 | -1 = meta.upper ? -1 : 1;
  const mSign = mesialSign(meta);

  const bbox = new THREE.Box3();
  geometries.forEach((g) => { g.computeBoundingBox(); bbox.union(g.boundingBox!); });
  const length = bbox.max.y - bbox.min.y;
  const tipY = tipSign > 0 ? bbox.max.y : bbox.min.y;
  const hTip = tipSign * tipY;               // altura (hacia la punta) de la punta
  const hNeck = hTip - crownLen;             // altura del cuello
  const neckY = hNeck * tipSign;

  // 1) semiejes de la corona (excluye el cuello para que no lo achate la raíz)
  let halfX = 0, halfZ = 0;
  geometries.forEach((g) => {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const h = tipSign * p.getY(i);
      if ((h - hNeck) / crownLen < 0.15) continue;
      halfX = Math.max(halfX, Math.abs(p.getX(i)));
      halfZ = Math.max(halfZ, Math.abs(p.getZ(i)));
    }
  });
  if (!halfX) halfX = (bbox.max.x - bbox.min.x) / 2;
  if (!halfZ) halfZ = (bbox.max.z - bbox.min.z) / 2;

  // 2) pesos por vértice
  const anterior = !meta.posterior;
  const acc = FACE_ORDER.map(() => ({ x: 0, y: 0, z: 0, w: 0 }));
  const apexCand: { h: number; p: THREE.Vector3 }[] = [];
  let buccal = new THREE.Vector3(0, neckY + tipSign * crownLen * 0.45, halfZ), buccalZ = -Infinity;

  geometries.forEach((g) => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const n = pos.count;
    const w1 = new Float32Array(n * 4);
    const w2 = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = nrm ? nrm.getX(i) : 0, ny = nrm ? nrm.getY(i) : 0, nz = nrm ? nrm.getZ(i) : 0;
      const h = tipSign * y;
      const hn = (h - hNeck) / crownLen; // 0 = cuello, 1 = punta
      const wRoot = 1 - smooth(-0.05, 0.05, hn);

      // oclusal / incisal: normal hacia la punta (vertientes internas, fosas)
      // o bien dentro de la mesa oclusal (interior del contorno) en la mitad
      // alta de la corona — así los surcos, cuyas paredes tienen normales
      // tumbadas, no dejan huecos en la mancha.
      const nh = tipSign * ny;
      let dx = x / halfX, dz = z / halfZ;
      // distancia al contorno con norma-4: el contorno de la corona es un
      // cuadrado de esquinas redondeadas y así los ángulos diedros (≈0.7,0.7)
      // quedan FUERA de la mesa (con max(|dx|,|dz|) caían dentro y la mancha
      // oclusal se colaba corona abajo por la arista mesio-vestibular).
      const r4 = Math.pow(dx * dx * dx * dx + dz * dz * dz * dz, 0.25);
      let mC = smooth(0.55, 0.78, nh) * smooth(0.4, 0.6, hn) * (1 - smooth(0.85, 1.0, r4));
      // la "mesa" interior solo existe en posteriores: en un incisivo la fosa
      // palatina y la cara labial adelgazada caerían dentro del contorno y
      // saldrían como incisal (revisor, hallazgo 2).
      if (!anterior) mC = Math.max(mC, (1 - smooth(0.55, 0.75, r4)) * smooth(0.3, 0.5, hn));
      else mC = Math.max(mC, smooth(0.8, 0.9, hn));

      // laterales: dirección radial normalizada al cuadrado de la corona + normal
      const rl = Math.hypot(dx, dz) || 1;
      dx /= rl; dz /= rl;
      let hx = nx, hz = nz;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-6) { hx /= hl; hz /= hl; } else { hx = dx; hz = dz; }
      let ddx = 0.65 * dx + 0.35 * hx, ddz = 0.65 * dz + 0.35 * hz;
      const dl = Math.hypot(ddx, ddz) || 1;
      ddx /= dl; ddz /= dl;
      let sMD: number, sV: number;
      if (anterior) {
        // Anteriores: la corona es una lámina. La fosa lingual (cóncava) cruza
        // el plano medio, así que por posición saldría V, y cerca de z=0
        // |dx|>|dz| la volvería M/D. Aquí V/L va por el signo de la NORMAL en
        // Z (la fosa mira a lingual) y M/D solo en las franjas proximales.
        sMD = smooth(0.6, 0.8, Math.abs(dx));
        sV = nrm ? smooth(-0.15, 0.15, nz) : smooth(-0.1, 0.1, dz);
      } else {
        sMD = smooth(-0.12, 0.12, Math.abs(ddx) - Math.abs(ddz));
        sV = smooth(-0.1, 0.1, ddz);
      }
      const sM = smooth(-0.1, 0.1, (anterior ? dx : ddx) * mSign);

      const wLat = (1 - mC) * (1 - wRoot);
      const wC = mC * (1 - wRoot);
      const wM = wLat * sMD * sM;
      const wD = wLat * sMD * (1 - sM);
      const wV = wLat * (1 - sMD) * sV;
      const wL = wLat * (1 - sMD) * (1 - sV);
      w1[i * 4] = wC; w1[i * 4 + 1] = wM; w1[i * 4 + 2] = wD; w1[i * 4 + 3] = wV;
      w2[i * 2] = wL; w2[i * 2 + 1] = wRoot;

      const ws = [wC, wM, wD, wV, wL, wRoot];
      for (let k = 0; k < 6; k++) {
        const w = ws[k];
        if (w > 0.02) { acc[k].x += x * w; acc[k].y += y * w; acc[k].z += z * w; acc[k].w += w; }
      }
      if (wRoot > 0.5) apexCand.push({ h, p: new THREE.Vector3(x, y, z) });
      if (hn > 0.3 && hn < 0.6 && Math.abs(x) < halfX * 0.35 && z > buccalZ) { buccalZ = z; buccal = new THREE.Vector3(x, y, z); }
    }
    smoothWeights(g, w1, w2, 3);
    g.setAttribute("aFaceW", new THREE.BufferAttribute(w1, 4));
    g.setAttribute("aFaceW2", new THREE.BufferAttribute(w2, 2));
  });

  const centroids = acc.map((a) => a.w > 0 ? new THREE.Vector3(a.x / a.w, a.y / a.w, a.z / a.w) : new THREE.Vector3());
  // etiqueta: centroide empujado hacia fuera en la dirección de la cara
  const out = Math.max(halfX, halfZ) * 0.9 + 0.0012;
  const dirs = [
    new THREE.Vector3(0, tipSign, 0),
    new THREE.Vector3(mSign, 0, 0), new THREE.Vector3(-mSign, 0, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, -tipSign, 0),
  ];
  const labelPos = centroids.map((c, k) => {
    const d = dirs[k].clone();
    const p = c.clone();
    // laterales: a la altura del centroide, fuera del semieje correspondiente
    if (k === 1 || k === 2) p.setX(mSign * (k === 1 ? 1 : -1) * (halfX + 0.0016));
    else if (k === 3 || k === 4) p.setZ((k === 3 ? 1 : -1) * (halfZ + 0.0016));
    else p.add(d.multiplyScalar(k === 0 ? 0.0016 : out * 0.4));
    return p;
  });

  // ápices: uno por raíz. 1: el más lejano; 2: por signo de X; 3: palatino (−Z) + dos vestibulares (±X)
  const apices: THREE.Vector3[] = [];
  const lowest = (pred: (p: THREE.Vector3) => boolean) => {
    let best: { h: number; p: THREE.Vector3 } | null = null;
    for (const c of apexCand) if (pred(c.p) && (!best || c.h < best.h)) best = c;
    return best ? best.p.clone() : null;
  };
  const push = (p: THREE.Vector3 | null) => { if (p) apices.push(p); };
  if (meta.roots >= 3) {
    push(lowest((p) => p.z > 0 && p.x * mSign > 0));
    push(lowest((p) => p.z > 0 && p.x * mSign <= 0));
    push(lowest((p) => p.z <= 0));
  } else if (meta.roots === 2 && meta.upper) {
    // premolares superiores birradiculares (14/24): raíz vestibular y palatina
    push(lowest((p) => p.z > 0));
    push(lowest((p) => p.z <= 0));
  } else if (meta.roots === 2) {
    push(lowest((p) => p.x * mSign > 0));
    push(lowest((p) => p.x * mSign <= 0));
  } else {
    push(lowest(() => true));
  }
  if (!apices.length) apices.push(new THREE.Vector3(0, tipSign > 0 ? bbox.min.y : bbox.max.y, 0));

  return {
    tipSign, mesialSign: mSign, length, bbox, neckY, tipY, crownLen,
    halfX, halfZ, centroids, labelPos, apices, buccalPoint: buccal,
  };
}

/**
 * Letra de la cara bajo un triángulo (faceIndex del Raycaster). Devuelve
 * null cuando gana la raíz. `center` es "O" u "I" según el diente.
 */
export function letterAtFace(geometry: THREE.BufferGeometry, faceIndex: number, center: "O" | "I"): string | null {
  const w1 = geometry.attributes.aFaceW as THREE.BufferAttribute | undefined;
  const w2 = geometry.attributes.aFaceW2 as THREE.BufferAttribute | undefined;
  if (!w1 || !w2) return null;
  const idx = geometry.index;
  const sums = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const vi = idx ? idx.getX(faceIndex * 3 + k) : faceIndex * 3 + k;
    sums[0] += w1.getX(vi); sums[1] += w1.getY(vi); sums[2] += w1.getZ(vi); sums[3] += w1.getW(vi);
    sums[4] += w2.getX(vi); sums[5] += w2.getY(vi);
  }
  let best = 0;
  for (let k = 1; k < 6; k++) if (sums[k] > sums[best]) best = k;
  if (best === 5) return null;
  if (best === 0) return center;
  return FACE_ORDER[best];
}
