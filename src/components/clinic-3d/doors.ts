// ─────────────────────────────────────────────────────────────────────────────
// A8 — Puertas animadas (juice visual). La hoja gira ~80° suave cuando alguien
// se acerca (<1.5 m) y se cierra sola. La colisión de la celda de puerta YA es
// nula (parser), así que esto es PURO visual: la hoja nunca bloquea.
//
// IMPORTANTE: build-architecture (A5) dibuja SOLO EL MARCO de las puertas (sin
// hoja). Tú dibujas la HOJA con bisagra y la animas. No dupliques el marco.
//
// TODO(A8): implementar createDoors según este brief.
//
// Construcción: por cada world.elements con isDoor:
//   - Determina el ancho del vano por el footprint (puerta = 2×1; usa baseCols/
//     baseRows y la rotación). La bisagra (pivot) va en un EXTREMO del vano.
//   - pivot = new THREE.Group() colocado en el punto de la bisagra (en mundo),
//     orientado con el muro (usa element.rotationRad). La hoja (Box delgada,
//     alto ~2.05 m, color accent/madera, manija pequeña metálica) cuelga del
//     pivot de modo que rotar el pivot en Y la abre hacia adentro.
//   - guarda { pivot, closedY, openY (closedY ± DOOR_OPEN_ANGLE), cx, cz, cur }.
//     Decide el SIGNO de apertura para que abra hacia el interior de la clínica
//     (hacia el centro de world.bounds) — calcula con el producto cruz/lado.
//   - Maneja datos raros sin lanzar (si el footprint es inesperado, hoja 0.9 m).
//
// update(playerX, playerZ, dt): por cada puerta, dist = hipot(playerX-cx,
//   playerZ-cz); targetAngle = dist < DOOR_OPEN_DIST ? openY : closedY; avanza
//   cur hacia target con paso DOOR_ANIM_SPEED*dt (clamp), pivot.rotation.y = cur.
//   Sin reasignar geometría: solo el ángulo (barato). NUNCA for...of sobre Map.
//
// dispose(): disposeObject3D(group).
//
// Devuelve { group (name "doors"), update, dispose }.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import {
  DOOR_ANIM_SPEED,
  DOOR_OPEN_ANGLE,
  DOOR_OPEN_DIST,
  WALL_HEIGHT,
  getPalette,
  type WorldElement,
  type WorldModel,
} from "./world-types";
import { disposeObject3D } from "./three-helpers";

export interface DoorSystem {
  group: THREE.Group;
  update(playerX: number, playerZ: number, dt: number): void;
  dispose(): void;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Estado animable por puerta: solo guardamos el pivot y los ángulos/posición. */
interface AnimDoor {
  mount: THREE.Group; // wrapper en mundo: lleva la posición (bisagra) + orientación del muro
  pivot: THREE.Group; // hijo en el origen local: SOLO lleva el ángulo de apertura
  closedY: number; // ángulo cerrado (siempre 0 en el pivot)
  openY: number;   // ángulo abierto (±DOOR_OPEN_ANGLE, hacia el interior)
  cx: number;      // centro del vano en mundo (x)
  cz: number;      // centro del vano en mundo (z)
  cur: number;     // ángulo actual (lerp entre closedY y openY)
}

/**
 * Construye la HOJA de una puerta colgando de un pivot (Group) en un EXTREMO del
 * vano. Devuelve el estado animable o null si no aplica.
 *
 * Jerarquía: mount (en mundo: posición = bisagra, rotación Y = orientación del
 * muro) → pivot (en el origen local, SOLO gira el ángulo de apertura) → hoja.
 * Así update() escribe pivot.rotation.y = cur sin tocar la orientación del muro.
 *
 * Marco local del pivot: el vano corre a lo largo del eje X local (ancho =
 * baseCols, igual que build-architecture). La normal del muro es el eje Z local.
 * La bisagra (origen del pivot) está en el extremo X = -span/2 del vano; la hoja
 * cuelga hacia +X (cierra el vano). Con la bisagra ahí, pivot.rotation.y > 0
 * mueve el borde libre hacia -Z local (mundo (-sinθ,-cosθ)) y < 0 hacia +Z local
 * (mundo (+sinθ,+cosθ)).
 */
function buildDoorLeaf(
  el: WorldElement,
  accent: string,
  interiorX: number,
  interiorZ: number,
): AnimDoor | null {
  // Centro del vano en mundo.
  const cx = num(el.center?.x);
  const cz = num(el.center?.z);

  // Ancho del vano por el footprint base; datos raros → hoja de 0.9 m (sin lanzar).
  const baseCols = num(el.baseCols, 1);
  const span = baseCols > 0.2 && Number.isFinite(baseCols) ? baseCols : 0.9;

  const theta = num(el.rotationRad); // orientación del muro (rad, alrededor de Y)

  // ── Bisagra en un extremo del vano, en coordenadas de MUNDO ──────────────────
  // El extremo izquierdo del vano (local X = -span/2) en mundo: rotamos el offset
  // local por theta y lo sumamos al centro. Rotación Y de three:
  //   x' = x·cosθ + z·sinθ ;  z' = -x·sinθ + z·cosθ   (aquí z local = 0)
  const lx = -span / 2;
  const hingeX = cx + lx * Math.cos(theta);
  const hingeZ = cz - lx * Math.sin(theta);

  // Wrapper en mundo: lleva la posición de la bisagra y la orientación del muro.
  const mount = new THREE.Group();
  mount.name = "doorMount";
  mount.position.set(hingeX, 0, hingeZ);
  mount.rotation.y = theta; // alinea el eje X local con el muro

  // Pivot en el origen local del mount: su rotación.y es SOLO el ángulo de apertura.
  const pivot = new THREE.Group();
  pivot.name = "doorPivot";
  mount.add(pivot);

  // ── Hoja: caja delgada, alto ~2.05 m, ancho ≈ vano, colgando hacia +X local ──
  const leafH = Math.min(2.05, WALL_HEIGHT - 0.1);
  const leafW = Math.max(0.2, span - 0.06); // pequeño huelgo para no morder el marco
  const leafD = 0.05;

  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, leafH, leafD),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.75, metalness: 0.05 }),
  );
  // La hoja pivota desde su borde junto a la bisagra: su centro va a +leafW/2.
  leaf.position.set(leafW / 2 + 0.03, leafH / 2, 0);
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  pivot.add(leaf);

  // ── Manija metálica pequeña, cerca del borde libre de la hoja ────────────────
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.12, 0.06),
    new THREE.MeshStandardMaterial({ color: "#c7ccd1", roughness: 0.3, metalness: 0.9 }),
  );
  // Borde libre (lejos de la bisagra) y a la altura típica de manija.
  handle.position.set(leafW - 0.08, leafH * 0.45, leafD / 2 + 0.03);
  handle.castShadow = true;
  leaf.add(handle);

  // ── Signo de apertura: abrir hacia el INTERIOR (centro de bounds) ────────────
  // El eje +Z local en mundo es (sinθ, cosθ). Proyectamos el vector centro→interior
  // sobre ese eje: dotZ>0 → interior del lado +Z → swing a +Z → pivot.y negativo.
  const dotZ = Math.sin(theta) * interiorX + Math.cos(theta) * interiorZ;
  const openY = dotZ >= 0 ? -DOOR_OPEN_ANGLE : DOOR_OPEN_ANGLE;

  return { mount, pivot, closedY: 0, openY, cx, cz, cur: 0 };
}

export function createDoors(world: WorldModel): DoorSystem {
  const group = new THREE.Group();
  group.name = "doors";

  const doors: AnimDoor[] = [];

  try {
    const accent = getPalette(world?.category ?? "").accent;
    const b = world?.bounds ?? { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    const bcx = (num(b.minX) + num(b.maxX, 1)) / 2;
    const bcz = (num(b.minZ) + num(b.maxZ, 1)) / 2;
    const elements = Array.isArray(world?.elements) ? world.elements : [];

    for (const el of elements) {
      if (!el || !el.isDoor) continue;
      // Vector centro del vano → centro de la clínica (dirección "interior").
      const interiorX = bcx - num(el.center?.x);
      const interiorZ = bcz - num(el.center?.z);
      const d = buildDoorLeaf(el, accent, interiorX, interiorZ);
      if (d) {
        group.add(d.mount);
        doors.push(d);
      }
    }
  } catch {
    /* Datos corruptos: devolvemos lo construido hasta aquí (nunca lanzamos). */
  }

  return {
    group,
    update(playerX: number, playerZ: number, dt: number) {
      const px = num(playerX);
      const pz = num(playerZ);
      const step = DOOR_ANIM_SPEED * Math.max(0, num(dt));
      // Array (no Map/Set) → for clásico, barato; solo tocamos el ángulo.
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        const dist = Math.hypot(px - d.cx, pz - d.cz);
        const target = dist < DOOR_OPEN_DIST ? d.openY : d.closedY;
        // Avanza cur → target con paso fijo (clamp para no pasarse).
        if (d.cur < target) d.cur = Math.min(d.cur + step, target);
        else if (d.cur > target) d.cur = Math.max(d.cur - step, target);
        // El mount ya orienta con el muro; el pivot SOLO lleva la apertura.
        d.pivot.rotation.y = d.cur;
      }
    },
    dispose() {
      disposeObject3D(group);
    },
  };
}
