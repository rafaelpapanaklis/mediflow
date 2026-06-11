"use client";

// ─────────────────────────────────────────────────────────────────────────────
// A10 — Orquestador del visor 3D en primera persona + performance + dispose + QA.
// Monta renderer/escena/cámara/luces, ensambla los grupos de los builders, crea
// colisión y controles (desktop o táctil según dispositivo), corre el render
// loop, hace polling del estado vivo y libera TODO al desmontar. Renderiza el
// HUD (A9) por encima.
//
// Este archivo ya viene CABLEADO contra los contratos de los demás módulos. Tu
// trabajo (A10) es endurecerlo: ver los TODO(A10) y completar/afinar:
//   · Pausar el loop con visibilitychange (pestaña oculta) y reanudar.
//   · Dispose EXHAUSTIVO (geometrías/materiales/texturas/renderer +
//     forceContextLoss + remove listeners + clear interval + controls.dispose +
//     liveLayer.dispose) — patrón del visor CBCT (Model3DViewer).
//   · pixelRatio = min(devicePixelRatio, 2); antialias true desktop / false
//     móvil; shadowMap 1024 SOLO en la directional.
//   · Resize con ResizeObserver del contenedor (no solo window).
//   · Polling resiliente (AbortController, no romper si falla; back-off opcional).
//   · Detección de móvil robusta (pointer:coarse) para elegir controles.
//   · Fullscreen API (requestFullscreen/exitFullscreen) + estado isFullscreen.
//   · QA responsive: el canvas llena el viewport en cualquier resolución.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  EYE_HEIGHT,
  POLL_MS,
  getPalette,
  type Chair3DState,
  type Clinic3DStatePayload,
  type LayoutElement,
  type LayoutMetadata,
} from "./world-types";
import { parseLayoutToWorld } from "./layout-parser";
import { buildArchitecture } from "./build-architecture";
import { buildFurniture } from "./build-furniture";
import { createLiveLayer } from "./live-layer";
import { createCollisionSystem } from "./collision";
import { createDesktopControls } from "./fps-controls";
import { createTouchControls } from "./touch-controls";
import { Clinic3DHud, type Hud3DPhase } from "./Clinic3DHud";

export interface Clinic3DClientProps {
  clinic: { id: string; name: string; category: string };
  initialElements: LayoutElement[];
  initialMetadata: LayoutMetadata | null;
  initialChairs: { id: string; name: string; color: string | null }[];
}

const STATE_API = "/api/clinic-layout/3d-state";

export function Clinic3DClient({ clinic, initialElements, initialMetadata, initialChairs }: Clinic3DClientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchLayerRef = useRef<HTMLDivElement | null>(null);

  const world = useMemo(
    () =>
      parseLayoutToWorld({
        elements: initialElements,
        metadata: initialMetadata,
        chairs: initialChairs,
        category: clinic.category,
        clinicName: clinic.name,
      }),
    [initialElements, initialMetadata, initialChairs, clinic.category, clinic.name],
  );

  const [phase, setPhase] = useState<Hud3DPhase>(world.isEmpty ? "empty" : "loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const [counts, setCounts] = useState({ occupied: 0, free: world.chairs.length, total: world.chairs.length });

  // Ref-bridges para que el HUD dispare acciones imperativas del mundo.
  const lockRef = useRef<() => void>(() => {});
  const fullscreenRef = useRef<() => void>(() => {});
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (world.isEmpty) return;
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    // Detección de móvil robusta: pointer:coarse (toque/stylus) con fallback a
    // 'ontouchstart' por si matchMedia no está disponible o miente en algún WebView.
    const touch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches === true || "ontouchstart" in window);
    setIsTouch(touch);

    // Handles que el dispose debe liberar; se asignan dentro del try y se leen en
    // el cleanup aunque la inicialización falle a mitad (dispose parcial sin fugas).
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let liveLayer: ReturnType<typeof createLiveLayer> | null = null;
    let desktop: ReturnType<typeof createDesktopControls> | null = null;
    let touchCtl: ReturnType<typeof createTouchControls> | null = null;
    let ac: AbortController | null = null;
    let pollTimer = 0;
    let raf = 0;
    let running = true; // gobierna el loop; el cleanup lo apaga (fuera del try).
    let onVisibility: (() => void) | null = null;
    let onResize: (() => void) | null = null;
    let onFsChange: (() => void) | null = null;
    let onContextLost: ((e: Event) => void) | null = null;
    let onContextRestored: (() => void) | null = null;
    let ro: ResizeObserver | null = null;
    let domEl: HTMLCanvasElement | null = null;

    try {
    // ── Escena / cámara / renderer ──────────────────────────────────────────
    scene = new THREE.Scene();
    const pal = getPalette(world.category);
    scene.background = new THREE.Color(pal.fog);
    scene.fog = new THREE.Fog(pal.fog, 12, 42);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(72, width / height, 0.05, 200);
    camera.rotation.order = "YXZ";
    camera.position.set(world.spawn.x, EYE_HEIGHT, world.spawn.z);
    camera.rotation.y = world.spawn.angle;

    renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    domEl = renderer.domElement;
    container.appendChild(domEl);
    domEl.style.display = "block";
    domEl.style.width = "100%";
    domEl.style.height = "100%";

    // ── Luces (cálidas, 1 directional con sombras baratas) ──────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xfff2e0, 0.9);
    dir.position.set(world.cols * 0.5 + 6, 16, world.rows * 0.5 + 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 60;
    scene.add(dir);
    scene.add(dir.target);

    // ── Mundo (builders) ────────────────────────────────────────────────────
    scene.add(buildArchitecture(world));
    scene.add(buildFurniture(world));
    liveLayer = createLiveLayer(world);
    scene.add(liveLayer.group);

    // ── Colisión + controles ────────────────────────────────────────────────
    const collision = createCollisionSystem(world);
    desktop = !touch ? createDesktopControls(camera, domEl) : null;
    touchCtl = touch && touchLayerRef.current ? createTouchControls(camera, touchLayerRef.current) : null;
    if (desktop) {
      const d = desktop;
      d.onLockChange((l) => setIsLocked(l));
      lockRef.current = () => d.lock();
    }

    // ── Estado vivo: polling ────────────────────────────────────────────────
    const applyStates = (chairs: Chair3DState[]) => {
      const map = new Map<string, Chair3DState>();
      for (const c of chairs) map.set(c.resourceId, c);
      liveLayer?.update(map);
      let occ = 0;
      for (const a of world.chairs) if (map.get(a.resourceId)?.status === "ocupado") occ++;
      setCounts({ occupied: occ, free: world.chairs.length - occ, total: world.chairs.length });
    };
    // Polling resiliente con AbortController por request + back-off suave. Se
    // auto-agenda con setTimeout (no setInterval) para poder espaciar el siguiente
    // intento cuando hay fallos consecutivos sin acumular requests en vuelo. Tope
    // de back-off ~5 min; un poll OK resetea la cadencia a POLL_MS.
    let pollFails = 0;
    const scheduleNextPoll = () => {
      if (disposed) return;
      const backoff = Math.min(POLL_MS * 2 ** Math.min(pollFails, 4), 300_000);
      pollTimer = window.setTimeout(poll, backoff);
    };
    const poll = async () => {
      try {
        ac?.abort();
        ac = new AbortController();
        const res = await fetch(STATE_API, { signal: ac.signal, cache: "no-store" });
        if (!res.ok) {
          pollFails++;
          return;
        }
        const data = (await res.json()) as Clinic3DStatePayload;
        if (!disposed && Array.isArray(data?.chairs)) applyStates(data.chairs);
        pollFails = 0; // éxito → vuelve a la cadencia normal.
      } catch {
        // Abort por desmontaje no cuenta como fallo de red.
        if (!disposed) pollFails++;
        /* red caída: conservamos el último estado */
      } finally {
        scheduleNextPoll();
      }
    };
    poll(); // primer poll inmediato; los siguientes los agenda el finally.

    // ── Render loop (continuo mientras visible; es un FPS) ──────────────────
    // Locals no-nulos para el closure del loop (ya están construidos aquí).
    const r = renderer;
    const sc = scene;
    const clock = new THREE.Clock();
    const loop = () => {
      if (disposed || !running) {
        raf = 0;
        return;
      }
      const dt = Math.min(clock.getDelta(), 0.05);
      desktop?.update(dt, collision);
      touchCtl?.update(dt, collision);
      r.render(sc, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Pausa real con la pestaña oculta: no quemamos GPU/batería renderizando algo
    // que nadie ve. Al volver, descartamos el delta acumulado del clock
    // (getDelta() de un solo tiro) para que el primer frame no “salte” tras minutos
    // ocultos, y reanudamos el loop solo si estaba detenido.
    onVisibility = () => {
      const visible = document.visibilityState === "visible";
      if (visible === running) return;
      running = visible;
      if (running) {
        clock.getDelta(); // quema el tiempo transcurrido oculto → sin salto.
        if (raf === 0) raf = requestAnimationFrame(loop);
      }
      // Si pasa a oculto, el propio loop ve running=false y se detiene (raf=0).
    };
    document.addEventListener("visibilitychange", onVisibility);

    // ── Pérdida/recuperación de contexto WebGL (patrón Model3DViewer) ────────
    // preventDefault deja que el navegador restaure el contexto (si no, el canvas
    // queda en negro permanente tras un reset de GPU / suspensión). Al restaurarse
    // forzamos un render para repintar de inmediato.
    onContextLost = (e: Event) => {
      e.preventDefault();
    };
    onContextRestored = () => {
      if (!disposed && running) r.render(sc, camera);
    };
    domEl.addEventListener("webglcontextlost", onContextLost);
    domEl.addEventListener("webglcontextrestored", onContextRestored);

    // ── Resize: ResizeObserver del contenedor (no solo window) ───────────────
    onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      r.setSize(w, h);
    };
    ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(container);
    window.addEventListener("resize", onResize);

    // ── Fullscreen ──────────────────────────────────────────────────────────
    onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    fullscreenRef.current = () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else container.requestFullscreen?.();
    };

      // Mundo listo.
      setLoadProgress(1);
      setErrorMsg(undefined);
      setPhase("ready");
    } catch (err) {
      // Nunca el "Application error" pelado de Next: capturamos y mostramos la
      // pantalla amable del HUD (phase="error" + mensaje). Lo ya construido se
      // libera en el cleanup de abajo (los handles nullables están hoisted).
      console.error("[Clinic3DClient] init failed", err);
      disposed = true;
      setErrorMsg(err instanceof Error ? err.message : undefined);
      setPhase("error");
    }

    // ── Dispose EXHAUSTIVO (patrón Model3DViewer) ────────────────────────────
    // Null-safe: corre igual si la init falló a mitad. Libera TODO: listeners,
    // timers, requests en vuelo, controles, capa viva, geometrías/materiales/
    // TEXTURAS, renderer (+forceContextLoss) y el canvas del DOM.
    return () => {
      disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (pollTimer) window.clearTimeout(pollTimer);
      ac?.abort();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (onFsChange) document.removeEventListener("fullscreenchange", onFsChange);
      if (onResize) window.removeEventListener("resize", onResize);
      if (domEl && onContextLost) domEl.removeEventListener("webglcontextlost", onContextLost);
      if (domEl && onContextRestored) domEl.removeEventListener("webglcontextrestored", onContextRestored);
      ro?.disconnect();
      desktop?.dispose();
      touchCtl?.dispose();
      liveLayer?.dispose();
      // Traversal: dispone geometrías, materiales y TODAS sus texturas (map y
      // demás canales) — cubre architecture + furniture (la capa viva ya liberó
      // sus CanvasTextures arriba, pero el traversal es idempotente y seguro).
      scene?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        const disposeMat = (x: THREE.Material | undefined) => {
          if (!x) return;
          const mm = x as THREE.MeshStandardMaterial & Record<string, unknown>;
          mm.map?.dispose?.();
          (mm.normalMap as THREE.Texture | undefined)?.dispose?.();
          (mm.roughnessMap as THREE.Texture | undefined)?.dispose?.();
          (mm.metalnessMap as THREE.Texture | undefined)?.dispose?.();
          (mm.aoMap as THREE.Texture | undefined)?.dispose?.();
          (mm.emissiveMap as THREE.Texture | undefined)?.dispose?.();
          (mm.alphaMap as THREE.Texture | undefined)?.dispose?.();
          x.dispose();
        };
        if (Array.isArray(mat)) mat.forEach(disposeMat);
        else disposeMat(mat);
      });
      renderer?.dispose();
      renderer?.forceContextLoss?.();
      if (domEl && container.contains(domEl)) container.removeChild(domEl);
    };
  }, [world]);

  reloadRef.current = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#0b0d11]">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Capa táctil (joystick + mirar) gestionada por touch-controls. */}
      <div
        ref={touchLayerRef}
        className="absolute inset-0 z-10"
        style={{ touchAction: "none", pointerEvents: isTouch ? "auto" : "none" }}
      />
      <Clinic3DHud
        phase={phase}
        clinicName={world.clinicName}
        category={world.category}
        loadProgress={loadProgress}
        errorMessage={errorMsg}
        occupied={counts.occupied}
        free={counts.free}
        total={counts.total}
        isTouch={isTouch}
        isLocked={isLocked}
        isFullscreen={isFullscreen}
        onRequestLock={() => lockRef.current()}
        onToggleFullscreen={() => fullscreenRef.current()}
        onRetry={() => reloadRef.current()}
      />
    </div>
  );
}
