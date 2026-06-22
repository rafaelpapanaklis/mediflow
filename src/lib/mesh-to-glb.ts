// Conversión SERVIDOR de mallas (STL/PLY/OBJ) → GLB web-optimizado.
//
// El GLB es SOLO una versión ligera para visualizar rápido en el navegador
// (decimación moderada + compresión Meshopt). NO sustituye al archivo original,
// que se conserva intacto para CAM/impresión. Pensado para correr en el route
// de subida (runtime nodejs); el caller lo trata como best-effort: si lanza,
// la subida del original NO debe fallar.
//
// Pipeline:
//   1. Parseo con los loaders de three (los mismos que usa el visor cliente).
//   2. weld()      → malla indexada y deduplicada (requisito de simplify).
//   3. simplify()  → decimación moderada con MeshoptSimplifier (bordes bloqueados).
//   4. normales suaves recalculadas sobre la malla YA decimada.
//   5. meshopt()   → EXT_meshopt_compression (+ KHR_mesh_quantization).

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Document, NodeIO, Logger } from "@gltf-transform/core";
import { KHRMeshQuantization, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { weld, simplify, prune, dedup, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from "meshoptimizer";

export type MeshExt = "stl" | "ply" | "obj";

export function isConvertibleMeshExt(ext: string): ext is MeshExt {
  const e = ext.toLowerCase();
  return e === "stl" || e === "ply" || e === "obj";
}

// Presupuesto de triángulos para la vista web. Por encima se decima a este
// tope; entre el umbral suave y el tope se decima moderado; por debajo se
// conserva la malla (solo se comprime, sin perder detalle).
const WEB_TRIANGLE_BUDGET = 250_000;
const SOFT_DECIMATE_ABOVE = 50_000;
const SOFT_DECIMATE_RATIO = 0.6;

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

// OBJ puede traer varios meshes; fusionamos SUS posiciones (en world-space) en
// una sola malla no indexada. Ignoramos materiales/uv: solo geometría para ver.
function objToPositions(group: THREE.Object3D): Float32Array {
  group.updateMatrixWorld(true);
  const chunks: Float32Array[] = [];
  const v = new THREE.Vector3();
  group.traverse((o: any) => {
    if (!o.isMesh || !o.geometry) return;
    let g: THREE.BufferGeometry = o.geometry;
    if (g.index) g = g.toNonIndexed();
    const pos = g.getAttribute("position");
    if (!pos) return;
    const arr = Float32Array.from(pos.array as ArrayLike<number>);
    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(o.matrixWorld);
      arr[i] = v.x;
      arr[i + 1] = v.y;
      arr[i + 2] = v.z;
    }
    chunks.push(arr);
  });
  const total = chunks.reduce((s, c) => s + c.length, 0);
  if (total === 0) throw new Error("OBJ sin geometría");
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// Parseo crudo → posiciones (+ índice si el formato lo trae). El weld/dedup lo
// hace gltf-transform después; aquí solo extraemos la geometría base.
function parseRaw(
  input: ArrayBuffer | Uint8Array,
  ext: MeshExt,
): { position: Float32Array; index: Uint32Array | null } {
  const ab = toArrayBuffer(input);

  if (ext === "obj") {
    const text = new TextDecoder().decode(new Uint8Array(ab));
    const group = new OBJLoader().parse(text);
    return { position: objToPositions(group), index: null };
  }

  const raw = ext === "stl" ? new STLLoader().parse(ab) : new PLYLoader().parse(ab);
  const pos = raw.getAttribute("position");
  if (!pos || pos.count === 0) throw new Error(`malla ${ext} sin vértices`);
  const position = Float32Array.from(pos.array as ArrayLike<number>);
  const index = raw.index ? Uint32Array.from(raw.index.array as ArrayLike<number>) : null;
  return { position, index };
}

function pickRatio(triCount: number): number {
  if (triCount > WEB_TRIANGLE_BUDGET) return WEB_TRIANGLE_BUDGET / triCount;
  if (triCount > SOFT_DECIMATE_ABOVE) return SOFT_DECIMATE_RATIO;
  return 1; // malla pequeña: se conserva, solo se comprime
}

// Recalcula normales suaves sobre la malla ya decimada. Las normales por-cara
// del STL original dejan de ser válidas tras el weld+simplify; sin esto el
// visor ilumina mal. Reutiliza three (computeVertexNormals) para no reinventar.
function regenerateNormals(doc: any, prim: any, buffer: any): void {
  const posArr = prim.getAttribute("POSITION").getArray() as Float32Array;
  const idxAcc = prim.getIndices();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(posArr as any, 3));
  if (idxAcc) g.setIndex(new THREE.BufferAttribute(idxAcc.getArray() as any, 1));
  g.computeVertexNormals();
  const normal = Float32Array.from(g.getAttribute("normal").array as ArrayLike<number>);
  prim.setAttribute(
    "NORMAL",
    doc.createAccessor().setType("VEC3").setArray(normal as any).setBuffer(buffer),
  );
}

export async function convertMeshToWebGlb(
  input: ArrayBuffer | Uint8Array,
  ext: MeshExt,
): Promise<Uint8Array> {
  const { position, index } = parseRaw(input, ext);
  const triCount = index ? index.length / 3 : position.length / 9;
  if (triCount < 1) throw new Error("malla sin triángulos");

  // Documento glTF mínimo: una malla, un primitive, una escena.
  const doc = new Document();
  // Los transforms de gltf-transform imprimen INFO por defecto (p. ej. "prune:
  // Removed…"); lo silenciamos para no ensuciar los logs del servidor.
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  // setArray(... as any): gltf-transform tipa el array como Float32Array<ArrayBuffer>
  // y TS lo ve como Float32Array<ArrayBufferLike>; el dato en runtime es correcto.
  const posAcc = doc.createAccessor().setType("VEC3").setArray(position as any).setBuffer(buffer);
  const prim = doc.createPrimitive().setMode(4 /* TRIANGLES */).setAttribute("POSITION", posAcc);
  if (index) {
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(index as any).setBuffer(buffer));
  }
  const mesh = doc.createMesh().addPrimitive(prim);
  doc.createScene().addChild(doc.createNode().setMesh(mesh));

  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;

  const ratio = pickRatio(triCount);
  const transforms: any[] = [weld()];
  if (ratio < 1) {
    transforms.push(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: true }),
    );
  }
  transforms.push(prune(), dedup());
  await doc.transform(...transforms);

  // Normales sobre la malla final (post-decimación).
  const finalPrim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  regenerateNormals(doc, finalPrim, buffer);

  // Compresión Meshopt (cuantización + EXT_meshopt_compression).
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));

  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

  return io.writeBinary(doc);
}
