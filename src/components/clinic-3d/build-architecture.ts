// ─────────────────────────────────────────────────────────────────────────────
// A2 — Geometría de arquitectura: PISO, MUROS, TECHO, puertas, ventanas. Devuelve
// un THREE.Group para añadir a la escena. Sin estado de runtime; todo se libera
// por traversal en el dispose del orquestador (geometrías/materiales/texturas).
//
// SALTO GRÁFICO (brief D) — sin tocar el merge/instancing ni el performance:
//
// PISO: tiles satinados (roughness ~0.6) con líneas de boquilla (grout) por
//   metro vía CanvasTexture ≤256px reutilizada (repeat por metro); variación de
//   color por categoría (getPalette). receiveShadow.
//
// MUROS: zócalo oscuro (~0.12 m) + remate superior; textura sutil de pintura
//   (ruido suave ≤256px reutilizado); postes redondeados (cilindros) en las
//   esquinas donde concurren muros; cara interior un punto más clara que la
//   exterior (segundo material en el grupo de caras). EL GRUESO de los muros
//   sigue en UN solo draw call (geometría mergeada; NO un mesh por celda).
//
// TECHO: plano a WALL_HEIGHT (color ceiling) con PANELES DE LUZ empotrados =
//   planos emissive cálidos (#fff4e0) en rejilla cada ~4-5 m dentro de bounds.
//   Los paneles SIEMPRE emissive (de noche son la luz principal; el orquestador
//   baja el ambient). El techo está a 2.6 m y los ojos a 1.6 m → no tapa cámara.
//
// PUERTAS (isDoor): SOLO EL MARCO (dos postes + dintel + umbral), sin hoja. La
//   hoja animada la dibuja doors.ts. Centra en element.center, rota rotationRad.
//
// VENTANAS (isWindow): marco (metalness leve) + cristal translúcido a media
//   altura. Centra y rota igual.
//
// RENDIMIENTO: texturas procedurales ≤256px cacheadas en variables de módulo y
//   reutilizadas; el grueso de muros y el zócalo en 1 draw call cada uno; los
//   postes de esquina mergeados en 1 draw call. Nunca lanzar por datos raros.
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

// ── Texturas procedurales cacheadas (≤256px, reutilizadas entre builds) ─────────
// Un único viewer renderiza un mundo a la vez; el dispose del orquestador libera
// por traversal los materiales (y con ellos sus .map). Cacheamos por clave de
// color para no regenerar el canvas en cada carga. El `repeat` se fija por uso.

const _noiseCache = new Map<string, THREE.CanvasTexture>();
const _groutCache = new Map<string, THREE.CanvasTexture>();
const _paintBumpCache = new Map<string, THREE.CanvasTexture>();

/**
 * Ruido suave (grano de pintura) en escala de grises sobre un tinte base. Canvas
 * 128px, blur por superposición de puntos translúcidos. Reutilizable como `map`
 * sutil de muro: aporta micro-variación sin romper el color plano de la paleta.
 */
function makePaintTexture(base: string): THREE.CanvasTexture {
  const hit = _noiseCache.get(base);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    // Motas claras/oscuras muy tenues → aspecto de pintura mate.
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const r = 0.6 + Math.random() * 1.4;
      const light = Math.random() > 0.5;
      ctx.fillStyle = light ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.045)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _noiseCache.set(base, tex);
  return tex;
}

/**
 * Mapa de relieve (bump) de grano fino, neutro y barato: lo comparten todos los
 * muros para dar textura de pintura sin segundo color. Una sola textura global.
 */
function makePaintBump(): THREE.CanvasTexture {
  const hit = _paintBumpCache.get("bump");
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 128, 128);
    const img = ctx.getImageData(0, 0, 128, 128);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = 128 + (Math.random() * 30 - 15); // ±15 alrededor del gris medio
      d[i] = n;
      d[i + 1] = n;
      d[i + 2] = n;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _paintBumpCache.set("bump", tex);
  return tex;
}

/**
 * Tile de piso 1 m con damero sutil A/B + líneas de boquilla (grout). Canvas
 * 256px = 2×2 celdas; el grout se dibuja en los bordes de cada celda. Con
 * repeat = (ancho, alto)/2 cada cuadro mide 1 m y las boquillas caen por metro.
 * Reutilizado entre builds (clave por par de colores).
 */
function makeFloorTexture(a: string, b: string): THREE.CanvasTexture {
  const key = `${a}|${b}`;
  const hit = _groutCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const half = 128; // 1 celda = 1 m
    // Damero base.
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
    // Veteado muy leve dentro de cada tile (porcelanato satinado).
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
    }
    // Líneas de boquilla en los bordes de cada celda de 1 m.
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, half - 1, half - 1);
    ctx.strokeRect(half + 0.5, 0.5, half - 1, half - 1);
    ctx.strokeRect(0.5, half + 0.5, half - 1, half - 1);
    ctx.strokeRect(half + 0.5, half + 0.5, half - 1, half - 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; // boquillas nítidas en ángulo rasante (barato)
  _groutCache.set(key, tex);
  return tex;
}

/** Fusiona una lista de geometrías (ya trasladadas) en UNA sola geometría. */
function mergeBoxes(boxes: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (boxes.length === 0) return null;
  const merged = mergeGeometries(boxes, false);
  for (const g of boxes) g.dispose(); // ya copiadas al buffer fusionado
  return merged ?? null;
}

/** Aclara un hex sRGB hacia blanco por factor t (0..1). Para caras interiores. */
function lighten(hex: string, t: number): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), t);
  return `#${c.getHexString()}`;
}

// ── Piso ──────────────────────────────────────────────────────────────────────

function buildFloor(b: WorldModel["bounds"], pal: WorldPalette): THREE.Mesh {
  const minX = num(b?.minX, 0);
  const maxX = num(b?.maxX, 1);
  const minZ = num(b?.minZ, 0);
  const maxZ = num(b?.maxZ, 1);
  const w = Math.max(1, maxX - minX);
  const d = Math.max(1, maxZ - minZ);

  // Tile satinado con damero sutil + boquilla. El canvas cubre 2×2 m → repeat
  // (w/2, d/2) deja cada cuadro y cada línea de boquilla por metro exacto.
  const tex = makeFloorTexture(pal.floorA, pal.floorB);
  tex.repeat.set(w / 2, d / 2);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    // Acabado satinado: roughness media para reflejos suaves de los paneles.
    matte("#ffffff", { map: tex, roughness: 0.6, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = "floor";
  // El map del piso está CACHEADO a nivel de módulo (makeFloorTexture) y se
  // reutiliza entre builds: marca sharedMap para que el dispose del orquestador
  // libere el material pero NO la textura cacheada (si no, la 2ª construcción —
  // p.ej. Strict Mode/Fast Refresh/re-mount — reusaría una textura ya disposed).
  floor.userData.sharedMap = true;
  return floor;
}

// ── Muros + zócalo ─────────────────────────────────────────────────────────────

/** Celdas ocupadas por todos los muros (sin duplicar). Devuelve un Set y lista. */
function collectWallCells(elements: WorldElement[]): {
  set: Set<string>;
  cells: Array<[number, number]>;
} {
  const set = new Set<string>();
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
        if (set.has(key)) continue;
        set.add(key);
        cells.push([c, r]);
      }
    }
  }
  return { set, cells };
}

/**
 * Muros con salto gráfico, sin perder el merge:
 *   - "walls"     → grueso de los muros en UN draw call (caja WALL_THICKNESS de
 *                   ancho por celda, tono interior un punto más claro, con mapa
 *                   sutil de pintura + bump compartido).
 *   - "wall-cap"  → remate superior en UN draw call (banda fina sobre el muro).
 *   - "baseboard" → zócalo oscuro ~0.12 m en UN draw call.
 *   - "wall-posts"→ postes redondeados (cilindros) SOLO en esquinas/junciones,
 *                   mergeados en UN draw call.
 * La cámara siempre está DENTRO de la clínica, así que el tono interior (más
 * claro) es el que domina; el zócalo oscuro y el remate dan el contraste de
 * "cara exterior vs interior" pedido sin un segundo pase por cara.
 * Centro de celda (c,r) en mundo = (c+0.5, r+0.5).
 */
function buildWalls(elements: WorldElement[], pal: WorldPalette): THREE.Object3D[] {
  const { set, cells } = collectWallCells(elements);
  if (cells.length === 0) return [];

  const t = WALL_THICKNESS; // grosor visual del muro (más esbelto que 1 m)
  const baseH = Math.min(0.12, WALL_HEIGHT * 0.2); // zócalo 12 cm
  const baseT = t + 0.03; // zócalo sobresale un poco del muro
  const capH = 0.06; // remate superior
  const capT = t + 0.04;

  const wallBoxes: THREE.BufferGeometry[] = [];
  const baseBoxes: THREE.BufferGeometry[] = [];
  const capBoxes: THREE.BufferGeometry[] = [];

  for (const [c, r] of cells) {
    const cx = c + 0.5;
    const cz = r + 0.5;

    // ¿El tramo corre en X (vecinos E/O) o en Z (vecinos N/S)? Orienta la caja
    // delgada a lo largo del tramo para que el muro se vea como una pared, no un
    // cubo. Si es aislado o esquina, usa cuadrado del grosor.
    const hN = set.has(`${c - 1},${r}`) || set.has(`${c + 1},${r}`);
    const vN = set.has(`${c},${r - 1}`) || set.has(`${c},${r + 1}`);
    const sx = hN || !vN ? 1 : t; // ancho en X
    const sz = vN ? 1 : t;        // ancho en Z

    const wall = new THREE.BoxGeometry(sx, WALL_HEIGHT, sz);
    wall.translate(cx, WALL_HEIGHT / 2, cz);
    wallBoxes.push(wall);

    const base = new THREE.BoxGeometry(sx + (sx > t ? 0.03 : baseT - t), baseH, sz + (sz > t ? 0.03 : baseT - t));
    base.translate(cx, baseH / 2, cz);
    baseBoxes.push(base);

    const cap = new THREE.BoxGeometry(sx + (sx > t ? 0.04 : capT - t), capH, sz + (sz > t ? 0.04 : capT - t));
    cap.translate(cx, WALL_HEIGHT - capH / 2, cz);
    capBoxes.push(cap);
  }

  // Postes redondeados en esquinas/junciones (donde concurren tramos H y V).
  const postBoxes: THREE.BufferGeometry[] = [];
  const postR = t * 0.62;
  for (const [c, r] of cells) {
    const hN = set.has(`${c - 1},${r}`) || set.has(`${c + 1},${r}`);
    const vN = set.has(`${c},${r - 1}`) || set.has(`${c},${r + 1}`);
    if (!(hN && vN)) continue; // solo verdaderas esquinas / cruces / T
    const post = new THREE.CylinderGeometry(postR, postR, WALL_HEIGHT, 10, 1);
    post.translate(c + 0.5, WALL_HEIGHT / 2, r + 0.5);
    postBoxes.push(post);
  }

  const out: THREE.Object3D[] = [];

  // Materiales: pintura mate con micro-ruido + bump compartido. Tono interior
  // un punto más claro que la paleta base (la cámara ve el interior).
  const paintMap = makePaintTexture(lighten(pal.wall, 0.06));
  paintMap.repeat.set(1, WALL_HEIGHT / 2);
  const bump = makePaintBump();
  bump.repeat.set(2, WALL_HEIGHT);
  const wallMat = matte(lighten(pal.wall, 0.06), {
    map: paintMap,
    bumpMap: bump,
    bumpScale: 0.012,
    roughness: 0.92,
  });

  const wallGeo = mergeBoxes(wallBoxes);
  if (wallGeo) {
    const mesh = new THREE.Mesh(wallGeo, wallMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "walls";
    // map/bumpMap del muro vienen de caches de módulo (makePaintTexture/
    // makePaintBump) reutilizados entre builds → no los dispongas en el cleanup.
    mesh.userData.sharedMap = true;
    out.push(mesh);
  }

  const capGeo = mergeBoxes(capBoxes);
  if (capGeo) {
    // Remate del tono del zócalo: cierra el muro arriba como una cornisa fina.
    const mesh = new THREE.Mesh(capGeo, matte(pal.baseboard, { roughness: 0.8 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "wall-cap";
    out.push(mesh);
  }

  const baseGeo = mergeBoxes(baseBoxes);
  if (baseGeo) {
    const mesh = new THREE.Mesh(baseGeo, matte(pal.baseboard, { roughness: 0.7 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "baseboard";
    out.push(mesh);
  }

  const postGeo = mergeBoxes(postBoxes);
  if (postGeo) {
    // Postes del tono del muro pero un toque más definidos (sin map, leen como
    // columnas redondeadas que rematan las esquinas).
    const mesh = new THREE.Mesh(postGeo, matte(lighten(pal.wall, 0.1), { roughness: 0.85 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "wall-posts";
    out.push(mesh);
  }

  return out;
}

// ── Puertas ─────────────────────────────────────────────────────────────────────

/**
 * SOLO EL MARCO de la puerta (dos jambas + dintel + umbral fino), con el HUECO
 * libre. La HOJA animada la dibuja doors.ts (módulo aparte) — aquí NO se dibuja
 * ninguna hoja. Centrado en el origen local; buildArchitecture lo posiciona y
 * rota. El vano corre a lo largo de X = ancho del footprint base.
 */
function buildDoor(el: WorldElement, pal: WorldPalette): THREE.Group {
  const g = new THREE.Group();
  g.name = "door-frame";

  const span = Math.max(0.9, num(el.baseCols, 1)); // ancho del vano (m)
  const jamb = 0.1; // grosor de jamba/dintel
  const depth = jamb * 1.8; // canto del marco (atraviesa el grosor del muro)
  const height = Math.min(2.1, WALL_HEIGHT - 0.2); // alto del vano
  const frameMat = matte(pal.accent, { roughness: 0.5, metalness: 0.1 });

  // Jambas (izquierda y derecha del vano)
  const jambGeo = new THREE.BoxGeometry(jamb, height, depth);
  for (const dir of [-1, 1]) {
    const post = new THREE.Mesh(jambGeo, frameMat);
    post.position.set(dir * (span / 2 - jamb / 2), height / 2, 0);
    post.castShadow = true;
    g.add(post);
  }

  // Dintel (arriba), cubriendo todo el ancho del vano.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(span, jamb, depth), frameMat);
  lintel.position.set(0, height - jamb / 2, 0);
  lintel.castShadow = true;
  g.add(lintel);

  // Umbral fino a ras de piso (remata el hueco abajo sin estorbar el paso).
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(span, 0.02, depth),
    matte(pal.baseboard, { roughness: 0.7 }),
  );
  sill.position.set(0, 0.01, 0);
  sill.receiveShadow = true;
  g.add(sill);

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
  // Marco con leve metalness → lee como aluminio/herrería de ventana.
  const frameMat = matte(pal.accent, { roughness: 0.45, metalness: 0.25 });

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

// ── Techo + paneles de luz ───────────────────────────────────────────────────────

/**
 * Techo a WALL_HEIGHT (color ceiling) con PANELES DE LUZ empotrados en rejilla
 * cada ~4-5 m dentro de bounds. Devuelve:
 *   - "ceiling"        → un plano (1 draw call), cara hacia abajo, sin sombras.
 *   - "ceiling-panels" → TODOS los paneles emissive mergeados (1 draw call).
 * Los paneles van SIEMPRE emissive (#fff4e0): de día se ven como luminarias y de
 * noche son la luz principal cuando el orquestador baja el ambient. Total: ~2
 * draw calls. El techo está a 2.6 m y los ojos a 1.6 m → nunca tapa la cámara.
 */
function buildCeiling(b: WorldModel["bounds"], pal: WorldPalette): THREE.Object3D[] {
  const minX = num(b?.minX, 0);
  const maxX = num(b?.maxX, 1);
  const minZ = num(b?.minZ, 0);
  const maxZ = num(b?.maxZ, 1);
  const w = Math.max(1, maxX - minX);
  const d = Math.max(1, maxZ - minZ);
  const cxw = (minX + maxX) / 2;
  const czw = (minZ + maxZ) / 2;

  const out: THREE.Object3D[] = [];

  // Plano de techo (mirando hacia abajo). FrontSide + rotado para que su normal
  // apunte al piso: solo se ve desde dentro, no derrocha overdraw.
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color: pal.ceiling, roughness: 0.95, metalness: 0, side: THREE.FrontSide }),
  );
  ceil.rotation.x = Math.PI / 2; // normal hacia -Y (hacia abajo)
  ceil.position.set(cxw, WALL_HEIGHT, czw);
  ceil.name = "ceiling";
  // Sin sombras: un techo plano no necesita recibirlas y ahorra fps.
  out.push(ceil);

  // Paneles de luz en rejilla cada ~4.5 m, centrados sobre el área. Plano fino,
  // empotrado justo bajo el techo, emissive cálido. Todos mergeados.
  const step = 4.5;                 // separación de la rejilla (m)
  const panelW = Math.min(1.2, step * 0.5); // tamaño del panel (m)
  const panelY = WALL_HEIGHT - 0.02; // empotrado justo bajo el plano de techo
  const nx = Math.max(1, Math.floor(w / step));
  const nz = Math.max(1, Math.floor(d / step));
  const startX = cxw - ((nx - 1) * step) / 2;
  const startZ = czw - ((nz - 1) * step) / 2;

  const panels: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const px = startX + i * step;
      const pz = startZ + j * step;
      const p = new THREE.PlaneGeometry(panelW, panelW);
      p.rotateX(Math.PI / 2);       // mirando hacia abajo
      p.translate(px, panelY, pz);
      panels.push(p);
    }
  }
  const panelGeo = mergeBoxes(panels);
  if (panelGeo) {
    const mesh = new THREE.Mesh(
      panelGeo,
      new THREE.MeshStandardMaterial({
        color: "#fff4e0",
        emissive: new THREE.Color("#fff4e0"),
        emissiveIntensity: 0.85, // media-alta: luminaria visible día y noche
        roughness: 1,
        metalness: 0,
        side: THREE.FrontSide,
      }),
    );
    mesh.name = "ceiling-panels";
    out.push(mesh);
  }

  return out;
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

    // Muros + zócalo + remate + postes (1 draw call cada uno)
    for (const m of buildWalls(elements, pal)) group.add(m);

    // Techo + paneles de luz (~2 draw calls)
    for (const m of buildCeiling(bounds, pal)) group.add(m);

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
