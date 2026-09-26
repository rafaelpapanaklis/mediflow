/* ============================================================
   tooth3d-model — carga (con caché) de los modelos anatómicos .glb
   del odontograma 3D.

   Modelos: University of Dundee, School of Dentistry — CC BY 4.0
   (52 dientes: permanentes 11–48, temporales 51–85). El crédito
   visible en la app es obligatorio: lo pinta Tooth3D en el escenario.

   Convenciones del material (LEEME.md de los modelos):
   - Unidades en metros. Centrados en el origen. Eje Y = eje largo.
   - Superiores con la corona hacia −Y, inferiores con la corona hacia +Y.
   - Cara vestibular hacia +Z.
   - Lado derecho del paciente (cuadrantes 1, 4, 5, 8) = espejo del izquierdo.

   Los .glb SÍ viajan en git, comprimidos (12.5 MB los 52; los originales
   de Dundee pesaban 94.5 MB y NO están en el repo): geometría con Draco
   (KHR_draco_mesh_compression, posiciones a 14 bits, normales a 10, UV a
   12, color a 8 — la malla no se simplifica: mismos triángulos) y texturas
   en WebP a 1024 px (EXT_texture_webp). Se eligió Draco y no meshopt
   porque Vercel NO comprime `model/gltf-binary` con gzip/brotli (no está en
   su lista de MIME comprimibles), así que cuenta el byte crudo: Draco deja
   un molar en 0.26 MB y meshopt en 0.39 MB. El decodificador (wasm + wrapper
   de three, 250 KB) se sirve desde public/odontograma/draco/ y se baja una
   sola vez por sesión. Si un modelo no carga, Tooth3D cae al diente
   procedural.

   Caché HTTP: la URL lleva ?v=MODEL_VERSION. Súbela cuando cambien los .glb
   para que un navegador con caché larga (immutable) pida los nuevos. El
   decodificador no admite query: si cambia, cambia el nombre de su carpeta.
   ============================================================ */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { ToothMeta } from "./types";
import { classifyFaces, type FaceInfo } from "./tooth3d-faces";

export const MODEL_BASE = "/odontograma/dientes-3d";
/** Versión de los .glb (cambia → nueva URL → se invalida la caché del navegador/CDN). */
export const MODEL_VERSION = "2026-09-26";
/** Carpeta con draco_wasm_wrapper.js + draco_decoder.wasm (copiados de three r184). */
export const DRACO_DECODER_PATH = "/odontograma/draco/";
export const MODEL_CREDIT = "Modelos 3D: University of Dundee, School of Dentistry — CC BY 4.0";

export function modelUrl(fdi: number): string {
  return `${MODEL_BASE}/${fdi >= 51 ? "temporales" : "permanentes"}/${fdi}.glb?v=${MODEL_VERSION}`;
}

/* Longitud de corona (mm, Wheeler) por diente: la fuente del cuello
   (unión amelocementaria) que separa corona de raíz. Los modelos están
   escalados a la longitud total promedio de Wheeler, así que
   h_cuello = L/2 − corona. Clave: U/L (arcada) + p (temporal) + n. */
const CROWN_MM: Record<string, number> = {
  // permanentes superiores
  U1: 10.5, U2: 9.0, U3: 10.0, U4: 8.5, U5: 8.5, U6: 7.5, U7: 7.0, U8: 6.5,
  // permanentes inferiores
  L1: 9.0, L2: 9.5, L3: 11.0, L4: 8.5, L5: 8.0, L6: 7.5, L7: 7.0, L8: 7.0,
  // temporales superiores
  Up1: 6.0, Up2: 5.6, Up3: 6.5, Up4: 5.1, Up5: 5.7,
  // temporales inferiores
  Lp1: 5.0, Lp2: 5.2, Lp3: 6.0, Lp4: 6.0, Lp5: 5.5,
};

export function crownLengthMm(meta: ToothMeta): number {
  const key = (meta.upper ? "U" : "L") + (meta.primary ? "p" : "") + meta.n;
  return CROWN_MM[key] ?? (meta.primary ? 5.5 : 8.5);
}

export interface LoadedTooth {
  fdi: number;
  /** geometrías en metros, con los atributos de cara ya calculados */
  geometries: THREE.BufferGeometry[];
  /** materiales originales del glTF (Tooth3D los clona antes de parchearlos) */
  materials: THREE.Material[];
  faces: FaceInfo;
}

interface CacheEntry {
  promise: Promise<LoadedTooth>;
  refs: number;
  last: number;
  /** todos los montajes que esperan este modelo reciben el progreso */
  progress: Set<(pct: number) => void>;
}

const cache = new Map<number, CacheEntry>();
const MAX_CACHED = 6; // arrays de la malla + imágenes decodificadas por diente: no acumular 52
let loader: GLTFLoader | null = null;

function disposeLoaded(t: LoadedTooth) {
  t.geometries.forEach((g) => g.dispose());
  t.materials.forEach((m: any) => {
    ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"].forEach((k) => {
      if (m[k] && m[k].dispose) m[k].dispose();
    });
    m.dispose();
  });
}

function evict() {
  if (cache.size <= MAX_CACHED) return;
  const idle = [...cache.entries()].filter(([, e]) => e.refs <= 0).sort((a, b) => a[1].last - b[1].last);
  while (cache.size > MAX_CACHED && idle.length) {
    const [fdi, e] = idle.shift()!;
    cache.delete(fdi);
    e.promise.then(disposeLoaded).catch(() => {});
  }
}

function parseGltf(fdi: number, meta: ToothMeta, gltf: { scene: THREE.Group }): LoadedTooth {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    // Hornear la transformación del nodo (hoy identidad; por si acaso). Si
    // el nodo espejara (determinante < 0) habría que invertir el sentido de
    // los triángulos para que FrontSide siga mirando hacia fuera.
    if (!m.matrixWorld.equals(new THREE.Matrix4())) {
      g.applyMatrix4(m.matrixWorld);
      if (m.matrixWorld.determinant() < 0 && g.index) {
        const ia = g.index.array as Uint16Array | Uint32Array;
        for (let t = 0; t < ia.length; t += 3) { const tmp = ia[t + 1]; ia[t + 1] = ia[t + 2]; ia[t + 2] = tmp; }
        g.index.needsUpdate = true;
      }
    }
    geometries.push(g);
    materials.push(Array.isArray(m.material) ? m.material[0] : m.material);
  });
  if (!geometries.length) throw new Error(`modelo ${fdi} sin mallas`);
  const faces = classifyFaces(geometries, meta, crownLengthMm(meta) / 1000);
  return { fdi, geometries, materials, faces };
}

/** Pide el modelo de un diente (refcount +1). Llama a releaseTooth al desmontar. */
export function acquireTooth(meta: ToothMeta, onProgress?: (pct: number) => void): Promise<LoadedTooth> {
  const fdi = meta.fdi;
  let e = cache.get(fdi);
  if (!e) {
    if (!loader) {
      loader = new GLTFLoader();
      // Geometría Draco: el decodificador corre en Web Workers que
      // DRACOLoader crea desde un blob: (la CSP ya permite worker-src blob:)
      // y sus dos archivos se piden a DRACO_DECODER_PATH ('self'). Solo se
      // sirve la variante wasm; sin WebAssembly el modelo falla y Tooth3D
      // cae al procedural.
      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_DECODER_PATH);
      draco.setDecoderConfig({ type: "wasm" });
      loader.setDRACOLoader(draco);
      // Las texturas van embebidas en el .glb y GLTFLoader las saca por un
      // blob: URL. Su ImageBitmapLoader las pide con fetch(), y la CSP de la
      // app (connect-src 'self' https: wss:) bloquea blob: → modelo sin
      // textura. TextureLoader las carga con <img>, que img-src sí permite.
      loader.register((parser) => {
        const p = parser as unknown as { textureLoader: THREE.Loader; options: { manager: THREE.LoadingManager; crossOrigin: string } };
        const tl = new THREE.TextureLoader(p.options.manager);
        tl.setCrossOrigin(p.options.crossOrigin);
        p.textureLoader = tl;
        return { name: "odo-texture-loader-csp" };
      });
    }
    const entry: CacheEntry = { promise: null as unknown as Promise<LoadedTooth>, refs: 0, last: Date.now(), progress: new Set() };
    entry.promise = new Promise<LoadedTooth>((resolve, reject) => {
      loader!.load(
        modelUrl(fdi),
        (gltf) => {
          try { resolve(parseGltf(fdi, meta, gltf)); } catch (err) { reject(err); }
        },
        (ev) => {
          if (!ev.total) return;
          const pct = Math.round((ev.loaded / ev.total) * 100);
          entry.progress.forEach((fn) => fn(pct));
        },
        (err) => reject(err),
      );
    });
    e = entry;
    cache.set(fdi, e);
    // solo se borra ESTA entrada: si ya fue desalojada y reemplazada por otra
    // petición del mismo diente, la nueva se queda
    entry.promise.catch(() => { if (cache.get(fdi) === entry) cache.delete(fdi); });
  }
  if (onProgress) e.progress.add(onProgress);
  e.refs++;
  e.last = Date.now();
  return e.promise;
}

export function releaseTooth(fdi: number, onProgress?: (pct: number) => void) {
  const e = cache.get(fdi);
  if (!e) return;
  if (onProgress) e.progress.delete(onProgress);
  e.refs = Math.max(0, e.refs - 1);
  e.last = Date.now();
  evict();
}
