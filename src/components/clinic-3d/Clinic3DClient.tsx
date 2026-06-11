"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador del visor 3D — V2. Conserva TODO lo de v1 (dispose exhaustivo,
// pausa por visibilitychange, polling resiliente, resize, fullscreen, context
// loss) y AÑADE: multijugador (presence+broadcast), avatares remotos
// interpolados, mano FPS, interacción raycast (click→expediente), puertas
// animadas, día/noche + tonemapping ACES, y datos para el minimapa.
//
// Este archivo viene CABLEADO contra los contratos de los módulos v2 (skeletons).
// Cada sistema es un no-op seguro hasta que su agente lo implemente, así v1 sigue
// funcionando en todo momento. A10 endurece/QA (ver TODO(A10)).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  EYE_HEIGHT,
  POLL_MS,
  POS_HZ,
  POS_MIN_MOVE,
  POS_MIN_YAW,
  WALK_SPEED,
  getPalette,
  colorFromName,
  isNightHour,
  type Chair3DState,
  type Clinic3DStatePayload,
  type LayoutElement,
  type LayoutMetadata,
  type MinimapFrame,
  type RemotePlayerState,
} from "./world-types";
import { parseLayoutToWorld } from "./layout-parser";
import { buildArchitecture } from "./build-architecture";
import { buildFurniture } from "./build-furniture";
import { createLiveLayer } from "./live-layer";
import { createCollisionSystem } from "./collision";
import { createDesktopControls } from "./fps-controls";
import { createTouchControls } from "./touch-controls";
import { createMultiplayer } from "./multiplayer";
import { createRemoteAvatars } from "./remote-avatars";
import { createHand } from "./fps-hand";
import { createInteraction } from "./interaction";
import { createDoors } from "./doors";
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
  // V2 — HUD nuevo
  const [userCount, setUserCount] = useState(1);
  const [mpEnabled, setMpEnabled] = useState(false);
  const [interactLabel, setInteractLabel] = useState<string | null>(null);
  const [targeting, setTargeting] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  // Overlay de entrada: el texto cambia a "continuar" tras la 1ª entrada; lockNote
  // muestra un aviso si el navegador rechazó el lock (throttle de Chrome).
  const [hasEntered, setHasEntered] = useState(false);
  const [lockNote, setLockNote] = useState<string | null>(null);

  // Frame del minimapa: el loop lo escribe, el HUD lo lee en su propio rAF.
  const minimapFrameRef = useRef<MinimapFrame>({ px: 0, pz: 0, yaw: 0, players: [], chairs: [] });

  // Ref-bridges para acciones imperativas desde el HUD.
  const lockRef = useRef<() => void>(() => {});
  const fullscreenRef = useRef<() => void>(() => {});
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (world.isEmpty) return;
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const touch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches === true || "ontouchstart" in window);
    setIsTouch(touch);

    // Handles liberables (se leen en el cleanup aunque la init falle a mitad).
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let liveLayer: ReturnType<typeof createLiveLayer> | null = null;
    let desktop: ReturnType<typeof createDesktopControls> | null = null;
    let touchCtl: ReturnType<typeof createTouchControls> | null = null;
    let multiplayer: ReturnType<typeof createMultiplayer> | null = null;
    let remoteAvatars: ReturnType<typeof createRemoteAvatars> | null = null;
    let hand: ReturnType<typeof createHand> | null = null;
    let interaction: ReturnType<typeof createInteraction> | null = null;
    let doors: ReturnType<typeof createDoors> | null = null;
    let ac: AbortController | null = null;
    let pollTimer = 0;
    let raf = 0;
    let running = true;
    let onVisibility: (() => void) | null = null;
    let onResize: (() => void) | null = null;
    let onFsChange: (() => void) | null = null;
    let onContextLost: ((e: Event) => void) | null = null;
    let onContextRestored: (() => void) | null = null;
    let onKeyM: ((e: KeyboardEvent) => void) | null = null;
    let onCanvasDown: ((e: MouseEvent) => void) | null = null;
    let onTouchStart: ((e: TouchEvent) => void) | null = null;
    let onTouchEnd: ((e: TouchEvent) => void) | null = null;
    let ro: ResizeObserver | null = null;
    let domEl: HTMLCanvasElement | null = null;

    try {
      // ── Escena / cámara / renderer ────────────────────────────────────────
      scene = new THREE.Scene();
      const pal = getPalette(world.category);
      const night = isNightHour(new Date().getHours());
      const fogColor = new THREE.Color(pal.fog);
      if (night) fogColor.lerp(new THREE.Color("#10141b"), 0.7);
      scene.background = fogColor.clone();
      scene.fog = new THREE.Fog(fogColor.clone(), 14, 46);

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      const camera = new THREE.PerspectiveCamera(72, width / height, 0.05, 200);
      camera.rotation.order = "YXZ";
      camera.position.set(world.spawn.x, EYE_HEIGHT, world.spawn.z);
      camera.rotation.y = world.spawn.angle;
      scene.add(camera); // la mano FPS cuelga de la cámara → debe estar en escena.

      renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // V2 — salto gráfico: tonemapping filmico + sRGB para un look limpio.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = night ? 0.95 : 1.08;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      domEl = renderer.domElement;
      container.appendChild(domEl);
      domEl.style.display = "block";
      domEl.style.width = "100%";
      domEl.style.height = "100%";

      // ── Luces (día/noche por hora local) ──────────────────────────────────
      scene.add(new THREE.AmbientLight(0xffffff, night ? 0.34 : 0.85));
      const dir = new THREE.DirectionalLight(0xfff2e0, night ? 0.12 : 0.9);
      dir.position.set(world.cols * 0.5 + 6, 16, world.rows * 0.5 + 6);
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      dir.shadow.camera.near = 1;
      dir.shadow.camera.far = 60;
      scene.add(dir);
      scene.add(dir.target);

      // ── Mundo (builders): A5 arquitectura+techo, A6 mobiliario+detalles ────
      scene.add(buildArchitecture(world));
      scene.add(buildFurniture(world));
      liveLayer = createLiveLayer(world);
      scene.add(liveLayer.group);

      // ── V2: puertas animadas + avatares remotos ───────────────────────────
      doors = createDoors(world);
      scene.add(doors.group);
      remoteAvatars = createRemoteAvatars();
      scene.add(remoteAvatars.group);

      // ── Colisión + controles ──────────────────────────────────────────────
      const collision = createCollisionSystem(world);
      desktop = !touch ? createDesktopControls(camera, domEl) : null;
      touchCtl = touch && touchLayerRef.current ? createTouchControls(camera, touchLayerRef.current) : null;
      if (desktop) {
        const d = desktop;
        d.onLockChange((l) => {
          setIsLocked(l);
          if (l) {
            setHasEntered(true);
            setLockNote(null); // entró bien → limpia cualquier aviso de error
          }
        });
        d.onLockError(() => setLockNote("No se pudo entrar. Haz clic de nuevo."));
        lockRef.current = () => d.lock();
      }

      // ── V2: mano FPS (solo desktop) ────────────────────────────────────────
      if (!touch) {
        hand = createHand(camera);
        camera.add(hand.group);
      }

      // ── V2: interacción (raycast → expediente del paciente) ───────────────
      interaction = createInteraction({
        camera,
        getInteractables: () => (liveLayer as any)?.getInteractables?.() ?? [],
      });

      // ── Estado vivo: polling (chairs) + bootstrap multijugador ────────────
      const chairStatus = new Map<string, Chair3DState>();
      const applyStates = (chairs: Chair3DState[]) => {
        chairStatus.clear();
        for (const c of chairs) chairStatus.set(c.resourceId, c);
        liveLayer?.update(chairStatus);
        let occ = 0;
        for (const a of world.chairs) if (chairStatus.get(a.resourceId)?.status === "ocupado") occ++;
        setCounts({ occupied: occ, free: world.chairs.length - occ, total: world.chairs.length });
      };

      let mpStarted = false;
      const startMultiplayer = (payload: Clinic3DStatePayload) => {
        if (mpStarted || disposed) return;
        const channelName = payload.presenceChannel;
        if (!channelName) return; // sin canal → sin multijugador (aviso en HUD)
        mpStarted = true;
        const myName = payload.viewer?.name || "Tú";
        multiplayer = createMultiplayer({
          channelName,
          me: { name: myName, color: colorFromName(myName) },
          onPlayers: (players: RemotePlayerState[]) => {
            latestPlayers = players;
            remoteAvatars?.sync(players);
            if (!disposed) setUserCount(players.length + 1);
          },
        });
        if (!disposed) setMpEnabled(multiplayer.enabled);
      };

      let latestPlayers: RemotePlayerState[] = [];
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
          if (!disposed) startMultiplayer(data);
          pollFails = 0;
        } catch {
          if (!disposed) pollFails++;
        } finally {
          scheduleNextPoll();
        }
      };
      poll();

      // ── Input: el clic ENTRA/REANUDA si no hay lock; solo con lock interactúa ─
      // Orden sin pelea (patrón pointer-lock): primer clic captura el puntero;
      // los siguientes (ya con lock) hacen el raycast de interacción. Así clicar
      // en cualquier parte del lienzo reanuda tras ESC, no solo el botón del HUD.
      onCanvasDown = () => {
        if (!desktop) return;
        if (!document.pointerLockElement) {
          desktop.lock();
          return;
        }
        if (interaction) {
          interaction.interactCenter();
          hand?.tap();
        }
      };
      domEl.addEventListener("mousedown", onCanvasDown);
      // Tap móvil → interacción en el punto tocado (detección simple de tap).
      let tStartX = 0, tStartY = 0, tStartT = 0;
      onTouchStart = (e: TouchEvent) => {
        const t = e.changedTouches[0];
        if (!t) return;
        tStartX = t.clientX; tStartY = t.clientY; tStartT = e.timeStamp;
      };
      onTouchEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0];
        if (!t || !interaction || !domEl) return;
        const moved = Math.hypot(t.clientX - tStartX, t.clientY - tStartY);
        if (moved > 14 || e.timeStamp - tStartT > 400) return; // fue drag, no tap
        const r = domEl.getBoundingClientRect();
        const ndcX = ((t.clientX - r.left) / r.width) * 2 - 1;
        const ndcY = -(((t.clientY - r.top) / r.height) * 2 - 1);
        interaction.interactAt(ndcX, ndcY);
      };
      if (touch) {
        container.addEventListener("touchstart", onTouchStart, { passive: true });
        container.addEventListener("touchend", onTouchEnd, { passive: true });
      }

      // ── Toggle minimapa con M ──────────────────────────────────────────────
      onKeyM = (e: KeyboardEvent) => {
        if (e.code === "KeyM") setMinimapVisible((v) => !v);
      };
      window.addEventListener("keydown", onKeyM);

      // ── Render loop ────────────────────────────────────────────────────────
      const r = renderer;
      const sc = scene;
      const clock = new THREE.Clock();
      const lastPos = camera.position.clone();
      let sendAccum = 0;
      let lastSent = { x: NaN, z: NaN, yaw: NaN };
      let lastTargeting = false;
      let lastLabel: string | null = null;

      const loop = () => {
        if (disposed || !running) {
          raf = 0;
          return;
        }
        const dt = Math.min(clock.getDelta(), 0.05);
        desktop?.update(dt, collision);
        touchCtl?.update(dt, collision);

        // velocidad real para bobbing de la mano
        const moved = camera.position.distanceTo(lastPos);
        const speed = dt > 0 ? moved / dt : 0;
        const moving = speed > 0.15;
        lastPos.copy(camera.position);

        hand?.update(dt, { moving, speed });
        doors?.update(camera.position.x, camera.position.z, dt);
        remoteAvatars?.update(dt);

        // interacción: highlight + tooltip/crosshair (refleja al HUD solo si cambia)
        interaction?.update();
        if (interaction) {
          const tg = interaction.isTargeting();
          const lb = interaction.getTooltip();
          if (tg !== lastTargeting) { lastTargeting = tg; setTargeting(tg); }
          if (lb !== lastLabel) { lastLabel = lb; setInteractLabel(lb); }
        }

        // multijugador: enviar mi posición a ≤10 Hz y solo si cambió
        sendAccum += dt;
        if (multiplayer?.enabled && sendAccum >= 1 / POS_HZ) {
          sendAccum = 0;
          const yaw = camera.rotation.y;
          const dx = Math.abs(camera.position.x - lastSent.x);
          const dz = Math.abs(camera.position.z - lastSent.z);
          const dyaw = Math.abs(yaw - lastSent.yaw);
          if (!(dx < POS_MIN_MOVE && dz < POS_MIN_MOVE && dyaw < POS_MIN_YAW)) {
            multiplayer.sendPos(camera.position.x, camera.position.z, yaw);
            lastSent = { x: camera.position.x, z: camera.position.z, yaw };
          }
        }

        // frame del minimapa (lo dibuja el HUD en su propio rAF)
        minimapFrameRef.current = {
          px: camera.position.x,
          pz: camera.position.z,
          yaw: camera.rotation.y,
          players: latestPlayers.map((p) => ({ x: p.x, z: p.z, color: p.color })),
          chairs: world.chairs.map((a) => ({
            x: a.center.x,
            z: a.center.z,
            status: chairStatus.get(a.resourceId)?.status ?? "libre",
          })),
        };

        r.render(sc, camera);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      // ── Pausa con pestaña oculta ───────────────────────────────────────────
      onVisibility = () => {
        const visible = document.visibilityState === "visible";
        if (visible === running) return;
        running = visible;
        if (running) {
          clock.getDelta();
          if (raf === 0) raf = requestAnimationFrame(loop);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

      // ── Context loss ───────────────────────────────────────────────────────
      onContextLost = (e: Event) => e.preventDefault();
      onContextRestored = () => {
        if (!disposed && running) r.render(sc, camera);
      };
      domEl.addEventListener("webglcontextlost", onContextLost);
      domEl.addEventListener("webglcontextrestored", onContextRestored);

      // ── Resize ─────────────────────────────────────────────────────────────
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

      // ── Fullscreen ─────────────────────────────────────────────────────────
      onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", onFsChange);
      fullscreenRef.current = () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else container.requestFullscreen?.();
      };

      setLoadProgress(1);
      setErrorMsg(undefined);
      setPhase("ready");
    } catch (err) {
      console.error("[Clinic3DClient] init failed", err);
      disposed = true;
      setErrorMsg(err instanceof Error ? err.message : undefined);
      setPhase("error");
    }

    // ── Dispose EXHAUSTIVO ──────────────────────────────────────────────────
    return () => {
      disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (pollTimer) window.clearTimeout(pollTimer);
      ac?.abort();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (onFsChange) document.removeEventListener("fullscreenchange", onFsChange);
      if (onResize) window.removeEventListener("resize", onResize);
      if (onKeyM) window.removeEventListener("keydown", onKeyM);
      if (domEl && onCanvasDown) domEl.removeEventListener("mousedown", onCanvasDown);
      if (onTouchStart) container.removeEventListener("touchstart", onTouchStart);
      if (onTouchEnd) container.removeEventListener("touchend", onTouchEnd);
      if (domEl && onContextLost) domEl.removeEventListener("webglcontextlost", onContextLost);
      if (domEl && onContextRestored) domEl.removeEventListener("webglcontextrestored", onContextRestored);
      ro?.disconnect();
      multiplayer?.dispose();
      remoteAvatars?.dispose();
      hand?.dispose();
      interaction?.dispose();
      doors?.dispose();
      desktop?.dispose();
      touchCtl?.dispose();
      liveLayer?.dispose();
      scene?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        const disposeMat = (x: THREE.Material | undefined) => {
          if (!x) return;
          const mm = x as THREE.MeshStandardMaterial & Record<string, unknown>;
          if (o.userData?.sharedMap !== true) {
            mm.map?.dispose?.();
            (mm.emissiveMap as THREE.Texture | undefined)?.dispose?.();
            (mm.normalMap as THREE.Texture | undefined)?.dispose?.();
            (mm.roughnessMap as THREE.Texture | undefined)?.dispose?.();
            (mm.metalnessMap as THREE.Texture | undefined)?.dispose?.();
            (mm.aoMap as THREE.Texture | undefined)?.dispose?.();
            (mm.alphaMap as THREE.Texture | undefined)?.dispose?.();
          }
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
        lockTitle={hasEntered ? "Haz clic para continuar" : "Haz clic para entrar"}
        lockNote={lockNote}
        world={world}
        userCount={userCount}
        multiplayerEnabled={mpEnabled}
        interactLabel={interactLabel}
        targeting={targeting}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible((v) => !v)}
        minimapFrameRef={minimapFrameRef}
      />
    </div>
  );
}
