// ─────────────────────────────────────────────────────────────────────────────
// A5 — Controles táctiles/móviles, IMPLEMENTADOS A MANO (sin dependencias):
// joystick virtual izquierdo (movimiento) + arrastre derecho (mirar).
//
// TODO(A5): implementar createTouchControls según este brief.
//
// El orquestador te pasa `layer`: un <div> absoluto que cubre el viewport (sobre
// el canvas, debajo del HUD informativo). Tú creas dentro de él el DOM del
// joystick y enganchas los touch listeners. NO uses PointerLockControls en móvil.
//
// ESTADO de mirar: yaw, pitch (radianes). Aplica a la cámara con
//   camera.rotation order "YXZ": camera.rotation.set(pitch, yaw, 0). Clampa
//   pitch a ±~85°. Inicializa yaw/pitch desde la cámara actual al montar.
//
// JOYSTICK (mitad izquierda de la pantalla):
//   - Al primer touchstart en la mitad izquierda: crea/posiciona una base
//     circular (~120px) centrada en el toque y un knob. Calcula vector (dx,dz)
//     normalizado [-1..1] según el desplazamiento del knob respecto al centro
//     (radio máx ~50px). Guarda moveX (derecha/izq) y moveZ (adelante/atrás:
//     hacia arriba en pantalla = adelante = negativo Z relativo).
//   - touchend en ese toque → resetea vector a 0 y oculta la base.
//
// MIRAR (mitad derecha): touchmove arrastrando → yaw -= dx * SENS;
//   pitch -= dy * SENS (SENS ~0.0042 rad/px). Multitouch: rastrea por
//   identifier para no mezclar el dedo del joystick con el de mirar.
//
// update(dt, collision): construye la dirección con el yaw actual (igual que
//   desktop: forward/right en XZ), delta = (forward*moveZf + right*moveXf) *
//   WALK_SPEED * dt (usa la magnitud del joystick como acelerador 0..1).
//   pos = collision.resolveMove(camera.position, delta, PLAYER_RADIUS);
//   camera.position.copy(pos); camera.position.y = EYE_HEIGHT.
//
// dispose(): remove TODOS los listeners y el DOM del joystick que creaste dentro
//   de `layer` (no borres `layer`, lo gestiona el orquestador).
//
// Accesibilidad/responsive: el joystick aparece donde el usuario toca, así sirve
// en cualquier resolución. touch-action: none en `layer` para que el navegador
// no haga scroll/zoom mientras juegas.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { EYE_HEIGHT, PLAYER_RADIUS, WALK_SPEED } from "./world-types";
import type { CollisionSystem } from "./collision";

export interface TouchControls {
  update(dt: number, collision: CollisionSystem): void;
  dispose(): void;
}

// ── Parámetros de los controles táctiles ─────────────────────────────────────
const LOOK_SENS = 0.0042;          // rad por px arrastrado (mirar)
const PITCH_LIMIT = (85 * Math.PI) / 180;
const JOY_BASE_RADIUS = 60;        // base ~120px de diámetro
const JOY_KNOB_RADIUS = 25;        // diámetro del knob ~50px
const JOY_MAX_TRAVEL = 50;         // desplazamiento máx del knob (px) = magnitud 1

export function createTouchControls(
  camera: THREE.PerspectiveCamera,
  layer: HTMLElement,
): TouchControls {
  // ── Estado de mirar (inicializado desde la cámara actual) ──────────────────
  camera.rotation.order = "YXZ";
  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;

  // ── Estado del joystick (movimiento) ───────────────────────────────────────
  let moveX = 0; // -1..1 (derecha/izquierda)
  let moveZ = 0; // -1..1 (adelante = +, atrás = -)

  // Identificadores de los dedos activos (multitouch): uno mueve, otro mira.
  let joyId: number | null = null;     // dedo del joystick (mitad izquierda)
  let joyOriginX = 0;                  // centro de la base (donde tocó)
  let joyOriginY = 0;
  let lookId: number | null = null;    // dedo de mirar (mitad derecha)
  let lookLastX = 0;
  let lookLastY = 0;

  // ── DOM del joystick (creado DENTRO de `layer`, no fuera) ──────────────────
  const base = document.createElement("div");
  base.style.cssText = [
    "position:absolute",
    "width:" + JOY_BASE_RADIUS * 2 + "px",
    "height:" + JOY_BASE_RADIUS * 2 + "px",
    "border-radius:50%",
    "background:rgba(255,255,255,0.12)",
    "border:2px solid rgba(255,255,255,0.35)",
    "box-shadow:0 2px 12px rgba(0,0,0,0.25)",
    "pointer-events:none",
    "display:none",
    "left:0",
    "top:0",
    "z-index:2",
    "touch-action:none",
  ].join(";");

  const knob = document.createElement("div");
  knob.style.cssText = [
    "position:absolute",
    "width:" + JOY_KNOB_RADIUS * 2 + "px",
    "height:" + JOY_KNOB_RADIUS * 2 + "px",
    "border-radius:50%",
    "background:rgba(255,255,255,0.85)",
    "box-shadow:0 1px 6px rgba(0,0,0,0.3)",
    "left:" + (JOY_BASE_RADIUS - JOY_KNOB_RADIUS) + "px",
    "top:" + (JOY_BASE_RADIUS - JOY_KNOB_RADIUS) + "px",
    "pointer-events:none",
  ].join(";");
  base.appendChild(knob);
  layer.appendChild(base);

  // Coloca la base centrada en (cx,cy) relativo a `layer` y resetea el knob.
  function placeBase(cx: number, cy: number) {
    base.style.left = cx - JOY_BASE_RADIUS + "px";
    base.style.top = cy - JOY_BASE_RADIUS + "px";
    knob.style.left = JOY_BASE_RADIUS - JOY_KNOB_RADIUS + "px";
    knob.style.top = JOY_BASE_RADIUS - JOY_KNOB_RADIUS + "px";
    base.style.display = "block";
  }

  // Actualiza el knob y el vector (moveX,moveZ) según el desplazamiento.
  function moveKnob(dx: number, dy: number) {
    const dist = Math.hypot(dx, dy);
    let kx = dx;
    let ky = dy;
    if (dist > JOY_MAX_TRAVEL) {
      const s = JOY_MAX_TRAVEL / dist;
      kx = dx * s;
      ky = dy * s;
    }
    // El knob se dibuja respecto al centro de la base.
    knob.style.left = JOY_BASE_RADIUS - JOY_KNOB_RADIUS + kx + "px";
    knob.style.top = JOY_BASE_RADIUS - JOY_KNOB_RADIUS + ky + "px";
    // Vector normalizado 0..1 (acelerador). Hacia arriba en pantalla = adelante.
    moveX = kx / JOY_MAX_TRAVEL;
    moveZ = -ky / JOY_MAX_TRAVEL;
  }

  function resetJoystick() {
    joyId = null;
    moveX = 0;
    moveZ = 0;
    base.style.display = "none";
  }

  // ── Touch listeners en `layer` ─────────────────────────────────────────────
  // touch-action:none ya viene en el layer (no hay scroll/zoom del navegador).
  function localPoint(t: Touch): { x: number; y: number } {
    const rect = layer.getBoundingClientRect();
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function onTouchStart(e: TouchEvent) {
    const rect = layer.getBoundingClientRect();
    const halfW = rect.width / 2;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const lx = t.clientX - rect.left;
      const ly = t.clientY - rect.top;
      if (lx < halfW) {
        // Mitad izquierda → joystick (solo el primer dedo manda).
        if (joyId === null) {
          joyId = t.identifier;
          joyOriginX = lx;
          joyOriginY = ly;
          placeBase(lx, ly);
        }
      } else {
        // Mitad derecha → mirar (solo un dedo a la vez).
        if (lookId === null) {
          lookId = t.identifier;
          lookLastX = t.clientX;
          lookLastY = t.clientY;
        }
      }
    }
    e.preventDefault();
  }

  function onTouchMove(e: TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyId) {
        const p = localPoint(t);
        moveKnob(p.x - joyOriginX, p.y - joyOriginY);
      } else if (t.identifier === lookId) {
        const dx = t.clientX - lookLastX;
        const dy = t.clientY - lookLastY;
        lookLastX = t.clientX;
        lookLastY = t.clientY;
        yaw -= dx * LOOK_SENS;
        pitch -= dy * LOOK_SENS;
        if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
        else if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
      }
    }
    e.preventDefault();
  }

  function onTouchEnd(e: TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyId) resetJoystick();
      else if (t.identifier === lookId) lookId = null;
    }
    e.preventDefault();
  }

  const opts: AddEventListenerOptions = { passive: false };
  layer.addEventListener("touchstart", onTouchStart, opts);
  layer.addEventListener("touchmove", onTouchMove, opts);
  layer.addEventListener("touchend", onTouchEnd, opts);
  layer.addEventListener("touchcancel", onTouchEnd, opts);

  // ── Vectores reutilizables (sin asignar memoria por frame) ─────────────────
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const delta = new THREE.Vector3();

  return {
    update(dt: number, collision: CollisionSystem) {
      // Aplica el estado de mirar a la cámara (orden YXZ).
      camera.rotation.set(pitch, yaw, 0);

      if (moveX === 0 && moveZ === 0) {
        camera.position.y = EYE_HEIGHT;
        return;
      }

      // forward/right en XZ desde el YAW (igual que desktop).
      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));

      delta.set(0, 0, 0);
      delta.addScaledVector(forward, moveZ);
      delta.addScaledVector(right, moveX);
      // La magnitud del joystick ya es el acelerador (0..1); no normalizar.
      delta.multiplyScalar(WALK_SPEED * dt);

      const pos = collision.resolveMove(camera.position, delta, PLAYER_RADIUS);
      camera.position.copy(pos);
      camera.position.y = EYE_HEIGHT;
    },
    dispose() {
      layer.removeEventListener("touchstart", onTouchStart, opts);
      layer.removeEventListener("touchmove", onTouchMove, opts);
      layer.removeEventListener("touchend", onTouchEnd, opts);
      layer.removeEventListener("touchcancel", onTouchEnd, opts);
      if (base.parentNode === layer) layer.removeChild(base);
    },
  };
}
