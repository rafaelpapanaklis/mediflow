// ─────────────────────────────────────────────────────────────────────────────
// V3 / MODO VR (WebXR) — inmersivo, comfort-first. Solo se activa si el equipo
// soporta "immersive-vr"; en desktop/móvil normal este módulo es 100% no-op.
//
// LOCOMOCIÓN sin mareo:
//   · TELEPORT: apuntas con un controller; un marcador circular aparece SOLO
//     sobre celdas no bloqueadas (usa collision.isBlocked); el gatillo (select)
//     te teletransporta ahí.
//   · SNAP-TURN: empujón del thumbstick a izquierda/derecha → giro DISCRETO de
//     45° (nada de locomoción suave por rotación, que es lo que marea).
//
// ARQUITECTURA: el jugador es `playerRig` (Group padre de la cámara). En three
// r184 el XR aplica `cameraXR.matrixWorld = playerRig.matrixWorld · pose`, así que
// mover/rotar el rig mueve la vista del headset Y los controllers (que cuelgan del
// rig). Fuera de XR el rig queda en identidad y todo el modo FPS/dron sigue igual.
// La altura de cámara la pone el headset (reference space 'local-floor').
//
// El orquestador llama enter()/exit() y, dentro del loop (renderer.setAnimationLoop),
// update(dt, frame) SOLO mientras isPresenting(). Sombras OFF dentro de XR.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import {
  EYE_HEIGHT,
  VR_SNAP_RELEASE,
  VR_SNAP_THRESHOLD,
  VR_SNAP_TURN,
  VR_TELEPORT_MAX,
  getPalette,
  type WorldModel,
} from "./world-types";
import type { CollisionSystem } from "./collision";
import { disposeObject3D } from "./three-helpers";

export interface VrMode {
  /** Promesa: ¿este dispositivo puede entrar a immersive-vr? (desktop normal: false) */
  supported(): Promise<boolean>;
  /** Inicia la sesión VR (no-op si no soportado). */
  enter(): Promise<void>;
  /** Termina la sesión VR si la hay. */
  exit(): void;
  isPresenting(): boolean;
  /** Tick por frame DENTRO de XR: teleport aiming + snap-turn (+ rig). */
  update(dt: number, frame: unknown): void;
  /** Actualiza el panelito de muñeca (ocupados/libres). */
  setCounts(occupied: number, free: number): void;
  /** Notifica entrada/salida de la sesión (presenting true/false). */
  onSessionChange(cb: (presenting: boolean) => void): void;
  dispose(): void;
}

export interface VrOpts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  playerRig: THREE.Group;
  world: WorldModel;
  collision: CollisionSystem;
}

// ── Modelo simple de controller (caja cuerpo + gatillo + cañón corto) ─────────
function makeControllerModel(accent: string): THREE.Group {
  const g = new THREE.Group();
  const plastic = new THREE.MeshStandardMaterial({ color: "#23262d", roughness: 0.6, metalness: 0.2 });
  // Cuerpo (mango).
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), plastic);
  body.position.set(0, -0.01, 0.02);
  g.add(body);
  // Cañón corto que apunta hacia -Z (la dirección del rayo).
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), plastic);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, -0.04);
  g.add(barrel);
  // Gatillo de acento (para que se lea como "controller").
  const trig = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.02, 0.02),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, metalness: 0.1 }),
  );
  trig.position.set(0, -0.035, -0.005);
  g.add(trig);
  return g;
}

// ── Rayo del controller (línea de 0 a -1 en Z local; se escala a la distancia) ─
function makeTeleportRay(accent: string): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const mat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  line.name = "vrRay";
  line.visible = false;
  return line;
}

// ── Marcador de teletransporte (anillo + disco translúcido a ras de piso) ─────
function makeTeleportMarker(accent: string): THREE.Group {
  const g = new THREE.Group();
  g.name = "vrMarker";
  const ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  const discMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 28), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.019;
  g.add(disc);
  g.visible = false;
  return g;
}

// ── Panel de muñeca (plano con CanvasTexture: ocupados/libres) ────────────────
interface WristPanel {
  object: THREE.Mesh;
  setCounts(occupied: number, free: number): void;
  dispose(): void;
}
function createWristPanel(): WristPanel {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.07), mat);
  // Anclado sobre la muñeca, ligeramente inclinado hacia el rostro.
  mesh.position.set(0, 0.045, 0.03);
  mesh.rotation.set(-Math.PI / 3, 0, 0);
  mesh.name = "vrWrist";

  let lastText = "";
  function draw(occupied: number, free: number): void {
    const text = `${occupied}|${free}`;
    if (text === lastText) return;
    lastText = text;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(15,18,24,0.86)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#10B981";
    ctx.fillRect(0, 0, W, 8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText("En la clínica", W / 2, 36);
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.fillStyle = "#EF4444";
    ctx.fillText(`${occupied}`, W * 0.3, 88);
    ctx.fillStyle = "#10B981";
    ctx.fillText(`${free}`, W * 0.7, 88);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#9ca3af";
    ctx.fillText("ocupados   ·   libres", W / 2, 116);
    tex.needsUpdate = true;
  }
  draw(0, 0);

  return {
    object: mesh,
    setCounts: draw,
    dispose() {
      tex.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    },
  };
}

export function createVrMode(opts: VrOpts): VrMode {
  const { renderer, scene, camera, playerRig, world, collision } = opts;
  const xr: any = typeof navigator !== "undefined" ? (navigator as any).xr : undefined;
  const accent = getPalette(world?.category ?? "").accent;

  const b = world?.bounds ?? { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  const minX = Number.isFinite(b.minX) ? b.minX : 0;
  const maxX = Number.isFinite(b.maxX) ? b.maxX : 1;
  const minZ = Number.isFinite(b.minZ) ? b.minZ : 0;
  const maxZ = Number.isFinite(b.maxZ) ? b.maxZ : 1;

  let presenting = false;
  let built = false;
  let prevShadow = true;
  let snapArmed = true;
  const changeCbs: Array<(p: boolean) => void> = [];

  // Pose FPS guardada al entrar (para restaurarla EXACTA al salir de VR).
  const savedPos = new THREE.Vector3();
  const savedQuat = new THREE.Quaternion();

  // Controllers + rayos + grips + marcador + panel de muñeca.
  let c0: THREE.Group | null = null;
  let c1: THREE.Group | null = null;
  let g0: THREE.Group | null = null;
  let g1: THREE.Group | null = null;
  let ray0: THREE.Line | null = null;
  let ray1: THREE.Line | null = null;
  let marker: THREE.Group | null = null;
  let wrist: WristPanel | null = null;
  let pendingCounts: { o: number; f: number } | null = null;

  // Controller actualmente apuntando para teleport (gatillo apretado).
  let aim: THREE.Group | null = null;
  let aimRay: THREE.Line | null = null;
  let validHit: { x: number; z: number } | null = null;

  // Vectores/quats reutilizables (sin asignar memoria por frame).
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const qTmp = new THREE.Quaternion();
  const headA = new THREE.Vector3();
  const headB = new THREE.Vector3();

  function selectStart(ev: any): void {
    aim = ev?.target ?? null;
    aimRay = aim === c0 ? ray0 : aim === c1 ? ray1 : null;
  }
  function selectEnd(): void {
    if (validHit) {
      // Teletransporta el rig para que el HEADSET aterrice sobre el objetivo.
      camera.getWorldPosition(headA);
      playerRig.position.x += validHit.x - headA.x;
      playerRig.position.z += validHit.z - headA.z;
      playerRig.updateMatrixWorld(true);
    }
    aim = null;
    aimRay = null;
    validHit = null;
    if (ray0) ray0.visible = false;
    if (ray1) ray1.visible = false;
    if (marker) marker.visible = false;
  }

  function attachWristTo(grip: THREE.Group | null): void {
    if (!wrist || !grip) return;
    if (wrist.object.parent !== grip) grip.add(wrist.object);
  }

  function build(): void {
    if (built) return;
    built = true;
    c0 = renderer.xr.getController(0) as unknown as THREE.Group;
    c1 = renderer.xr.getController(1) as unknown as THREE.Group;
    g0 = renderer.xr.getControllerGrip(0) as unknown as THREE.Group;
    g1 = renderer.xr.getControllerGrip(1) as unknown as THREE.Group;
    g0.add(makeControllerModel(accent));
    g1.add(makeControllerModel(accent));
    ray0 = makeTeleportRay(accent);
    ray1 = makeTeleportRay(accent);
    c0.add(ray0);
    c1.add(ray1);
    marker = makeTeleportMarker(accent);
    scene.add(marker);
    wrist = createWristPanel();
    if (pendingCounts) wrist.setCounts(pendingCounts.o, pendingCounts.f);

    // three no tipa los eventos XR ("selectstart"/"connected"…) en su EventMap;
    // casteamos el objeto a any para registrar/quitar listeners sin pelear con TS.
    const C0 = c0 as any;
    const C1 = c1 as any;
    C0.addEventListener("selectstart", selectStart);
    C0.addEventListener("selectend", selectEnd);
    C1.addEventListener("selectstart", selectStart);
    C1.addEventListener("selectend", selectEnd);

    // Ancla el panel a la muñeca IZQUIERDA según la MANO REAL (handedness). Como
    // grip[i] corresponde a controller[i], si el índice 0 es la mano derecha, la
    // izquierda es el índice 1. Grip 0 queda de respaldo hasta el primer "connected".
    attachWristTo(g0);
    C0.addEventListener("connected", (e: any) => {
      if (e?.data?.handedness === "left") attachWristTo(g0);
      else if (e?.data?.handedness === "right") attachWristTo(g1);
    });
    C1.addEventListener("connected", (e: any) => {
      if (e?.data?.handedness === "left") attachWristTo(g1);
      else if (e?.data?.handedness === "right") attachWristTo(g0);
    });

    playerRig.add(c0, c1, g0, g1);
  }

  function onSessionStart(): void {
    presenting = true;
    // Performance: sombras OFF dentro de XR (se restauran al salir).
    prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.needsUpdate = true;
    // Coloca el rig donde estaba el jugador en FPS (altura la da el headset).
    playerRig.position.set(savedPos.x, 0, savedPos.z);
    playerRig.rotation.set(0, 0, 0);
    playerRig.updateMatrixWorld(true);
    snapArmed = true;
    for (let i = 0; i < changeCbs.length; i++) {
      try {
        changeCbs[i](true);
      } catch {
        /* noop */
      }
    }
  }

  function onSessionEnd(): void {
    presenting = false;
    renderer.shadowMap.enabled = prevShadow;
    renderer.shadowMap.needsUpdate = true;
    // Restaura el rig a identidad y la cámara a su pose FPS exacta.
    playerRig.position.set(0, 0, 0);
    playerRig.rotation.set(0, 0, 0);
    playerRig.updateMatrixWorld(true);
    camera.position.copy(savedPos);
    camera.position.y = EYE_HEIGHT;
    camera.quaternion.copy(savedQuat);
    if (marker) marker.visible = false;
    if (ray0) ray0.visible = false;
    if (ray1) ray1.visible = false;
    aim = null;
    aimRay = null;
    validHit = null;
    for (let i = 0; i < changeCbs.length; i++) {
      try {
        changeCbs[i](false);
      } catch {
        /* noop */
      }
    }
  }

  // Intersección del rayo del controller con el piso (y=0); valida la celda.
  function floorHit(controller: THREE.Group): { x: number; z: number; valid: boolean; dist: number } | null {
    controller.updateMatrixWorld();
    origin.setFromMatrixPosition(controller.matrixWorld);
    controller.getWorldQuaternion(qTmp);
    dir.set(0, 0, -1).applyQuaternion(qTmp).normalize();
    if (dir.y > -1e-4) return null; // apunta al horizonte/arriba → sin piso
    const tt = -origin.y / dir.y;
    if (tt < 0 || tt > VR_TELEPORT_MAX) return null;
    const hx = origin.x + dir.x * tt;
    const hz = origin.z + dir.z * tt;
    const inBounds = hx >= minX && hx <= maxX && hz >= minZ && hz <= maxZ;
    const valid = inBounds && !collision.isBlocked(Math.floor(hx), Math.floor(hz));
    return { x: hx, z: hz, valid, dist: tt };
  }

  function applySnap(sign: number): void {
    camera.getWorldPosition(headA);
    playerRig.rotation.y += sign * VR_SNAP_TURN;
    playerRig.updateMatrixWorld(true);
    camera.getWorldPosition(headB);
    // Mantén fija la posición del headset en mundo: solo gira la vista.
    playerRig.position.x += headA.x - headB.x;
    playerRig.position.z += headA.z - headB.z;
    playerRig.updateMatrixWorld(true);
  }

  function readSnap(session: any): void {
    const sources = session?.inputSources;
    if (!sources) return;
    let stickX = 0;
    for (let i = 0; i < sources.length; i++) {
      const gp = sources[i] && sources[i].gamepad;
      const ax = gp && gp.axes;
      if (!ax) continue;
      const a0 = typeof ax[0] === "number" ? ax[0] : 0;
      const a2 = typeof ax[2] === "number" ? ax[2] : 0;
      const x = Math.abs(a2) > Math.abs(a0) ? a2 : a0; // thumbstick suele ser [2]
      if (Math.abs(x) > Math.abs(stickX)) stickX = x;
    }
    if (snapArmed && Math.abs(stickX) > VR_SNAP_THRESHOLD) {
      applySnap(stickX > 0 ? -1 : 1); // derecha → giro horario
      snapArmed = false;
    } else if (Math.abs(stickX) < VR_SNAP_RELEASE) {
      snapArmed = true;
    }
  }

  // Ciclo de vida de la sesión XR (una sola vez; se desengancha en dispose()).
  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);

  return {
    supported() {
      if (!xr || typeof xr.isSessionSupported !== "function") return Promise.resolve(false);
      return Promise.resolve(xr.isSessionSupported("immersive-vr")).catch(() => false);
    },

    async enter() {
      if (!xr || presenting) return;
      // Guarda la pose FPS ANTES de que el headset tome la cámara.
      savedPos.copy(camera.position);
      savedQuat.copy(camera.quaternion);
      try {
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType("local-floor");
        const session = await xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor"],
        });
        build();
        await renderer.xr.setSession(session);
      } catch {
        /* el usuario canceló o el equipo no pudo: seguimos en FPS sin romper */
      }
    },

    exit() {
      try {
        renderer.xr.getSession()?.end();
      } catch {
        /* noop */
      }
    },

    isPresenting() {
      return presenting;
    },

    update(dt: number, _frame: unknown) {
      if (!presenting) return;
      // El rig ya pudo moverse: refresca matrices del subárbol antes de leer rayos.
      playerRig.updateMatrixWorld(true);
      const session = renderer.xr.getSession() as any;
      if (session) readSnap(session);

      // Teleport aiming: solo mientras se sostiene el gatillo (aim activo).
      if (aim && aimRay) {
        const hit = floorHit(aim);
        if (hit) {
          aimRay.visible = true;
          aimRay.scale.z = Math.max(0.001, hit.dist);
          (aimRay.material as THREE.LineBasicMaterial).color.set(hit.valid ? accent : "#ef4444");
          if (hit.valid) {
            validHit = { x: hit.x, z: hit.z };
            if (marker) {
              marker.position.set(hit.x, 0, hit.z);
              marker.visible = true;
            }
          } else {
            validHit = null;
            if (marker) marker.visible = false;
          }
        } else {
          aimRay.visible = false;
          validHit = null;
          if (marker) marker.visible = false;
        }
      }
    },

    setCounts(occupied: number, free: number) {
      if (wrist) wrist.setCounts(occupied, free);
      else pendingCounts = { o: occupied, f: free };
    },

    onSessionChange(cb) {
      if (typeof cb === "function") changeCbs.push(cb);
    },

    dispose() {
      try {
        renderer.xr.getSession()?.end();
      } catch {
        /* noop */
      }
      renderer.xr.removeEventListener("sessionstart", onSessionStart);
      renderer.xr.removeEventListener("sessionend", onSessionEnd);
      if (c0) {
        (c0 as any).removeEventListener("selectstart", selectStart);
        (c0 as any).removeEventListener("selectend", selectEnd);
      }
      if (c1) {
        (c1 as any).removeEventListener("selectstart", selectStart);
        (c1 as any).removeEventListener("selectend", selectEnd);
      }
      // Quita controllers/grips del rig y libera sus modelos/rayos.
      [c0, c1, g0, g1].forEach((o) => {
        if (o && o.parent) o.parent.remove(o);
        if (o) disposeObject3D(o);
      });
      if (marker) {
        if (marker.parent) marker.parent.remove(marker);
        disposeObject3D(marker);
      }
      wrist?.dispose();
      changeCbs.length = 0;
      c0 = c1 = g0 = g1 = null;
      ray0 = ray1 = null;
      marker = null;
      wrist = null;
      aim = null;
      aimRay = null;
      validHit = null;
      built = false;
    },
  };
}
