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
  WALL_HEIGHT,
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

/**
 * La distancia MAS CORTA a la que todavia cabe todo, por biseccion.
 *
 * No hay formula cerrada decente: la camara mira en picado, asi que el borde
 * lejano del piso queda mucho mas lejos que el cercano y la huella en
 * pantalla no es un rectangulo. Antes se aproximaba tomando el lado mas
 * largo contra el FOV vertical, que sobra tanto que la clinica salia
 * diminuta; aproximarlo por el otro lado la dejaba cortada. Probar es
 * exacto, cuesta ~30 iteraciones UNA vez al construir, y se adapta solo a la
 * forma del piso y a la proporcion de la pantalla.
 */
function resolverDistancia(cabe: (d: number) => boolean, span: number): number {
  let alto = Math.max(4, span);
  // Crecer hasta encontrar una distancia que si funcione (tope de guarda).
  for (let i = 0; i < 24 && !cabe(alto); i++) alto *= 1.4;
  if (!cabe(alto)) return alto; // pantalla degenerada: mejor lejos que cortado
  let bajo = 0.5;
  for (let i = 0; i < 30; i++) {
    const medio = (bajo + alto) / 2;
    if (cabe(medio)) alto = medio;
    else bajo = medio;
  }
  return alto;
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

  /**
   * Distancia para que el plano completo entre en cuadro.
   *
   * 🔴 ANTES SE ENCUADRABA SOLO POR EL ALTO, y por eso la clínica salía
   * diminuta con media pantalla vacía a los lados. Se tomaba el lado MÁS
   * LARGO del piso y se le hacía caber en el FOV VERTICAL — que es el único
   * que trae la cámara—, así que un piso ancho y poco profundo, visto en un
   * monitor ancho y bajo (una recepción, justamente), empujaba la cámara
   * mucho más atrás de lo necesario: se encuadraba a lo alto un tamaño que
   * a lo ancho sobraba de largo.
   *
   * Ahora cada eje se mide contra el FOV que le toca y manda el que pida
   * más distancia. El ancho contra el FOV horizontal (que es el vertical
   * por el aspecto), y el fondo contra el vertical — comprimido por la
   * inclinación de la cámara, porque mirando en picado la profundidad se ve
   * acortada (de canto no ocuparía nada; a plomo ocuparía todo).
   *
   * El resultado NUNCA es más lejos que antes: como mucho igual. Y sigue
   * cabiendo entero, que es lo que `DRONE_FILL` termina de asegurar.
   */
  const fov = ((camera.fov || 72) * Math.PI) / 180;
  const tanV = Math.tan(fov / 2);
  const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  const tanH = tanV * aspect;
  const ARRIBA = new THREE.Vector3(0, 1, 0);

  /**
   * Las ocho esquinas de la caja del piso: las cuatro del suelo y las cuatro
   * a la altura del muro. Con solo las del suelo, un muro del fondo asomaba
   * por encima del cuadro.
   */
  const esquinas: THREE.Vector3[] = [];
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      esquinas.push(new THREE.Vector3(x, 0, z));
      esquinas.push(new THREE.Vector3(x, WALL_HEIGHT, z));
    }
  }

  const centroFijo = new THREE.Vector3(cx, 0, cz);
  const camTmp = new THREE.Vector3();
  const pTmp = new THREE.Vector3();
  const qTmp = new THREE.Quaternion();
  const mTmp = new THREE.Matrix4();

  /** ¿A esta distancia cabe la clínica ENTERA en el cuadro? */
  const cabeEn = (d: number): boolean => {
    camTmp.set(cx, Math.cos(DRONE_PITCH) * d, cz + Math.sin(DRONE_PITCH) * d);
    qTmp.setFromRotationMatrix(mTmp.lookAt(camTmp, centroFijo, ARRIBA)).invert();
    for (const e of esquinas) {
      pTmp.copy(e).sub(camTmp).applyQuaternion(qTmp);
      const prof = -pTmp.z; // la cámara mira hacia -Z en su propio espacio
      if (prof <= 0.01) return false; // detrás de la cámara
      if (Math.abs(pTmp.y) > tanV * prof) return false;
      if (Math.abs(pTmp.x) > tanH * prof) return false;
    }
    return true;
  };
  const fitDist = resolverDistancia(cabeEn, span) * DRONE_FILL;
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
