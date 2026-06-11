// ─────────────────────────────────────────────────────────────────────────────
// A4 — Controles FPS de escritorio: PointerLockControls + WASD/flechas.
//
// TODO(A4): implementar createDesktopControls según este brief.
//
// - new PointerLockControls(camera, domElement). En three r184 la cámara ES el
//   objeto controlado: lee/escribe camera.position directamente (NO uses
//   getObject(), removido). El control hace el "mirar" con el mouse.
// - lock(): controls.lock(); ESC suelta el lock nativamente. Expón isLocked()
//   leyendo controls.isLocked. onLockChange(cb): escucha eventos "lock"/"unlock"
//   del control y notifica (para que el HUD muestre/oculte el hint y el overlay
//   "click para entrar").
// - Teclado (keydown/keyup en window): W/ArrowUp adelante, S/ArrowDown atrás,
//   A/ArrowLeft izquierda, D/ArrowRight derecha. Shift = SLOW_SPEED, normal =
//   WALK_SPEED. Guarda un set de teclas activas; en blur/visibilitychange limpia
//   el set (evita "tecla pegada"). preventDefault de las flechas para no scrollear.
// - update(dt, collision): si !isLocked() no te muevas. Calcula dirección a
//   partir del YAW de la cámara: forward = (-sin(yaw), 0, -cos(yaw)) usando
//   camera.getWorldDirection proyectado a XZ (normaliza ignorando Y); right =
//   forward × up. delta = (forward*fb + right*lr) normalizado * speed * dt.
//   pos = collision.resolveMove(camera.position, deltaVec, PLAYER_RADIUS).
//   camera.position.copy(pos); camera.position.y = EYE_HEIGHT (fija la altura
//   de ojos SIEMPRE).
// - dispose(): remove listeners (window keydown/keyup, blur, visibilitychange,
//   lock/unlock del control), controls.dispose().
//
// El click sobre el canvas que dispara lock() lo conecta el orquestador
// (llamando a lock()), o puedes exponer un connect(domElement) — mantén lock()
// público y deja que el orquestador lo invoque desde su overlay.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { EYE_HEIGHT, PLAYER_RADIUS, WALK_SPEED, SLOW_SPEED } from "./world-types";
import type { CollisionSystem } from "./collision";

export interface DesktopControls {
  controls: any;
  update(dt: number, collision: CollisionSystem): void;
  lock(): void;
  isLocked(): boolean;
  onLockChange(cb: (locked: boolean) => void): void;
  /** Se dispara si el navegador rechaza el lock (p.ej. throttle de Chrome). */
  onLockError(cb: () => void): void;
  dispose(): void;
}

export function createDesktopControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): DesktopControls {
  // En three r184 PointerLockControls NO expone getObject(): la cámara ES el
  // objeto controlado. El control captura el mouse y rota camera.quaternion;
  // nosotros leemos/escribimos camera.position para el desplazamiento WASD.
  const controls = new PointerLockControls(camera, domElement);

  // Set de teclas físicas activas (event.code, independiente del layout/idioma).
  const pressed = new Set<string>();
  // Callbacks suscritos a cambios de lock (HUD: overlay "click para entrar" / hint).
  const lockCbs: Array<(locked: boolean) => void> = [];

  // Vectores reutilizables (evita asignaciones por frame en update()).
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Códigos de tecla mapeados a cada dirección (WASD + flechas).
  const FWD_KEYS = ["KeyW", "ArrowUp"];
  const BACK_KEYS = ["KeyS", "ArrowDown"];
  const LEFT_KEYS = ["KeyA", "ArrowLeft"];
  const RIGHT_KEYS = ["KeyD", "ArrowRight"];
  const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const anyPressed = (keys: string[]): boolean => keys.some((k) => pressed.has(k));

  // FUENTE DE VERDAD ÚNICA del lock: el navegador. NO uses controls.isLocked:
  // en three r184 PointerLockControls despacha "lock"/"unlock" ANTES de setear
  // su propio isLocked, así que leerlo en ese momento da el valor invertido. En
  // cambio document.pointerLockElement YA está actualizado cuando corre cualquier
  // listener de "pointerlockchange".
  function isLocked(): boolean {
    return typeof document !== "undefined" && document.pointerLockElement === domElement;
  }

  // ── Teclado (en window para no depender del foco del canvas) ────────────────
  function onKeyDown(e: KeyboardEvent): void {
    // Las flechas hacen scroll de la página por defecto: cancélalo.
    if (ARROW_KEYS.has(e.code)) e.preventDefault();
    pressed.add(e.code);
  }
  function onKeyUp(e: KeyboardEvent): void {
    pressed.delete(e.code);
  }
  // Anti "tecla pegada": si la ventana pierde foco o se oculta la pestaña con
  // una tecla apretada nunca llega el keyup → limpia el set.
  function clearKeys(): void {
    pressed.clear();
  }

  // ── Cambio de lock REAL del navegador → notifica HUD ────────────────────────
  const lockErrCbs: Array<() => void> = [];
  function emitLock(): void {
    const locked = isLocked();
    // Al perder el lock soltamos las teclas (si no, sigues "caminando" al volver).
    if (!locked) clearKeys();
    for (const cb of lockCbs) {
      try { cb(locked); } catch { /* un cb roto no debe tumbar a los demás */ }
    }
  }
  function onPointerLockError(): void {
    // Chrome rechaza el lock si lo pides <~1.3s tras soltarlo. No crashea:
    // emitimos el estado real (desbloqueado) para que el overlay reaparezca y el
    // usuario reintente; el siguiente clic (pasado el throttle) sí entra.
    emitLock();
    for (const cb of lockErrCbs) {
      try { cb(); } catch { /* noop */ }
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);
  document.addEventListener("visibilitychange", clearKeys);
  // Escuchamos el evento del NAVEGADOR (no los sintéticos de three) → estado fiable.
  document.addEventListener("pointerlockchange", emitLock);
  document.addEventListener("pointerlockerror", onPointerLockError);

  return {
    controls,

    update(dt: number, collision: CollisionSystem): void {
      if (!isLocked()) return;

      const fb = (anyPressed(FWD_KEYS) ? 1 : 0) - (anyPressed(BACK_KEYS) ? 1 : 0);
      const lr = (anyPressed(RIGHT_KEYS) ? 1 : 0) - (anyPressed(LEFT_KEYS) ? 1 : 0);
      if (fb === 0 && lr === 0) return;

      // Dirección desde el YAW de la cámara, proyectada a XZ (ignora pitch en Y):
      // así mirar arriba/abajo no te frena ni te lanza al techo/piso.
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-8) return; // cámara mirando recto a ±Y
      forward.normalize();
      // right = forward × up (perpendicular en el plano del piso).
      right.crossVectors(forward, up).normalize();

      // Vector de desplazamiento normalizado → diagonal no es más rápida.
      move.set(0, 0, 0);
      move.addScaledVector(forward, fb);
      move.addScaledVector(right, lr);
      if (move.lengthSq() > 1e-8) move.normalize();

      const speed = pressed.has("ShiftLeft") || pressed.has("ShiftRight")
        ? SLOW_SPEED
        : WALK_SPEED;
      move.multiplyScalar(speed * dt);

      // Colisión + deslizamiento (resolveMove no muta camera.position).
      const next = collision.resolveMove(camera.position, move, PLAYER_RADIUS);
      camera.position.copy(next);
      // La altura de ojos es fija (no hay salto ni gravedad).
      camera.position.y = EYE_HEIGHT;
    },

    lock(): void {
      // requestPointerLock requiere gesto del usuario y, si lo throttlean, puede
      // rechazar de forma SÍNCRONA o como promesa: tragamos ambos (el evento
      // pointerlockerror se encarga de avisar al HUD). Sin esto, la promesa
      // rechazada generaba un unhandledrejection en consola.
      try {
        const ret: any = controls.lock();
        if (ret && typeof ret.catch === "function") ret.catch(() => {});
      } catch { /* requiere gesto del usuario / throttle */ }
    },

    isLocked,

    onLockChange(cb: (locked: boolean) => void): void {
      if (typeof cb === "function") lockCbs.push(cb);
    },

    onLockError(cb: () => void): void {
      if (typeof cb === "function") lockErrCbs.push(cb);
    },

    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", clearKeys);
      document.removeEventListener("pointerlockchange", emitLock);
      document.removeEventListener("pointerlockerror", onPointerLockError);
      lockCbs.length = 0;
      lockErrCbs.length = 0;
      pressed.clear();
      try { (controls as any).dispose?.(); } catch { /* noop */ }
    },
  };
}
