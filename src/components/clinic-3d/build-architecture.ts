// ─────────────────────────────────────────────────────────────────────────────
// A2 — Geometría de arquitectura: piso, muros, puertas, ventanas. Devuelve un
// THREE.Group para añadir a la escena. Sin estado; todo se libera por traversal
// en el dispose del orquestador (geometrías/materiales).
//
// TODO(A2): implementar buildArchitecture según este brief.
//
// PALETA: getPalette(world.category). Materiales MeshStandardMaterial mate
//   (roughness alto ~0.9, metalness 0). Colores claros tipo clínica.
//
// PISO:
//   - Plano que cubre world.bounds (de minX..maxX, minZ..maxZ). y = 0.
//   - Tiles en damero sutil floorA/floorB de 1×1 m: NO crees un mesh por celda
//     (caro). Genera UNA textura de damero por código (CanvasTexture pequeña,
//     ej. 2×2 o 64×64 px) con wrap RepeatWrapping y repeat = (ancho, alto) en
//     metros; aplícala a un PlaneGeometry rotado -90° en X. recibe sombras
//     (receiveShadow = true).
//   - El área fuera de bounds no se dibuja (no caminable).
//
// MUROS (celdas de elementos con isWall):
//   - Cada celda de muro = caja de 1×WALL_HEIGHT×1 (con WALL_THICKNESS si
//     quieres afinar el grosor según wall_h/wall_v, pero una caja por celda
//     ocupada del muro es suficiente y legible).
//   - RENDIMIENTO: NO un mesh por celda. Junta todas las cajas de muro en UNA
//     geometría mergeada (BufferGeometryUtils.mergeGeometries, import
//     "three/examples/jsm/utils/BufferGeometryUtils.js") o usa InstancedMesh.
//     Un solo draw call para todos los muros. castShadow + receiveShadow.
//   - Zócalo: una banda fina (color baseboard) en la base de los muros (opcional
//     pero se ve bien): otra geometría mergeada baja (~0.12 m).
//   - Recorre world.elements; para cada isWall, marca sus celdas ocupadas
//     (rectángulo cols×rows) y añade una caja por celda al merge. Evita duplicar
//     celdas (Set "col,row").
//
// PUERTAS (isDoor): marco (dos postes + dintel) del color accent, con HUECO
//   (sin panel, sin colisión — la colisión ya las excluye). Centra en
//   element.center, rota rotationRad. Si quieres, hoja entreabierta decorativa.
//
// VENTANAS (isWindow): marco delgado + cristal translúcido (MeshStandardMaterial
//   transparent, opacity ~0.25, color claro azulado) a media altura. Centra y
//   rota igual.
//
// TECHO: opcional y MUY tenue (un plano a WALL_HEIGHT con color ceiling, sin
//   sombras) — solo si no perjudica fps; puedes omitirlo.
//
// Devuelve el Group. Nombra el group "architecture".
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  getPalette,
  WALL_HEIGHT,
  WALL_THICKNESS,
  type WorldElement,
  type WorldModel,
  type WorldPalette,
} from "./world-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Material mate tipo clínica (roughness alto, sin metalness). */
function matte(color: string, extra?: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
}

/**
 * Textura de damero 2×2 (un tile A y uno B por cada 2 m → cada celda = 1 m con
 * repeat=(ancho,alto)/2... NO: usamos un canvas 2×2 px donde cada píxel = 1 celda
 * y repeat = (ancho, alto)/2 para que el patrón se repita cada 2 m. Mantenemos el
 * canvas mínimo (2×2) y NearestFilter para tiles nítidos sin coste.
 */
function makeCheckerTexture(a: string, b: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 2;
  cv.height = 2;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, 1, 1); // esquina sup-izq
    ctx.fillRect(1, 1, 1, 1); // esquina inf-der
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter; // tiles de bordes limpios
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace; // los hex de la paleta son sRGB
  return tex;
}

/** Fusiona una lista de cajas (geometrías ya trasladadas) en UNA sola geometría. */
function mergeBoxes(boxes: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (boxes.length === 0) return null;
  const merged = mergeGeometries(boxes, false);
  for (const g of boxes) g.dispose(); // ya copiadas al buffer fusionado
  return merged ?? null;
}

// ── Piso ──────────────────────────────────────────────────────────────────────

function buildFloor(b: WorldModel["bounds"], pal: WorldPalette): THREE.Mesh {
  const minX = num(b?.minX, 0);
  const maxX = num(b?.maxX, 1);
  const minZ = num(b?.minZ, 0);
  const maxZ = num(b?.maxZ, 1);
  const w = Math.max(1, maxX - minX);
  const d = Math.max(1, maxZ - minZ);

  const tex = makeCheckerTexture(pal.floorA, pal.floorB);
  // Cada par de tiles del canvas mide 2 m → repetimos (w/2, d/2) veces para que
  // cada cuadro del damero ocupe exactamente 1 m.
  tex.repeat.set(w / 2, d / 2);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    matte("#ffffff", { map: tex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = "floor";
  return floor;
}

// ── Muros + zócalo ─────────────────────────────────────────────────────────────

/** Celdas ocupadas por todos los muros (sin duplicar). Devuelve [col, row][]. */
function collectWallCells(elements: WorldElement[]): Array<[number, number]> {
  const seen = new Set<string>();
  const cells: Array<[number, number]> = [];
  for (const el of elements ?? []) {
    if (!el || !el.isWall) continue;
    const col0 = Math.round(num(el.col));
    const row0 = Math.round(num(el.row));
    const cols = Math.max(1, Math.round(num(el.cols, 1)));
    const rows = Math.max(1, Math.round(num(el.rows, 1)));
    for (let dc = 0; dc < cols; dc++) {
      for (let dr = 0; dr < rows; dr++) {
        const c = col0 + dc;
        const r = row0 + dr;
        const key = `${c},${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push([c, r]);
      }
    }
  }
  return cells;
}

/**
 * Un mesh mergeado para TODOS los muros (1 draw call) + un mesh mergeado para el
 * zócalo (1 draw call). Cada celda = caja de 1×WALL_HEIGHT×1; el centro de la
 * celda (c,r) en mundo es (c+0.5, r+0.5) — coincide con la convención del parser.
 */
function buildWalls(elements: WorldElement[], pal: WorldPalette): THREE.Object3D[] {
  const cells = collectWallCells(elements);
  if (cells.length === 0) return [];

  const wallBoxes: THREE.BufferGeometry[] = [];
  const baseBoxes: THREE.BufferGeometry[] = [];
  const baseH = Math.min(0.12, WALL_HEIGHT * 0.2);
  const baseInset = 1 + WALL_THICKNESS * 0.5; // zócalo ligeramente más ancho que el muro

  for (const [c, r] of cells) {
    const cx = c + 0.5;
    const cz = r + 0.5;

    const wall = new THREE.BoxGeometry(1, WALL_HEIGHT, 1);
    wall.translate(cx, WALL_HEIGHT / 2, cz);
    wallBoxes.push(wall);

    const base = new THREE.BoxGeometry(baseInset, baseH, baseInset);
    base.translate(cx, baseH / 2, cz);
    baseBoxes.push(base);
  }

  const out: THREE.Object3D[] = [];

  const wallGeo = mergeBoxes(wallBoxes);
  if (wallGeo) {
    const mesh = new THREE.Mesh(wallGeo, matte(pal.wall, { roughness: 0.95 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "walls";
    out.push(mesh);
  }

  const baseGeo = mergeBoxes(baseBoxes);
  if (baseGeo) {
    const mesh = new THREE.Mesh(baseGeo, matte(pal.baseboard, { roughness: 0.85 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "baseboard";
    out.push(mesh);
  }

  return out;
}

// ── Puertas ─────────────────────────────────────────────────────────────────────

/**
 * Marco de puerta (dos postes + dintel) del color accent con HUECO (sin hoja
 * sólida que bloquee; la colisión ya excluye puertas). Hoja entreabierta
 * decorativa, fina. Centrado en el origen local; buildArchitecture lo posiciona
 * y rota. El vano se dibuja a lo largo de X = ancho del footprint base.
 */
function buildDoor(el: WorldElement, pal: WorldPalette): THREE.Group {
  const g = new THREE.Group();
  g.name = "door";

  const span = Math.max(0.9, num(el.baseCols, 1)); // ancho del vano (m)
  const jamb = 0.1; // grosor de poste/dintel
  const height = Math.min(2.1, WALL_HEIGHT - 0.2); // alto del vano
  const frameMat = matte(pal.accent, { roughness: 0.6 });

  // Postes (a izquierda y derecha del vano)
  const postGeo = new THREE.BoxGeometry(jamb, height, jamb * 1.6);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(sx * (span / 2 - jamb / 2), height / 2, 0);
    post.castShadow = true;
    g.add(post);
  }

  // Dintel (arriba)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(span, jamb, jamb * 1.6), frameMat);
  lintel.position.set(0, height - jamb / 2, 0);
  lintel.castShadow = true;
  g.add(lintel);

  // Hoja entreabierta decorativa: panel fino abisagrado en un poste, girado ~35°
  // hacia adentro. No bloquea (es solo visual) y deja el hueco transitable.
  const leafW = span - jamb * 2;
  if (leafW > 0.2) {
    const hinge = new THREE.Group();
    hinge.position.set(-(span / 2 - jamb), 0, 0); // bisagra en el poste izquierdo
    hinge.rotation.y = -Math.PI * 0.2; // entreabierta
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(leafW, height - jamb, 0.04),
      matte("#f3f5f7", { roughness: 0.8 }),
    );
    leaf.position.set(leafW / 2, (height - jamb) / 2, 0); // pivota desde un borde
    leaf.castShadow = true;
    hinge.add(leaf);
    g.add(hinge);
  }

  return g;
}

// ── Ventanas ────────────────────────────────────────────────────────────────────

/**
 * Marco delgado + cristal translúcido a media altura. Centrado en el origen
 * local; se dibuja a lo largo de X = ancho del footprint base.
 */
function buildWindow(el: WorldElement, pal: WorldPalette): THREE.Group {
  const g = new THREE.Group();
  g.name = "window";

  const span = Math.max(0.8, num(el.baseCols, 1));
  const winH = Math.min(1.2, WALL_HEIGHT * 0.5);
  const sillY = Math.max(0.6, (WALL_HEIGHT - winH) / 2); // alto del antepecho
  const cy = sillY + winH / 2; // centro vertical del cristal
  const bar = 0.07; // grosor del marco
  const depth = 0.07;
  const frameMat = matte(pal.accent, { roughness: 0.6 });

  // Marco: dintel + antepecho (horizontales) y dos jambas (verticales)
  const horiz = new THREE.BoxGeometry(span, bar, depth * 1.4);
  for (const y of [sillY, sillY + winH]) {
    const m = new THREE.Mesh(horiz, frameMat);
    m.position.set(0, y, 0);
    m.castShadow = true;
    g.add(m);
  }
  const vert = new THREE.BoxGeometry(bar, winH, depth * 1.4);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(vert, frameMat);
    m.position.set(sx * (span / 2 - bar / 2), cy, 0);
    m.castShadow = true;
    g.add(m);
  }

  // Cristal translúcido
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.1, span - bar), Math.max(0.1, winH - bar)),
    new THREE.MeshStandardMaterial({
      color: "#cfe3f2",
      roughness: 0.1,
      metalness: 0,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.set(0, cy, 0);
  glass.name = "glass";
  g.add(glass);

  return g;
}

// ── Entrada principal ────────────────────────────────────────────────────────────

export function buildArchitecture(world: WorldModel): THREE.Group {
  const group = new THREE.Group();
  group.name = "architecture";

  // Nunca lanzar por datos raros: cada paso aísla sus fallos.
  try {
    const pal = getPalette(world?.category ?? "");
    const bounds = world?.bounds ?? { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    const elements = Array.isArray(world?.elements) ? world.elements : [];

    // Piso
    group.add(buildFloor(bounds, pal));

    // Muros + zócalo (1 draw call cada uno)
    for (const m of buildWalls(elements, pal)) group.add(m);

    // Puertas y ventanas: centradas en el centro del footprint y rotadas
    for (const el of elements) {
      if (!el) continue;
      if (el.isDoor) {
        const door = buildDoor(el, pal);
        door.position.set(num(el.center?.x), 0, num(el.center?.z));
        door.rotation.y = num(el.rotationRad);
        group.add(door);
      } else if (el.isWindow) {
        const win = buildWindow(el, pal); // la geometría ya sitúa el cristal a media altura
        win.position.set(num(el.center?.x), 0, num(el.center?.z));
        win.rotation.y = num(el.rotationRad);
        group.add(win);
      }
    }
  } catch {
    /* Datos corruptos: devolvemos lo construido hasta aquí (al menos el grupo). */
  }

  return group;
}
