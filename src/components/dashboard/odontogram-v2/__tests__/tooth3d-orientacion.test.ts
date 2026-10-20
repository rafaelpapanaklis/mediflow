/**
 * ws1-t11 — orientación de los .glb del odontograma 3D.
 *
 * Los modelos de Dundee NO traen la vestibular en +Z (lo dice su LEEME, pero
 * los permanentes conservan el marco de la arcada y los temporales vienen
 * alineados cada uno a su manera). En premolares y molares las cuatro caras
 * laterales salían corridas una cara: lo que el panel llamaba V era la
 * mesial real. tooth3d-model.orientTooth gira cada diente con VESTIBULAR_DEG
 * y centra la corona; estas pruebas decodifican los .glb REALES (Draco) y
 * comprueban sobre la anatomía, no sobre la tabla, que la vestibular quedó
 * en +Z y la mesial del lado de mesialSign.
 *
 * Run: npx tsx --test src/components/dashboard/odontogram-v2/__tests__/tooth3d-orientacion.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { classify } from "../data";
import { classifyFaces, letterAtFace, mesialSign } from "../tooth3d-faces";
import { crownLengthMm, leftModelFdi, orientTooth, VESTIBULAR_DEG, vestibularRotationY } from "../tooth3d-model";

const ROOT = path.resolve(__dirname, "../../../../..");
const PUB = path.join(ROOT, "public/odontograma");
const LEFT = [21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75];
const ALL = [11, 12, 13, 14, 15, 16, 17, 18, 41, 42, 43, 44, 45, 46, 47, 48, 51, 52, 53, 54, 55, 81, 82, 83, 84, 85, ...LEFT];

let ioPromise: Promise<NodeIO> | null = null;
function io(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      // el mismo decodificador que sirve el panel (wrapper de three, UMD/CJS)
      const req = createRequire(path.join(ROOT, "package.json"));
      const Draco = req(path.join(PUB, "draco/draco_wasm_wrapper.js"));
      const decoder = await Draco({ wasmBinary: fs.readFileSync(path.join(PUB, "draco/draco_decoder.wasm")) });
      return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": decoder });
    })();
  }
  return ioPromise;
}

/** Carga el .glb, lo orienta como en el panel y clasifica sus caras. Posiciones en mm. */
async function load(fdi: number) {
  const doc = await (await io()).read(path.join(PUB, "dientes-3d", fdi >= 51 ? "temporales" : "permanentes", `${fdi}.glb`));
  const meta = classify(fdi);
  const geoms: THREE.BufferGeometry[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p.getAttribute("POSITION")!.getArray()!), 3));
      const n = p.getAttribute("NORMAL");
      if (n) g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n.getArray()!), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(p.getIndices()!.getArray()!), 1));
      geoms.push(g);
    }
  }
  const crownLen = crownLengthMm(meta) / 1000;
  orientTooth(geoms, meta, crownLen);
  const faces = classifyFaces(geoms, meta, crownLen);
  const pts: [number, number, number][] = [];
  geoms.forEach((g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) pts.push([p.getX(i) * 1000, p.getY(i) * 1000, p.getZ(i) * 1000]);
  });
  const tip = meta.upper ? -1 : 1;
  const hs = pts.map((q) => tip * q[1]);
  const hMax = Math.max(...hs), hMin = Math.min(...hs);
  return { meta, geoms, faces, pts, hs, hMax, hMin, crownMm: crownLen * 1000 };
}

type Tooth = Awaited<ReturnType<typeof load>>;

/** Raíces cortadas a una altura (fracción de la longitud desde el ápice): grupos conexos en XZ. */
function rootsAt(t: Tooth, frac = 0.3) {
  const level = t.hMin + frac * (t.hMax - t.hMin);
  const sl = t.pts.filter((_, i) => Math.abs(t.hs[i] - level) < 0.2).map((q) => [q[0], q[2]] as [number, number]);
  const parent = sl.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cell = new Map<string, number[]>();
  sl.forEach(([x, z], i) => {
    const k = `${Math.floor(x / 0.6)},${Math.floor(z / 0.6)}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(i);
  });
  sl.forEach(([x, z], i) => {
    const cx = Math.floor(x / 0.6), cz = Math.floor(z / 0.6);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const j of cell.get(`${cx + a},${cz + b}`) ?? []) {
        if (j <= i) continue;
        if (Math.hypot(sl[j][0] - x, sl[j][1] - z) < 0.6) parent[find(j)] = find(i);
      }
    }
  });
  const groups = new Map<number, [number, number][]>();
  sl.forEach((q, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(q); });
  return [...groups.values()].filter((g) => g.length >= 15).map((g) => {
    const xs = g.map((q) => q[0]), zs = g.map((q) => q[1]);
    return {
      x: xs.reduce((s, v) => s + v, 0) / g.length, z: zs.reduce((s, v) => s + v, 0) / g.length, n: g.length,
      zExt: Math.max(...zs) - Math.min(...zs),
    };
  });
}

test("la tabla cubre exactamente los 26 modelos izquierdos y cada diente derecho usa su espejo", () => {
  assert.deepEqual(Object.keys(VESTIBULAR_DEG).map(Number).sort((a, b) => a - b), [...LEFT].sort((a, b) => a - b));
  for (const fdi of ALL) {
    const meta = classify(fdi);
    const left = leftModelFdi(fdi);
    assert.ok(LEFT.includes(left), `${fdi} → ${left} no está en la tabla`);
    assert.equal(left % 10, fdi % 10);
    if (meta.right) {
      const twin = classify(left);
      assert.ok(Math.abs(vestibularRotationY(meta) + vestibularRotationY(twin)) < 1e-12, `${fdi} no es el espejo de ${left}`);
    } else {
      assert.equal(left, fdi);
    }
  }
});

test("molares inferiores: las dos raíces (mesial y distal) quedan separadas en X", async () => {
  for (const fdi of [36, 37, 46, 47, 74, 75, 84, 85]) {
    const t = await load(fdi);
    const r = rootsAt(t).sort((a, b) => b.n - a.n).slice(0, 2);
    assert.equal(r.length, 2, `${fdi}: se esperaban 2 raíces, hay ${r.length}`);
    const dx = Math.abs(r[0].x - r[1].x), dz = Math.abs(r[0].z - r[1].z);
    assert.ok(dx > 2 * dz, `${fdi}: raíces en (${r[0].x.toFixed(1)}, ${r[0].z.toFixed(1)}) y (${r[1].x.toFixed(1)}, ${r[1].z.toFixed(1)}): no van de mesial a distal`);
  }
});

test("molares superiores: la raíz palatina queda en −Z y las dos vestibulares en +Z, mesial del lado de mesialSign", async () => {
  for (const fdi of [26, 16, 64, 65, 54, 55]) {
    const t = await load(fdi);
    const r = rootsAt(t).sort((a, b) => b.n - a.n).slice(0, 3).sort((a, b) => a.z - b.z);
    assert.equal(r.length, 3, `${fdi}: se esperaban 3 raíces, hay ${r.length}`);
    const [pal, b1, b2] = r;
    assert.ok(pal.z < 0, `${fdi}: palatina en z=${pal.z.toFixed(1)}`);
    assert.ok(b1.z > 0 && b2.z > 0, `${fdi}: vestibulares en z=${b1.z.toFixed(1)}, ${b2.z.toFixed(1)}`);
    // las vestibulares (mesio y distovestibular) se separan a lo largo de X
    assert.ok(Math.abs(b1.x - b2.x) > 2 * Math.abs(b1.z - b2.z), `${fdi}: vestibulares no separadas en X`);
  }
});

test("14/24: raíz vestibular y palatina separadas en Z", async () => {
  for (const fdi of [14, 24]) {
    const t = await load(fdi);
    const r = rootsAt(t, 0.25).sort((a, b) => b.n - a.n).slice(0, 2);
    assert.equal(r.length, 2, `${fdi}: se esperaban 2 raíces, hay ${r.length}`);
    assert.ok(Math.abs(r[0].z - r[1].z) > 2 * Math.abs(r[0].x - r[1].x), `${fdi}: raíces no separadas en Z`);
  }
});

test("premolares: la cúspide más alta (la vestibular) queda en +Z", async () => {
  for (const fdi of [14, 15, 24, 25, 34, 35, 44, 45]) {
    const t = await load(fdi);
    const i = t.hs.indexOf(t.hMax);
    assert.ok(t.pts[i][2] > 0.5, `${fdi}: cúspide más alta en z=${t.pts[i][2].toFixed(1)}`);
  }
});

test("molares inferiores: la raíz mesial (la más ancha de vestibular a lingual) queda del lado de mesialSign", async () => {
  // (en 75/85 las dos raíces son casi igual de anchas: lo cubre la prueba de la cúspide mesiolingual)
  for (const fdi of [36, 37, 46, 47, 74, 84]) {
    const t = await load(fdi);
    const ms = mesialSign(t.meta);
    const [a, b] = rootsAt(t).sort((p, q) => q.n - p.n).slice(0, 2);
    const mesial = a.zExt > b.zExt ? a : b, distal = mesial === a ? b : a;
    assert.ok((mesial.x - distal.x) * ms > 0, `${fdi}: la raíz ancha (${mesial.zExt.toFixed(1)} mm) está en x=${mesial.x.toFixed(1)}, del lado distal`);
  }
});

test("75/85 (llegaban casi del revés): la cúspide más alta, la mesiolingual, queda en −Z y del lado mesial", async () => {
  for (const fdi of [75, 85]) {
    const t = await load(fdi);
    const q = t.pts[t.hs.indexOf(t.hMax)];
    assert.ok(q[2] < -0.5, `${fdi}: cúspide más alta en z=${q[2].toFixed(1)}`);
    assert.ok(q[0] * mesialSign(t.meta) > 0.5, `${fdi}: cúspide más alta en x=${q[0].toFixed(1)}, del lado distal`);
  }
});

test("anteriores: el borde incisal queda a lo largo de X", async () => {
  for (const fdi of [11, 21, 22, 23, 31, 32, 33, 41, 61, 62, 63, 71, 72, 73]) {
    const t = await load(fdi);
    const top = t.pts.filter((_, i) => t.hs[i] > t.hMax - 1.2);
    const mx = top.reduce((s, q) => s + q[0], 0) / top.length, mz = top.reduce((s, q) => s + q[2], 0) / top.length;
    let sxx = 0, szz = 0, sxz = 0;
    top.forEach((q) => { const a = q[0] - mx, b = q[2] - mz; sxx += a * a; szz += b * b; sxz += a * b; });
    // ángulo del eje mayor con X
    const ang = (0.5 * Math.atan2(2 * sxz, sxx - szz) * 180) / Math.PI;
    assert.ok(Math.abs(ang) < 30, `${fdi}: borde incisal a ${ang.toFixed(0)}° de X`);
  }
});

test("letterAtFace: el triángulo más vestibular es V, el más lingual L, el más mesial M y el más distal D", async () => {
  for (const fdi of [11, 21, 13, 23, 14, 24, 16, 26, 36, 46, 34, 44, 61, 64, 74, 75, 85]) {
    const t = await load(fdi);
    const ms = mesialSign(t.meta);
    const hNeck = (t.hMax - t.crownMm) / 1000;
    const tip = t.meta.upper ? -1 : 1;
    // el triángulo más saliente hacia cada cara, en todas las mallas (64 viene en 6 trozos)
    const ext: Record<string, { s: number; g: THREE.BufferGeometry | null; f: number }> = {
      V: { s: -Infinity, g: null, f: -1 }, L: { s: -Infinity, g: null, f: -1 },
      M: { s: -Infinity, g: null, f: -1 }, D: { s: -Infinity, g: null, f: -1 },
    };
    for (const g of t.geoms) {
      const pos = g.attributes.position, idx = g.index!;
      for (let f = 0; f < idx.count / 3; f++) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) { const v = idx.getX(f * 3 + k); x += pos.getX(v) / 3; y += pos.getY(v) / 3; z += pos.getZ(v) / 3; }
        // entre el cuello y la mitad: en los molares temporales la vestibular
        // converge mucho hacia oclusal y su tercio alto ya es la vertiente oclusal
        const hn = (tip * y - hNeck) / (t.crownMm / 1000);
        if (hn < 0.25 || hn > 0.5) continue;
        // solo en la franja central de cada cara: las esquinas (aristas) son de dos caras
        const midX = Math.abs(x) < 0.3 * t.faces.halfX, midZ = Math.abs(z) < 0.3 * t.faces.halfZ;
        const score: Record<string, number> = { V: midX ? z : -Infinity, L: midX ? -z : -Infinity, M: midZ ? x * ms : -Infinity, D: midZ ? -x * ms : -Infinity };
        for (const k of Object.keys(ext)) if (score[k] > ext[k].s) ext[k] = { s: score[k], g, f };
      }
    }
    for (const k of Object.keys(ext)) {
      const got = letterAtFace(ext[k].g!, ext[k].f, t.meta.center);
      assert.equal(got, k, `${fdi}: el triángulo más ${k} sale ${got}`);
    }
  }
});

test("anteriores: la mitad incisal de la cara lingual es L, no M/D (antes M/D iba solo por la posición en X)", async () => {
  for (const fdi of [11, 21, 22, 13, 23, 31, 33, 61, 63, 71, 73]) {
    const t = await load(fdi);
    const hNeck = (t.hMax - t.crownMm) / 1000;
    const tip = t.meta.upper ? -1 : 1;
    let total = 0, asL = 0;
    for (const g of t.geoms) {
      const pos = g.attributes.position, idx = g.index!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let f = 0; f < idx.count / 3; f++) {
        a.fromBufferAttribute(pos, idx.getX(f * 3)); b.fromBufferAttribute(pos, idx.getX(f * 3 + 1)); c.fromBufferAttribute(pos, idx.getX(f * 3 + 2));
        const hn = (tip * (a.y + b.y + c.y) / 3 - hNeck) / (t.crownMm / 1000);
        if (hn < 0.45 || hn > 0.8) continue;
        const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
        if (n.z > -0.6) continue; // solo lo que mira de frente a lingual
        total++;
        if (letterAtFace(g, f, t.meta.center) === "L") asL++;
      }
    }
    assert.ok(total > 50, `${fdi}: muy pocos triángulos linguales (${total})`);
    // medido: 76–98 % con el arreglo; 9–28 % antes
    assert.ok(asL / total > 0.7, `${fdi}: solo el ${Math.round((100 * asL) / total)} % de la lingual incisal sale L`);
  }
});
