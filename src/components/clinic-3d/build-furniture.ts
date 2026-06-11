// ─────────────────────────────────────────────────────────────────────────────
// A3 — Mobiliario low-poly por TIPO del catálogo, compuesto de primitivas
// (Box/Cylinder/Capsule/Cone). Devuelve un Group con TODO el mobiliario.
//
// TODO(A3): implementar buildFurniture + buildFurnitureMesh según este brief.
//
// buildFurniture(world): recorre world.elements y, por cada elemento que NO sea
//   wall/door/window (isWall/isDoor/isWindow === false), construye su malla con
//   buildFurnitureMesh(el), la posiciona en (el.center.x, 0, el.center.z) y la
//   rota group.rotation.y = el.rotationRad. La añade al group "furniture".
//   INCLUYE el sillón dental (type "sillon") como MUEBLE (la silla estática); la
//   capa viva (A7) solo añade encima avatares/anillo/placa.
//
// buildFurnitureMesh(el): switch por el.type. Cada caso compone una forma DIGNA,
//   centrada en el origen local (la posición/rotación las pone buildFurniture),
//   dibujada a lo largo de X=baseCols × Z=baseRows (footprint sin rotar), altura
//   realista. Materiales MeshStandardMaterial mate; castShadow en piezas
//   principales. Colores neutros cálidos (madera #b08968, blanco equipo #f3f5f7,
//   metal cromo #c7ccd1, tapizado azul #3b82f6, negro #2b2f36, verde planta
//   #2f9e54, terracota #c1664a). Mapa tipo→forma (mínimo):
//
//   ESTRUCTURALES ya las hace A2 (no entran aquí).
//   - "sillon" (2×3, isChair): base/columna + asiento + respaldo INCLINADO +
//     apoyabrazos + brazo de lámpara con cabezal. Tapizado = el.resourceId? usa
//     un azul clínico; el color real del Resource lo pinta el anillo de A7.
//   - "rayosx" (2×2): columna + brazo articulado + cabezal cónico + base.
//   - "esterilizador" (2×2): gabinete blanco + puerta con visor + panel.
//   - "lavabo" (2×2): gabinete + tarja hundida (box) + grifo (cilindro doblado).
//   - "gabinete" (1×2): cuerpo + 3 cajones (líneas/handles).
//   - "taburete" (1×1): cilindro asiento + columna + base estrella (conos/boxes).
//   - "mostrador" (4×2): mostrador en L (dos boxes) + top madera + monitor.
//   - "silla_espera" (1×1): asiento + respaldo + 4 patas finas.
//   - "banca" (3×1): banca de 3 asientos + respaldo + patas.
//   - "mesa_centro" (2×2): top (box bajo) + 4 patas; tono madera/vidrio.
//   - "escritorio" (3×2): cubierta + faldón + cajonera + monitor.
//   - "silla_oficina" (1×1): asiento + respaldo + columna + base estrella.
//   - "archivero" (1×1): cuerpo + 4 cajones de colores.
//   - "planta" (1×1): maceta (cono/cilindro) + follaje (esferas/conos verdes).
//   - "tv" (2×1): pantalla (box oscuro delgado) + soporte.
//   - "inodoro" (1×2): taza + tanque.
//   - "lavabo_bano" (1×1): pedestal + tarja redonda + grifo.
//   - DESCONOCIDO (default): caja gris genérica del tamaño del footprint +
//     placa flotante (Sprite con CanvasTexture) con typeLabel(el.type) o
//     el.name. NUNCA lances por un type nuevo (datos legacy variados).
//
// Reutiliza un helper local makeLabelSprite(text) (CanvasTexture → Sprite) para
// la caja genérica. Mantén el conteo de vértices bajo (segmentos de cilindros 8-12).
//
// Devuelve el Group "furniture".
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { typeLabel, type WorldElement, type WorldModel } from "./world-types";

// ── Paleta cálida del brief ──────────────────────────────────────────────────
const COL = {
  wood: "#b08968",
  woodDark: "#8c5a36",
  white: "#f3f5f7",
  chrome: "#c7ccd1",
  metalDark: "#9aa3ad",
  upholstery: "#3b82f6",
  upholsteryDark: "#2563eb",
  black: "#2b2f36",
  plant: "#2f9e54",
  plantDark: "#1f7d3f",
  terracotta: "#c1664a",
  ceramic: "#eef2f6",
  screen: "#11161f",
  glass: "#bcd4ec",
  soil: "#3d2817",
  gray: "#b8c0c8",
  led: "#10b981",
} as const;

// ── Materiales (mate salvo cromo) ────────────────────────────────────────────
function mat(color: string, opts?: { rough?: number; metal?: number }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts?.rough ?? 0.85,
    metalness: opts?.metal ?? 0,
  });
}
const M = {
  wood: () => mat(COL.wood, { rough: 0.7 }),
  woodDark: () => mat(COL.woodDark, { rough: 0.7 }),
  white: () => mat(COL.white, { rough: 0.5 }),
  chrome: () => mat(COL.chrome, { rough: 0.3, metal: 0.85 }),
  metalDark: () => mat(COL.metalDark, { rough: 0.4, metal: 0.6 }),
  upholstery: () => mat(COL.upholstery, { rough: 0.9 }),
  upholsteryDark: () => mat(COL.upholsteryDark, { rough: 0.9 }),
  black: () => mat(COL.black, { rough: 0.6 }),
  plant: () => mat(COL.plant, { rough: 0.9 }),
  plantDark: () => mat(COL.plantDark, { rough: 0.9 }),
  terracotta: () => mat(COL.terracotta, { rough: 0.95 }),
  ceramic: () => mat(COL.ceramic, { rough: 0.25 }),
  screen: () => mat(COL.screen, { rough: 0.25 }),
  glass: () => mat(COL.glass, { rough: 0.1, metal: 0.2 }),
  soil: () => mat(COL.soil, { rough: 1 }),
  gray: () => mat(COL.gray, { rough: 0.9 }),
};

// ── Helpers de primitivas ────────────────────────────────────────────────────
function boxMesh(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  big = false,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  if (big) m.castShadow = true;
  return m;
}
function cyl(
  rTop: number,
  rBot: number,
  h: number,
  material: THREE.Material,
  seg = 10,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
}
function sphere(r: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), material);
}
function cone(r: number, h: number, material: THREE.Material, seg = 10): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), material);
}
function at(o: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  o.position.set(x, y, z);
  return o;
}

/** Base de columna en estrella de 5 patas (taburete/silla de oficina). */
function starBase(radius: number, y: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = boxMesh(radius, 0.05, 0.07, M.black());
    leg.position.set((Math.cos(a) * radius) / 2, y, (Math.sin(a) * radius) / 2);
    leg.rotation.y = -a;
    g.add(leg);
    g.add(at(cyl(0.04, 0.04, 0.05, M.black(), 8), Math.cos(a) * radius * 0.48, y, Math.sin(a) * radius * 0.48));
  }
  return g;
}

/** Placa flotante (CanvasTexture → Sprite) para la caja genérica/desconocida. */
function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(20,24,30,0.82)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#f3f5f7";
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 22), 128, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.1, 0.275, 1);
  return sprite;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builders por tipo. Cada uno compone primitivas centradas en el ORIGEN local,
// dibujadas a lo largo de X = w (baseCols) × Z = d (baseRows). y=0 = piso.
// ─────────────────────────────────────────────────────────────────────────────

/** Sillón dental estático: base + columna + asiento + respaldo inclinado +
 *  apoyabrazos + brazo de lámpara con cabezal. (avatares/anillo: capa A7). */
function buildSillon(g: THREE.Group): void {
  // Disco/pedestal base
  const base = cyl(0.45, 0.55, 0.12, M.chrome(), 12);
  base.castShadow = true;
  g.add(at(base, 0, 0.06, 0.6));
  // Columna central
  g.add(at(cyl(0.16, 0.18, 0.45, M.chrome(), 10), 0, 0.34, 0.4));
  // Asiento (tapizado clínico)
  const seat = boxMesh(0.78, 0.16, 1.1, M.upholstery(), true);
  g.add(at(seat, 0, 0.5, 0.15));
  // Reposapiés / sección de piernas
  g.add(at(boxMesh(0.7, 0.12, 0.7, M.upholstery()), 0, 0.5, 0.95));
  // Respaldo INCLINADO hacia atrás
  const back = boxMesh(0.78, 1.0, 0.18, M.upholsteryDark(), true);
  back.position.set(0, 0.95, -0.55);
  back.rotation.x = -0.42;
  g.add(back);
  // Apoyacabezas
  const head = boxMesh(0.5, 0.34, 0.16, M.upholsteryDark());
  head.position.set(0, 1.42, -0.78);
  head.rotation.x = -0.42;
  g.add(head);
  // Apoyabrazos (cromo)
  g.add(at(boxMesh(0.08, 0.1, 0.7, M.chrome()), -0.43, 0.62, 0.15));
  g.add(at(boxMesh(0.08, 0.1, 0.7, M.chrome()), 0.43, 0.62, 0.15));
  // Brazo de lámpara: poste + brazo + cabezal sobre el paciente
  g.add(at(cyl(0.045, 0.05, 1.55, M.chrome(), 8), 0.55, 0.9, 0.7));
  const lampArm = cyl(0.04, 0.04, 0.85, M.chrome(), 8);
  lampArm.rotation.z = Math.PI / 2;
  g.add(at(lampArm, 0.15, 1.65, 0.7));
  const lampHead = boxMesh(0.5, 0.16, 0.32, mat("#fbbf24", { rough: 0.4 }));
  lampHead.position.set(-0.25, 1.6, 0.25);
  lampHead.rotation.x = 0.5;
  g.add(lampHead);
  // Bandeja de instrumentos lateral
  g.add(at(boxMesh(0.32, 0.04, 0.26, M.metalDark()), -0.62, 1.0, -0.1));
}

/** Rayos X: columna + brazo articulado + cabezal + cono. */
function buildRayosx(g: THREE.Group): void {
  // Base
  const base = cyl(0.35, 0.4, 0.1, M.white(), 12);
  base.castShadow = true;
  g.add(at(base, 0.55, 0.05, 0.55));
  // Columna vertical
  g.add(at(cyl(0.08, 0.08, 1.9, M.white(), 10), 0.55, 0.95, 0.55));
  // Brazo horizontal articulado
  const arm = cyl(0.06, 0.06, 1.0, M.white(), 8);
  arm.rotation.z = Math.PI / 2;
  g.add(at(arm, 0.1, 1.8, 0.55));
  // Junta
  g.add(at(sphere(0.1, M.metalDark()), -0.4, 1.8, 0.55));
  // Cabezal (caja oscura) + cono cónico
  g.add(at(boxMesh(0.3, 0.3, 0.3, M.metalDark(), true), -0.55, 1.6, 0.55));
  const c = cone(0.12, 0.3, M.metalDark(), 10);
  c.rotation.x = Math.PI / 2;
  g.add(at(c, -0.55, 1.45, 0.7));
}

/** Esterilizador (autoclave): gabinete blanco + puerta con visor + panel. */
function buildEsterilizador(g: THREE.Group): void {
  const body = boxMesh(1.7, 1.5, 1.6, M.white(), true);
  g.add(at(body, 0, 0.75, 0));
  // Puerta circular con visor de vidrio
  const door = cyl(0.45, 0.45, 0.08, M.metalDark(), 12);
  door.rotation.x = Math.PI / 2;
  g.add(at(door, -0.3, 0.8, 0.82));
  const view = cyl(0.28, 0.28, 0.06, M.glass(), 12);
  view.rotation.x = Math.PI / 2;
  g.add(at(view, -0.3, 0.8, 0.85));
  // Panel de control + display
  g.add(at(boxMesh(0.5, 1.0, 0.04, mat("#dde7f1", { rough: 0.4 })), 0.5, 0.9, 0.82));
  g.add(at(boxMesh(0.36, 0.2, 0.03, M.screen()), 0.5, 1.25, 0.85));
}

/** Lavabo clínico: gabinete + encimera + tarja hundida + grifo doblado. */
function buildLavabo(g: THREE.Group): void {
  // Gabinete bajo
  g.add(at(boxMesh(1.8, 0.85, 1.7, M.white(), true), 0, 0.425, 0));
  // Encimera
  g.add(at(boxMesh(1.9, 0.06, 1.8, M.ceramic()), 0, 0.88, 0));
  // Tarja hundida (box embutido)
  g.add(at(boxMesh(1.0, 0.18, 0.9, M.glass()), 0, 0.84, 0.1));
  // Grifo doblado: cuello vertical + caño horizontal
  g.add(at(cyl(0.04, 0.05, 0.35, M.chrome(), 8), 0, 1.05, -0.5));
  const spout = cyl(0.035, 0.035, 0.35, M.chrome(), 8);
  spout.rotation.x = Math.PI / 2;
  g.add(at(spout, 0, 1.2, -0.35));
  // Maneras
  g.add(at(sphere(0.05, M.chrome()), -0.18, 1.0, -0.5));
  g.add(at(sphere(0.05, M.chrome()), 0.18, 1.0, -0.5));
}

/** Gabinete de cajones: cuerpo + 3 cajones con tiradores. */
function buildGabinete(g: THREE.Group): void {
  const w = 0.85;
  const d = 1.7;
  g.add(at(boxMesh(w, 1.4, d, M.white(), true), 0, 0.7, 0));
  for (let i = 0; i < 3; i++) {
    const y = 0.35 + i * 0.42;
    g.add(at(boxMesh(w - 0.06, 0.36, 0.03, mat("#dde7f1", { rough: 0.4 })), 0, y, d / 2));
    g.add(at(boxMesh(0.3, 0.04, 0.04, M.chrome()), 0, y + 0.1, d / 2 + 0.03)); // tirador
  }
}

/** Taburete: asiento cilíndrico + columna + base estrella. */
function buildTaburete(g: THREE.Group): void {
  g.add(starBase(0.55, 0.04));
  g.add(at(cyl(0.05, 0.05, 0.45, M.metalDark(), 8), 0, 0.27, 0));
  const seat = cyl(0.3, 0.3, 0.1, M.upholstery(), 12);
  seat.castShadow = true;
  g.add(at(seat, 0, 0.52, 0));
}

/** Mostrador en L: dos cuerpos + top de madera + monitor. */
function buildMostrador(g: THREE.Group): void {
  // Cuerpo largo (a lo largo de X)
  g.add(at(boxMesh(3.9, 1.05, 0.9, M.white(), true), 0, 0.525, -0.5));
  // Retorno corto (a lo largo de Z) → forma de L
  g.add(at(boxMesh(0.9, 1.05, 1.0, M.white(), true), -1.5, 0.525, 0.45));
  // Top de madera (ambos tramos)
  g.add(at(boxMesh(4.0, 0.06, 0.95, M.wood()), 0, 1.08, -0.5));
  g.add(at(boxMesh(0.95, 0.06, 1.05, M.wood()), -1.5, 1.08, 0.45));
  // Franja de acento frontal
  g.add(at(boxMesh(3.92, 0.12, 0.02, M.upholstery()), 0, 0.6, -0.96));
  // Monitor sobre el mostrador
  g.add(at(cyl(0.06, 0.08, 0.1, M.black(), 8), 0.6, 1.13, -0.5));
  g.add(at(cyl(0.03, 0.03, 0.25, M.black(), 6), 0.6, 1.25, -0.5));
  g.add(at(boxMesh(0.62, 0.4, 0.04, M.screen()), 0.6, 1.5, -0.5));
}

/** Silla de espera: asiento + respaldo + 4 patas finas. */
function buildSillaEspera(g: THREE.Group): void {
  const legs: [number, number][] = [
    [-0.32, -0.32],
    [0.32, -0.32],
    [-0.32, 0.32],
    [0.32, 0.32],
  ];
  for (const [x, z] of legs) g.add(at(cyl(0.03, 0.03, 0.45, M.chrome(), 6), x, 0.225, z));
  g.add(at(boxMesh(0.78, 0.1, 0.78, M.upholstery(), true), 0, 0.5, 0));
  g.add(at(boxMesh(0.78, 0.6, 0.1, M.upholsteryDark()), 0, 0.82, -0.34));
}

/** Banca de 3 plazas: estructura + 3 cojines + respaldo + patas. */
function buildBanca(g: THREE.Group): void {
  // 3 cojines a lo largo de X
  for (let i = 0; i < 3; i++) {
    const x = -1.0 + i * 1.0;
    g.add(at(boxMesh(0.9, 0.12, 0.85, M.upholstery(), true), x, 0.46, 0));
    g.add(at(boxMesh(0.9, 0.55, 0.1, M.upholsteryDark()), x, 0.75, -0.36));
  }
  // Travesaño estructural + patas
  g.add(at(boxMesh(2.9, 0.06, 0.1, M.chrome()), 0, 0.4, 0.3));
  g.add(at(cyl(0.04, 0.04, 0.4, M.chrome(), 6), -1.3, 0.2, 0));
  g.add(at(cyl(0.04, 0.04, 0.4, M.chrome(), 6), 1.3, 0.2, 0));
}

/** Mesa de centro: top bajo (madera/vidrio) + 4 patas. */
function buildMesaCentro(g: THREE.Group): void {
  const legs: [number, number][] = [
    [-0.7, -0.7],
    [0.7, -0.7],
    [-0.7, 0.7],
    [0.7, 0.7],
  ];
  for (const [x, z] of legs) g.add(at(cyl(0.04, 0.04, 0.4, M.woodDark(), 6), x, 0.2, z));
  // Estante inferior de madera
  g.add(at(boxMesh(1.5, 0.04, 1.5, M.wood()), 0, 0.15, 0));
  // Top de vidrio
  const top = boxMesh(1.7, 0.05, 1.7, M.glass(), true);
  g.add(at(top, 0, 0.42, 0));
}

/** Escritorio: cubierta + faldón + cajonera + monitor. */
function buildEscritorio(g: THREE.Group): void {
  // Cubierta de madera
  g.add(at(boxMesh(2.9, 0.06, 1.9, M.wood(), true), 0, 0.74, 0));
  // Faldón frontal
  g.add(at(boxMesh(2.7, 0.3, 0.04, M.white()), 0, 0.56, -0.9));
  // Cajonera lateral
  g.add(at(boxMesh(0.7, 0.66, 1.7, M.white(), true), -1.0, 0.37, 0));
  for (let i = 0; i < 2; i++) g.add(at(boxMesh(0.3, 0.04, 0.04, M.chrome()), -1.0, 0.45 + i * 0.22, 0.86));
  // Patas del lado libre
  g.add(at(cyl(0.04, 0.04, 0.7, M.metalDark(), 6), 1.2, 0.35, -0.8));
  g.add(at(cyl(0.04, 0.04, 0.7, M.metalDark(), 6), 1.2, 0.35, 0.8));
  // Monitor
  g.add(at(cyl(0.06, 0.08, 0.08, M.black(), 8), 0.4, 0.79, -0.4));
  g.add(at(cyl(0.03, 0.03, 0.25, M.black(), 6), 0.4, 0.9, -0.4));
  g.add(at(boxMesh(0.65, 0.4, 0.04, M.screen()), 0.4, 1.15, -0.4));
}

/** Silla de oficina: asiento + respaldo alto + columna + base estrella. */
function buildSillaOficina(g: THREE.Group): void {
  g.add(starBase(0.5, 0.04));
  g.add(at(cyl(0.05, 0.05, 0.4, M.metalDark(), 8), 0, 0.25, 0));
  g.add(at(boxMesh(0.55, 0.12, 0.55, M.black(), true), 0, 0.5, 0));
  g.add(at(boxMesh(0.55, 0.7, 0.1, M.black()), 0, 0.9, -0.24));
  // Apoyabrazos
  g.add(at(boxMesh(0.06, 0.06, 0.4, M.black()), -0.3, 0.62, 0));
  g.add(at(boxMesh(0.06, 0.06, 0.4, M.black()), 0.3, 0.62, 0));
}

/** Archivero: cuerpo + 4 cajones con frentes de colores. */
function buildArchivero(g: THREE.Group): void {
  g.add(at(boxMesh(0.8, 1.3, 0.8, M.white(), true), 0, 0.65, 0));
  const colors = ["#4a90e2", "#10b981", "#f59e0b", "#ef4444"];
  for (let i = 0; i < 4; i++) {
    const y = 0.22 + i * 0.3;
    g.add(at(boxMesh(0.74, 0.26, 0.03, mat(colors[i], { rough: 0.7 })), 0, y, 0.4));
    g.add(at(boxMesh(0.3, 0.04, 0.04, M.chrome()), 0, y, 0.43));
  }
}

/** Planta: maceta (cono/cilindro) + follaje (esferas/conos verdes). */
function buildPlanta(g: THREE.Group): void {
  // Maceta troncocónica
  const pot = cyl(0.28, 0.2, 0.4, M.terracotta(), 12);
  pot.castShadow = true;
  g.add(at(pot, 0, 0.2, 0));
  g.add(at(cyl(0.27, 0.27, 0.04, M.soil(), 12), 0, 0.4, 0));
  // Follaje en esferas + cono superior
  g.add(at(sphere(0.32, M.plant()), 0, 0.7, 0));
  g.add(at(sphere(0.24, M.plantDark()), 0.18, 0.85, 0.12));
  g.add(at(sphere(0.22, M.plant()), -0.18, 0.82, -0.1));
  g.add(at(cone(0.2, 0.5, M.plantDark(), 10), 0, 1.05, 0));
}

/** Televisión: pantalla delgada + soporte. */
function buildTv(g: THREE.Group): void {
  // Pantalla (panel oscuro delgado a lo largo de X)
  const panel = boxMesh(1.8, 1.05, 0.07, M.black(), true);
  g.add(at(panel, 0, 1.5, 0));
  // Cara emisora
  g.add(at(boxMesh(1.7, 0.95, 0.02, mat("#1d3b6e", { rough: 0.25 })), 0, 1.5, 0.04));
  // Cuello + base / pie
  g.add(at(cyl(0.04, 0.04, 0.5, M.metalDark(), 8), 0, 0.85, 0));
  g.add(at(cyl(0.25, 0.3, 0.05, M.black(), 12), 0, 0.6, 0));
}

/** Inodoro: taza + tanque. */
function buildInodoro(g: THREE.Group): void {
  // Tanque (al fondo en Z negativo)
  g.add(at(boxMesh(0.55, 0.5, 0.2, M.ceramic(), true), 0, 0.65, -0.7));
  // Pedestal de la taza
  g.add(at(cyl(0.18, 0.22, 0.4, M.ceramic(), 12), 0, 0.2, 0.1));
  // Asiento ovalado (cilindro achatado)
  const bowl = cyl(0.32, 0.28, 0.14, M.ceramic(), 12);
  bowl.scale.z = 1.25;
  bowl.castShadow = true;
  g.add(at(bowl, 0, 0.45, 0.15));
  // Hueco interior
  const inner = cyl(0.2, 0.2, 0.1, M.glass(), 12);
  inner.scale.z = 1.25;
  g.add(at(inner, 0, 0.5, 0.15));
}

/** Lavabo de baño: pedestal + tarja redonda + grifo. */
function buildLavaboBano(g: THREE.Group): void {
  // Pedestal
  g.add(at(cyl(0.14, 0.2, 0.8, M.ceramic(), 12), 0, 0.4, 0));
  // Tarja redonda
  const basin = cyl(0.34, 0.22, 0.18, M.ceramic(), 12);
  basin.castShadow = true;
  g.add(at(basin, 0, 0.85, 0));
  g.add(at(cyl(0.26, 0.26, 0.1, M.glass(), 12), 0, 0.9, 0));
  // Grifo
  g.add(at(cyl(0.03, 0.04, 0.18, M.chrome(), 8), 0, 1.0, -0.22));
  const spout = cyl(0.025, 0.025, 0.18, M.chrome(), 8);
  spout.rotation.x = Math.PI / 2.4;
  g.add(at(spout, 0, 1.08, -0.15));
}

/** Caja genérica gris del footprint + placa flotante (tipo desconocido). */
function buildGeneric(g: THREE.Group, el: WorldElement): void {
  const w = Math.max(0.4, el.baseCols * 0.9);
  const d = Math.max(0.4, el.baseRows * 0.9);
  const h = 0.8;
  const box = boxMesh(w, h, d, M.gray(), true);
  g.add(at(box, 0, h / 2, 0));
  const sprite = makeLabelSprite(el.name || typeLabel(el.type));
  sprite.position.set(0, h + 0.35, 0);
  g.add(sprite);
}

export function buildFurnitureMesh(el: WorldElement): THREE.Object3D {
  const g = new THREE.Group();
  g.name = `furniture-${el.type}-${el.id}`;
  switch (el.type) {
    case "sillon":
      buildSillon(g);
      break;
    case "rayosx":
      buildRayosx(g);
      break;
    case "esterilizador":
      buildEsterilizador(g);
      break;
    case "lavabo":
      buildLavabo(g);
      break;
    case "gabinete":
      buildGabinete(g);
      break;
    case "taburete":
      buildTaburete(g);
      break;
    case "mostrador":
      buildMostrador(g);
      break;
    case "silla_espera":
      buildSillaEspera(g);
      break;
    case "banca":
      buildBanca(g);
      break;
    case "mesa_centro":
      buildMesaCentro(g);
      break;
    case "escritorio":
      buildEscritorio(g);
      break;
    case "silla_oficina":
      buildSillaOficina(g);
      break;
    case "archivero":
      buildArchivero(g);
      break;
    case "planta":
      buildPlanta(g);
      break;
    case "tv":
      buildTv(g);
      break;
    case "inodoro":
      buildInodoro(g);
      break;
    case "lavabo_bano":
      buildLavaboBano(g);
      break;
    default:
      // Tipo desconocido/legacy: nunca lanzar. Caja gris + placa.
      buildGeneric(g, el);
      break;
  }
  return g;
}

export function buildFurniture(world: WorldModel): THREE.Group {
  const group = new THREE.Group();
  group.name = "furniture";
  for (const el of world.elements) {
    if (el.isWall || el.isDoor || el.isWindow) continue;
    const mesh = buildFurnitureMesh(el);
    mesh.position.set(el.center.x, 0, el.center.z);
    mesh.rotation.y = el.rotationRad;
    group.add(mesh);
  }
  return group;
}
