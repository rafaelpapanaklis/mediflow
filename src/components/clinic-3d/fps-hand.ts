// ─────────────────────────────────────────────────────────────────────────────
// A3 — Mano en primera persona estilo Minecraft. Brazo+mano low-poly anclado a
// la CÁMARA (abajo-derecha), con bobbing al caminar, sway idle y un "tap" al
// hacer click. El orquestador hace camera.add(hand.group) y scene.add(camera).
//
// TODO(A3): implementar createHand según este brief.
//
// GEOMETRÍA (cajas, en ESPACIO LOCAL DE CÁMARA — la cámara mira a -Z):
//   - Antebrazo + mano con cajas: manga de BATA BLANCA (#f4f6f8) en el antebrazo
//     y mano tono piel (#e8b894).低-poly, pocas cajas. Agrúpalas en un sub-grupo
//     `rig` para poder animarlo sin tocar el anclaje.
//   - Posición base del group: abajo-derecha y hacia adelante, p.ej.
//     (0.32, -0.34, -0.62), con una ligera rotación para que “apunte” al centro.
//   - renderOrder alto y material.depthTest=false (o una segunda cámara) para que
//     NO se clave en las paredes; con fov 72 y z≈-0.6 basta depthTest=false +
//     renderOrder grande para dibujarse encima.
//
// update(dt, { moving, speed }):
//   - bobbing: si moving, t += dt*speed; aplica seno a rig.position.y
//     (amplitud ~0.012) y un seno de media frecuencia a rig.position.x; el
//     balanceo escala con speed/WALK_SPEED.
//   - idle sway: si !moving, oscilación MUY leve (seno lento) en y/rot.z.
//   - tap: si hay un tap activo, interpola un golpecito hacia -Z + rotación
//     (~150 ms, ease out) y regresa. Lleva un reloj interno (acumula dt).
//
// tap(): dispara la animación de golpe (resetea su fase a 0). Llamado por el
//   orquestador al hacer click/interactuar.
//
// setVisible(v): group.visible = v (el orquestador lo oculta en móvil).
//
// dispose(): disposeObject3D(group) y quítalo de su parent (camera.remove).
//
// Devuelve { group (name "hand"), update, tap, setVisible, dispose }.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { disposeObject3D } from "./three-helpers";
import { WALK_SPEED } from "./world-types";

export interface FpsHand {
  group: THREE.Group;
  update(dt: number, opts: { moving: boolean; speed: number }): void;
  tap(): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

// ── Paleta plana (sin texturas) ──────────────────────────────────────────────
const COAT = "#f4f6f8"; // manga de bata blanca
const SKIN = "#e8b894"; // piel de la mano

// ── Posición/orientación base del rig en ESPACIO LOCAL DE CÁMARA (mira a -Z) ──
const BASE_POS = new THREE.Vector3(0.32, -0.34, -0.62); // abajo-derecha, adelante
const BASE_ROT = new THREE.Euler(-0.18, 0.34, -0.12);   // “apunta” al centro

// ── Animación ────────────────────────────────────────────────────────────────
const BOB_Y = 0.012;        // amplitud vertical del bobbing al caminar
const BOB_X = 0.008;        // amplitud lateral (media frecuencia)
const BOB_FREQ = 9;         // paso por unidad de fase de caminata
const IDLE_AMP = 0.004;     // sway muy leve estando quieto
const IDLE_FREQ = 1.4;      // oscilación lenta del idle
const TAP_DUR = 0.15;       // duración del golpe (s, ~150 ms)
const TAP_PUNCH = 0.14;     // avance hacia -Z del golpe
const TAP_ROT = 0.55;       // rotación de muñeca del golpe (rad)

/** Caja de color plano que se dibuja SIEMPRE encima (no se clava en paredes). */
function part(
  w: number,
  h: number,
  d: number,
  color: string,
  pos: [number, number, number],
  renderOrder: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    // Lit como el resto del mundo, pero depthTest/Write off + renderOrder alto
    // ⇒ se pinta sobre la geometría sin pelearse con el z-buffer de las paredes.
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.renderOrder = renderOrder;
  return mesh;
}

export function createHand(camera: THREE.PerspectiveCamera): FpsHand {
  const group = new THREE.Group();
  group.name = "hand";

  // Sub-grupo animable: el anclaje (group) queda fijo respecto a la cámara y
  // toda la animación (bobbing/sway/tap) vive en `rig`.
  const rig = new THREE.Group();
  rig.position.copy(BASE_POS);
  rig.rotation.copy(BASE_ROT);
  group.add(rig);

  // Brazo+mano low-poly con cajas. El antebrazo se extiende hacia +Z (atrás,
  // hacia el codo) y la mano hacia -Z (adelante). renderOrder muy alto.
  const RO = 10_000;
  // antebrazo (manga de bata) — la caja larga que baja desde abajo-derecha
  rig.add(part(0.16, 0.16, 0.5, COAT, [0, 0, 0.18], RO));
  // puño/borde de la manga (ligeramente más ancho, marca la muñeca)
  rig.add(part(0.18, 0.18, 0.07, COAT, [0, 0, -0.08], RO + 1));
  // palma (tono piel)
  rig.add(part(0.17, 0.1, 0.18, SKIN, [0, 0, -0.21], RO + 2));
  // dedos (bloque corto al frente de la palma)
  rig.add(part(0.16, 0.07, 0.1, SKIN, [0, -0.012, -0.34], RO + 3));
  // pulgar (caja chica al costado interno)
  rig.add(part(0.05, 0.06, 0.1, SKIN, [-0.1, -0.01, -0.24], RO + 3));

  // Relojes internos de animación.
  let walkPhase = 0;  // avanza con dt*speed mientras camina (bobbing)
  let idleTime = 0;   // tiempo total para el sway de reposo
  let tapTime = TAP_DUR; // ≥ TAP_DUR ⇒ sin golpe activo

  function update(dt: number, opts: { moving: boolean; speed: number }) {
    const { moving, speed } = opts;
    idleTime += dt;

    // Intensidad del balanceo según qué tan rápido caminas (0..~1).
    const intensity = Math.min(speed / WALK_SPEED, 1.3);

    let y = 0;
    let x = 0;
    let rz = 0;

    if (moving) {
      walkPhase += dt * speed * BOB_FREQ;
      // |sin| para el rebote vertical (dos baches por zancada), seno simple
      // a media frecuencia para el vaivén lateral.
      y = -Math.abs(Math.sin(walkPhase)) * BOB_Y * intensity;
      x = Math.sin(walkPhase * 0.5) * BOB_X * intensity;
      rz = x * 0.6;
    } else {
      // Idle: respiración/sway muy sutil, sin tocar el reloj de caminata.
      y = Math.sin(idleTime * IDLE_FREQ) * IDLE_AMP;
      rz = Math.sin(idleTime * IDLE_FREQ * 0.7) * (IDLE_AMP * 0.8);
    }

    // Golpe (“tap”): lunge hacia -Z + rotación de muñeca, ease-out y regreso.
    let punch = 0;
    let tapRot = 0;
    if (tapTime < TAP_DUR) {
      tapTime += dt;
      const p = Math.min(tapTime / TAP_DUR, 1);     // 0..1
      const arc = Math.sin(p * Math.PI);            // sube y vuelve (0→1→0)
      const ease = 1 - (1 - arc) * (1 - arc);       // ease-out del arco
      punch = -ease * TAP_PUNCH;                     // hacia -Z (adelante/abajo)
      tapRot = -ease * TAP_ROT;                      // muñeca cae al golpear
    }

    rig.position.set(BASE_POS.x + x, BASE_POS.y + y + punch * 0.4, BASE_POS.z + punch);
    rig.rotation.set(BASE_ROT.x + tapRot, BASE_ROT.y, BASE_ROT.z + rz);
  }

  function tap() {
    tapTime = 0; // resetea la fase del golpe (lo dispara el orquestador al click)
  }

  function setVisible(v: boolean) {
    group.visible = v;
  }

  function dispose() {
    (group.parent ?? camera)?.remove(group);
    disposeObject3D(group);
  }

  return { group, update, tap, setVisible, dispose };
}
