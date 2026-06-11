// ─────────────────────────────────────────────────────────────────────────────
// V3 / MODO DRON — vista aérea orbital sobre la clínica (tecla V o botón 🚁).
//
// Alterna FPS ↔ aérea con una transición SUAVE (lerp de posición + slerp de
// orientación, ~600 ms). Al entrar guarda la pose FPS exacta; al salir regresa a
// ella tal cual estaba (posición + mirada). En vista aérea usa OrbitControls de
// three/examples (rotar/pan/zoom, también táctil) con:
//   · ángulo polar máximo < 90° → nunca atraviesa el piso ni mira desde abajo;
//   · distancia (zoom) acotada al tamaño del layout;
//   · target clampeado al bounds caminable → no te pierdes fuera del plano.
//
// El orquestador es quien suelta/re-pide el pointer lock, oculta la mano/crosshair
// y enruta el clic-interacción por cursor. Este módulo SOLO gobierna la cámara.
//
// Contrato (controlsCamera): mientras valga true (entrando, orbitando o saliendo)
// el loop le cede la cámara a este módulo y NO corre los controles FPS.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  DRONE_DAMPING,
  DRONE_FILL,
  DRONE_MAX_POLAR,
  DRONE_MIN_POLAR,
  DRONE_PITCH,
  DRONE_TRANSITION_MS,
  EYE_HEIGHT,
  type WorldModel,
} from "./world-types";

export interface DroneMode {
  /** true mientras este módulo controla la cámara (transición o órbita activa). */
  controlsCamera(): boolean;
  /** true solo cuando ya está orbitando (terminó la transición de entrada). */
  isActive(): boolean;
  /** Entra a vista aérea desde FPS (guarda la pose y arranca la transición). */
  enter(): void;
  /** Vuelve a FPS con transición; al terminar dispara onExitComplete. */
  exit(): void;
  /** Avanza la transición o, ya activo, integra OrbitControls. */
  update(dt: number): void;
  /** Se invoca cuando la transición de SALIDA terminó (re-habilitar FPS + relock). */
  onExitComplete(cb: () => void): void;
  dispose(): void;
}

export interface DroneOpts {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  world: WorldModel;
}

type Phase = "idle" | "enter" | "active" | "exit";

/** Suavizado C2 (ease-in-out) para que la transición no tenga tirones. */
function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function createDroneMode(opts: DroneOpts): DroneMode {
  const { camera, domElement, world } = opts;

  // ── Encuadre aéreo a partir del bounds caminable ────────────────────────────
  const b = world?.bounds ?? { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  const minX = Number.isFinite(b.minX) ? b.minX : 0;
  const maxX = Number.isFinite(b.maxX) ? b.maxX : 1;
  const minZ = Number.isFinite(b.minZ) ? b.minZ : 0;
  const maxZ = Number.isFinite(b.maxZ) ? b.maxZ : 1;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(2, maxX - minX, maxZ - minZ);

  // Distancia para que el plano completo entre en cuadro al fov de la cámara.
  const fov = ((camera.fov || 72) * Math.PI) / 180;
  const fitDist = (span * DRONE_FILL) / (2 * Math.tan(fov / 2));
  const center = new THREE.Vector3(cx, 0, cz);
  // Posición aérea: arriba y "al sur" (+Z) según la inclinación inicial.
  const aerial = new THREE.Vector3(
    cx,
    Math.cos(DRONE_PITCH) * fitDist,
    cz + Math.sin(DRONE_PITCH) * fitDist,
  );
  // Orientación que mira al centro desde la posición aérea (para el slerp).
  const aerialQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(aerial, center, new THREE.Vector3(0, 1, 0)),
  );

  // ── OrbitControls (apagado hasta terminar la transición de entrada) ─────────
  const controls = new OrbitControls(camera, domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = DRONE_DAMPING;
  controls.screenSpacePanning = false; // pan a ras de piso (plano), no en pantalla
  controls.minPolarAngle = DRONE_MIN_POLAR;
  controls.maxPolarAngle = DRONE_MAX_POLAR;
  controls.minDistance = Math.max(2, span * 0.2);
  controls.maxDistance = fitDist * 1.7;
  controls.target.copy(center);

  // ── Estado de transición ────────────────────────────────────────────────────
  let phase: Phase = "idle";
  let t = 0; // 0..1 dentro de la transición actual
  const fromPos = new THREE.Vector3();
  const toPos = new THREE.Vector3();
  const fromQuat = new THREE.Quaternion();
  const toQuat = new THREE.Quaternion();

  // Pose FPS guardada al entrar (para restaurarla EXACTA al salir).
  const savedPos = new THREE.Vector3();
  const savedQuat = new THREE.Quaternion();

  let exitCb: (() => void) | null = null;

  function beginTransition(toP: THREE.Vector3, toQ: THREE.Quaternion): void {
    fromPos.copy(camera.position);
    fromQuat.copy(camera.quaternion);
    toPos.copy(toP);
    toQuat.copy(toQ);
    t = 0;
    controls.enabled = false; // la cámara la maneja la interpolación, no el orbit
  }

  return {
    controlsCamera() {
      return phase !== "idle";
    },
    isActive() {
      return phase === "active";
    },

    enter() {
      if (phase === "enter" || phase === "active") return;
      // Guarda la pose FPS para volver clavado a ella.
      savedPos.copy(camera.position);
      savedQuat.copy(camera.quaternion);
      phase = "enter";
      beginTransition(aerial, aerialQuat);
    },

    exit() {
      if (phase === "idle" || phase === "exit") return;
      phase = "exit";
      // El destino es la pose FPS guardada (altura de ojos asegurada al cerrar).
      const back = savedPos.clone();
      back.y = EYE_HEIGHT;
      beginTransition(back, savedQuat);
    },

    update(dt: number) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

      if (phase === "enter" || phase === "exit") {
        t += (step * 1000) / DRONE_TRANSITION_MS;
        const e = smoothstep(t);
        camera.position.lerpVectors(fromPos, toPos, e);
        camera.quaternion.slerpQuaternions(fromQuat, toQuat, e);
        if (t >= 1) {
          if (phase === "enter") {
            // Fin de la transición de entrada → cede el control al orbit.
            camera.position.copy(toPos);
            camera.quaternion.copy(toQuat);
            controls.target.copy(center);
            controls.enabled = true;
            controls.update(); // sincroniza el spherical interno con la pose actual
            phase = "active";
          } else {
            // Fin de la salida → restaura FPS exacto y avisa al orquestador.
            camera.position.copy(toPos);
            camera.position.y = EYE_HEIGHT;
            camera.quaternion.copy(toQuat);
            phase = "idle";
            if (exitCb) {
              try {
                exitCb();
              } catch {
                /* un cb roto no debe tumbar el loop */
              }
            }
          }
        }
        return;
      }

      if (phase === "active") {
        // El target nunca se sale del plano (zoom/pan acotados al bounds).
        controls.target.x = Math.max(minX, Math.min(maxX, controls.target.x));
        controls.target.z = Math.max(minZ, Math.min(maxZ, controls.target.z));
        controls.target.y = 0;
        controls.update();
      }
    },

    onExitComplete(cb: () => void) {
      if (typeof cb === "function") exitCb = cb;
    },

    dispose() {
      try {
        controls.dispose();
      } catch {
        /* noop */
      }
      exitCb = null;
      phase = "idle";
    },
  };
}
