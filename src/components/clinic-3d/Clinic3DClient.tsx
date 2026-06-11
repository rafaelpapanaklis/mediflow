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
  agendaNewApptUrl,
  type Chair3DState,
  type Clinic3DStatePayload,
  type WaitingPatient,
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
import { createWaitingLayer } from "./waiting-layer";
import { createProgressBars } from "./progress-bars";
import { createDroneMode } from "./drone-controls";
import { createVrMode } from "./vr-setup";
import { Clinic3DHud, type Hud3DPhase } from "./Clinic3DHud";
import { adaptPublicLiveChairs } from "./public-live-adapter";

/** Opciones del MODO PÚBLICO (vista de pacientes en /live/[slug]/3d). */
export interface Clinic3DPublicMode {
  /** slug público: el visor pollea /api/live/[slug] y enlaza "Ver plano 2D". */
  slug: string;
}

export interface Clinic3DClientProps {
  clinic: { id: string; name: string; category: string };
  initialElements: LayoutElement[];
  initialMetadata: LayoutMetadata | null;
  initialChairs: { id: string; name: string; color: string | null }[];
  /**
   * Si está presente, el visor corre en MODO PÚBLICO: consume el endpoint
   * público /api/live/[slug] (datos YA enmascarados server-side), SIN
   * multijugador (canal privado del dashboard) y SIN interacción con datos
   * (cero expedientes, cero agendar). Ausente/null = modo dashboard normal.
   */
  publicMode?: Clinic3DPublicMode | null;
}

const STATE_API = "/api/clinic-layout/3d-state";

export function Clinic3DClient({
  clinic,
  initialElements,
  initialMetadata,
  initialChairs,
  publicMode = null,
}: Clinic3DClientProps) {
  // Primitivas estables del modo público (publicMode se fija al montar y no
  // cambia; el efecto solo depende de `world`).
  const isPublic = !!publicMode;
  const publicSlug = publicMode?.slug ?? "";

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
  // V3 — sala de espera viva
  const [waitingCount, setWaitingCount] = useState(0);
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
  // V3 — MODOS: dron (vista aérea orbital) + VR (WebXR).
  const [droneActive, setDroneActive] = useState(false);
  const [vrSupported, setVrSupported] = useState(false);
  const [inVr, setInVr] = useState(false);

  // Frame del minimapa: el loop lo escribe, el HUD lo lee en su propio rAF.
  const minimapFrameRef = useRef<MinimapFrame>({ px: 0, pz: 0, yaw: 0, players: [], chairs: [] });

  // Ref-bridges para acciones imperativas desde el HUD.
  const lockRef = useRef<() => void>(() => {});
  const fullscreenRef = useRef<() => void>(() => {});
  const reloadRef = useRef<() => void>(() => {});
  const toggleDroneRef = useRef<() => void>(() => {});
  const enterVrRef = useRef<() => void>(() => {});

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
    let waitingLayer: ReturnType<typeof createWaitingLayer> | null = null;
    let progressBars: ReturnType<typeof createProgressBars> | null = null;
    let desktop: ReturnType<typeof createDesktopControls> | null = null;
    let touchCtl: ReturnType<typeof createTouchControls> | null = null;
    let multiplayer: ReturnType<typeof createMultiplayer> | null = null;
    let remoteAvatars: ReturnType<typeof createRemoteAvatars> | null = null;
    let hand: ReturnType<typeof createHand> | null = null;
    let interaction: ReturnType<typeof createInteraction> | null = null;
    let doors: ReturnType<typeof createDoors> | null = null;
    let drone: ReturnType<typeof createDroneMode> | null = null;
    let vr: ReturnType<typeof createVrMode> | null = null;
    let ac: AbortController | null = null;
    let pollTimer = 0;
    let onVisibility: (() => void) | null = null;
    let onResize: (() => void) | null = null;
    let onFsChange: (() => void) | null = null;
    let onContextLost: ((e: Event) => void) | null = null;
    let onContextRestored: (() => void) | null = null;
    let onKeyM: ((e: KeyboardEvent) => void) | null = null;
    let onKeyV: ((e: KeyboardEvent) => void) | null = null;
    let onCanvasDown: ((e: MouseEvent) => void) | null = null;
    let onDroneDown: ((e: MouseEvent) => void) | null = null;
    let onDroneUp: ((e: MouseEvent) => void) | null = null;
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
      // V3 — la cámara cuelga de un "playerRig". Fuera de XR el rig queda en
      // identidad (FPS/dron escriben camera.position como coordenadas de mundo);
      // dentro de VR el rig hace la locomoción (teleport/snap-turn) y el headset
      // mueve la cámara dentro de él. La mano FPS sigue colgando de la cámara.
      const playerRig = new THREE.Group();
      playerRig.name = "playerRig";
      playerRig.add(camera);
      scene.add(playerRig);

      renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.xr.enabled = true; // habilita WebXR (inocuo fuera de sesión VR)
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
      // V3 — sala de espera viva (avatares sentados + walkers) y barras de progreso.
      waitingLayer = createWaitingLayer(world);
      scene.add(waitingLayer.group);
      progressBars = createProgressBars(world);
      scene.add(progressBars.group);

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
      // En MODO PÚBLICO NO se cablea: cero raycast a avatares, cero expedientes,
      // cero agendar (el adapter público nunca trae patientId y los sillones
      // vacíos no deben abrir la agenda para un visitante). Defensa en profundidad.
      // En dashboard: interacción completa (ocupado→expediente, vacío→agendar).
      interaction = isPublic
        ? null
        : createInteraction({
            camera,
            getInteractables: () => (liveLayer as any)?.getInteractables?.() ?? [],
            // V3 — sillones VACÍOS como targets de agendar; click → agenda en pestaña nueva.
            getScheduleTargets: () => (liveLayer as any)?.getScheduleTargets?.() ?? [],
            onSchedule: (resourceId: string) => {
              window.open(agendaNewApptUrl(resourceId), "_blank", "noopener");
            },
          });

      // ── V3: MODOS — dron (vista aérea orbital) + VR (WebXR) ────────────────
      // Estado de modo: fuente de verdad para los handlers; el loop consulta a los
      // propios sistemas (drone.controlsCamera() / vr.isPresenting()).
      let mode: "fps" | "drone" = "fps";
      drone = createDroneMode({ camera, domElement: domEl, world });
      drone.onExitComplete(() => {
        // De vuelta a FPS: reactiva el look y re-pide el lock (mejor esfuerzo; si
        // el navegador lo rechaza, reaparece el overlay "Haz clic para continuar").
        if (desktop) {
          desktop.controls.enabled = true;
          desktop.lock();
        }
      });

      vr = createVrMode({ renderer, scene, camera, playerRig, world, collision });
      vr.onSessionChange((presenting) => {
        if (disposed) return;
        setInVr(presenting);
        if (presenting) {
          hand?.setVisible(false); // los controllers sustituyen a la mano FPS
        } else {
          // Al salir de VR: restaura mano/HUD y vuelve a FPS limpio.
          hand?.setVisible(true);
          mode = "fps";
          setDroneActive(false);
        }
      });
      vr.supported().then((ok) => {
        if (!disposed) setVrSupported(ok);
      });

      const enterDrone = () => {
        if (!drone || mode !== "fps" || vr?.isPresenting()) return;
        mode = "drone";
        setDroneActive(true);
        if (desktop) desktop.controls.enabled = false; // congela el look FPS
        if (document.pointerLockElement) document.exitPointerLock?.();
        hand?.setVisible(false);
        drone.enter();
      };
      const exitDrone = () => {
        if (!drone || mode !== "drone") return;
        mode = "fps";
        setDroneActive(false);
        hand?.setVisible(true);
        drone.exit(); // onExitComplete re-habilita FPS + relock al terminar
      };
      const toggleDrone = () => (mode === "drone" ? exitDrone() : enterDrone());
      toggleDroneRef.current = toggleDrone;
      enterVrRef.current = () => {
        if (!vr) return;
        if (mode === "drone") exitDrone(); // VR siempre se entra desde FPS
        vr.enter().catch(() => {});
      };

      // Tecla V → alterna dron (ignorada dentro de VR).
      onKeyV = (e: KeyboardEvent) => {
        if (e.code === "KeyV" && !vr?.isPresenting()) toggleDrone();
      };
      window.addEventListener("keydown", onKeyV);

      // Clic-interacción en DRON con el CURSOR (no el centro): clic limpio (sin
      // arrastre) → abre expediente; arrastrar = orbitar (lo maneja OrbitControls).
      let dDownX = 0;
      let dDownY = 0;
      let dDownT = 0;
      onDroneDown = (e: MouseEvent) => {
        dDownX = e.clientX;
        dDownY = e.clientY;
        dDownT = e.timeStamp;
      };
      onDroneUp = (e: MouseEvent) => {
        if (mode !== "drone" || !interaction || !domEl) return;
        const moved = Math.hypot(e.clientX - dDownX, e.clientY - dDownY);
        if (moved > 6 || e.timeStamp - dDownT > 400) return; // fue orbitar, no clic
        const rect = domEl.getBoundingClientRect();
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        interaction.interactAt(ndcX, ndcY);
      };
      domEl.addEventListener("mousedown", onDroneDown);
      domEl.addEventListener("mouseup", onDroneUp);

      // ── Estado vivo: polling (chairs) + bootstrap multijugador ────────────
      const chairStatus = new Map<string, Chair3DState>();
      const applyStates = (chairs: Chair3DState[]) => {
        chairStatus.clear();
        for (const c of chairs) chairStatus.set(c.resourceId, c);
        liveLayer?.update(chairStatus);
        progressBars?.setStates(chairStatus);
        let occ = 0;
        for (const a of world.chairs) if (chairStatus.get(a.resourceId)?.status === "ocupado") occ++;
        setCounts({ occupied: occ, free: world.chairs.length - occ, total: world.chairs.length });
        vr?.setCounts(occ, world.chairs.length - occ); // panel de muñeca en VR
      };

      // V3 — sala de espera: aplica el set de pacientes en espera (CHECKED_IN) y
      // detecta llamados. chairStatus ya está fresco (applyStates corre antes).
      const applyWaiting = (waiting: WaitingPatient[]) => {
        const list = Array.isArray(waiting) ? waiting : [];
        waitingLayer?.setWaiting(list, chairStatus);
        if (!disposed) setWaitingCount(list.length);
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
      // Intervalo base: en público igualamos el de la vista 2D (30s); en
      // dashboard, POLL_MS (20s). Backoff exponencial ante fallos en ambos.
      const pollBase = isPublic ? 30_000 : POLL_MS;
      const scheduleNextPoll = () => {
        if (disposed) return;
        const backoff = Math.min(pollBase * 2 ** Math.min(pollFails, 4), 300_000);
        pollTimer = window.setTimeout(poll, backoff);
      };
      const poll = async () => {
        try {
          ac?.abort();
          ac = new AbortController();
          // Público: MISMO endpoint que la vista 2D (datos ya enmascarados);
          // dashboard: estado privado por sesión.
          const url = isPublic
            ? `/api/live/${publicSlug}?date=${new Date().toISOString().slice(0, 10)}`
            : STATE_API;
          const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
          // 401 público = cookie de desbloqueo vencida a mitad del recorrido
          // (TTL 12h, solo con clínica protegida). Recargamos → gate del server.
          if (res.status === 401 && isPublic) {
            if (!disposed) window.location.reload();
            return;
          }
          if (!res.ok) {
            pollFails++;
            return;
          }
          const raw = await res.json();
          // Público: adaptamos el payload 2D → Chair3DState[] (sin patientId).
          const chairs = isPublic
            ? adaptPublicLiveChairs(raw)
            : (raw as Clinic3DStatePayload).chairs;
          if (!disposed && Array.isArray(chairs)) applyStates(chairs);
          // V3 — sala de espera viva: SOLO en dashboard (el payload privado trae
          // waiting[] con nombres; el endpoint público no lo expone en esta forma).
          if (!disposed && !isPublic) applyWaiting((raw as Clinic3DStatePayload).waiting ?? []);
          // Multijugador SOLO en el dashboard (canal privado de la clínica).
          // En público, jamás presencia ni broadcast.
          if (!disposed && !isPublic) startMultiplayer(raw as Clinic3DStatePayload);
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
        if (mode === "drone" || (vr && vr.isPresenting())) return; // dron/VR: el clic NO bloquea
        if (!document.pointerLockElement) {
          desktop.lock();
          return;
        }
        // Público: ya con lock, el clic SOLO controla la cámara. Cero
        // interacción con datos — ni expediente ni agendar, ni nada que añadan
        // otras capas (el return corta antes de cualquier interacción).
        if (isPublic) {
          hand?.tap();
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
        // Público: sin interacción táctil con datos (el joystick lo maneja
        // touch-controls aparte; esto es solo el tap→interactuar).
        if (isPublic) return;
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

      // ── Render loop — setAnimationLoop (requisito XR; fuera de XR = rAF normal) ─
      const r = renderer;
      const sc = scene;
      const clock = new THREE.Clock();
      // Pose del jugador en MUNDO: válida en FPS, dron y VR (el rig + el headset
      // ya están aplicados a la matriz mundial de la cámara).
      const playerWorld = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");
      const lastPos = camera.position.clone();
      let sendAccum = 0;
      let lastSent = { x: NaN, z: NaN, yaw: NaN };
      let lastTargeting = false;
      let lastLabel: string | null = null;

      const loop = (_time: number, frame: unknown) => {
        if (disposed) {
          r.setAnimationLoop(null);
          return;
        }
        const dt = Math.min(clock.getDelta(), 0.05);
        const presenting = r.xr.isPresenting;
        const droneOn = !!drone && drone.controlsCamera();
        const fps = !presenting && !droneOn;

        // Controles del frame según el modo activo. TODO tick (incl. los que otras
        // terminales añadan a la capa viva) DEBE vivir dentro de este loop único.
        if (presenting) vr?.update(dt, frame);
        else if (droneOn) drone?.update(dt);
        else {
          desktop?.update(dt, collision);
          touchCtl?.update(dt, collision);
        }

        // Pose REAL del jugador en MUNDO (getWorldPosition resuelve rig + headset).
        camera.getWorldPosition(playerWorld);
        tmpEuler.setFromQuaternion(camera.getWorldQuaternion(tmpQuat), "YXZ");
        const worldYaw = tmpEuler.y;

        // velocidad real para el bobbing de la mano (solo relevante en FPS)
        const moved = playerWorld.distanceTo(lastPos);
        const speed = dt > 0 ? moved / dt : 0;
        lastPos.copy(playerWorld);
        hand?.update(dt, { moving: fps && speed > 0.15, speed: fps ? speed : 0 });

        // capa viva: puertas + avatares remotos + sala de espera viva + barras de
        // progreso (siguen vivos en dron y VR; reloj real para start/end de la cita).
        doors?.update(playerWorld.x, playerWorld.z, dt);
        remoteAvatars?.update(dt);
        waitingLayer?.update(dt);
        progressBars?.update(Date.now(), camera);

        // interacción central (crosshair) SOLO en FPS; en dron el clic-cursor la
        // dispara aparte y en VR no hay crosshair DOM. Limpia el estado al salir.
        if (fps) {
          interaction?.update();
          if (interaction) {
            const tg = interaction.isTargeting();
            const lb = interaction.getTooltip();
            if (tg !== lastTargeting) { lastTargeting = tg; setTargeting(tg); }
            if (lb !== lastLabel) { lastLabel = lb; setInteractLabel(lb); }
          }
        } else if (lastTargeting || lastLabel) {
          lastTargeting = false; setTargeting(false);
          lastLabel = null; setInteractLabel(null);
        }

        // multijugador: mi pose en MUNDO a ≤10 Hz y solo si cambió (transmite
        // también la cámara XR → los demás te ven moverte dentro de VR).
        sendAccum += dt;
        if (multiplayer?.enabled && sendAccum >= 1 / POS_HZ) {
          sendAccum = 0;
          const dx = Math.abs(playerWorld.x - lastSent.x);
          const dz = Math.abs(playerWorld.z - lastSent.z);
          const dyaw = Math.abs(worldYaw - lastSent.yaw);
          if (!(dx < POS_MIN_MOVE && dz < POS_MIN_MOVE && dyaw < POS_MIN_YAW)) {
            multiplayer.sendPos(playerWorld.x, playerWorld.z, worldYaw);
            lastSent = { x: playerWorld.x, z: playerWorld.z, yaw: worldYaw };
          }
        }

        // frame del minimapa (lo dibuja el HUD en su propio rAF)
        minimapFrameRef.current = {
          px: playerWorld.x,
          pz: playerWorld.z,
          yaw: worldYaw,
          players: latestPlayers.map((p) => ({ x: p.x, z: p.z, color: p.color })),
          chairs: world.chairs.map((a) => ({
            x: a.center.x,
            z: a.center.z,
            status: chairStatus.get(a.resourceId)?.status ?? "libre",
          })),
        };

        r.render(sc, camera);
      };
      r.setAnimationLoop(loop);

      // ── Pausa con pestaña oculta — SOLO fuera de XR (en sesión XR jamás pausa) ─
      onVisibility = () => {
        if (r.xr.isPresenting) return; // dentro de una sesión XR nunca se pausa
        const visible = document.visibilityState === "visible";
        if (visible) {
          clock.getDelta(); // descarta el salto de dt acumulado mientras oculta
          r.setAnimationLoop(loop);
        } else {
          r.setAnimationLoop(null);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

      // ── Context loss ───────────────────────────────────────────────────────
      onContextLost = (e: Event) => e.preventDefault();
      onContextRestored = () => {
        if (!disposed) r.render(sc, camera);
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
      renderer?.setAnimationLoop(null); // detiene el loop (XR o rAF)
      if (pollTimer) window.clearTimeout(pollTimer);
      ac?.abort();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (onFsChange) document.removeEventListener("fullscreenchange", onFsChange);
      if (onResize) window.removeEventListener("resize", onResize);
      if (onKeyM) window.removeEventListener("keydown", onKeyM);
      if (onKeyV) window.removeEventListener("keydown", onKeyV);
      if (domEl && onCanvasDown) domEl.removeEventListener("mousedown", onCanvasDown);
      if (domEl && onDroneDown) domEl.removeEventListener("mousedown", onDroneDown);
      if (domEl && onDroneUp) domEl.removeEventListener("mouseup", onDroneUp);
      if (onTouchStart) container.removeEventListener("touchstart", onTouchStart);
      if (onTouchEnd) container.removeEventListener("touchend", onTouchEnd);
      if (domEl && onContextLost) domEl.removeEventListener("webglcontextlost", onContextLost);
      if (domEl && onContextRestored) domEl.removeEventListener("webglcontextrestored", onContextRestored);
      ro?.disconnect();
      vr?.dispose();    // termina la sesión XR (si la hay) y restaura sombras/listeners
      drone?.dispose();
      multiplayer?.dispose();
      remoteAvatars?.dispose();
      hand?.dispose();
      interaction?.dispose();
      doors?.dispose();
      desktop?.dispose();
      touchCtl?.dispose();
      liveLayer?.dispose();
      waitingLayer?.dispose();
      progressBars?.dispose();
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
        // En dron, el overlay deja pasar los gestos al canvas (OrbitControls táctil);
        // en FPS móvil captura para el joystick/mirar de touch-controls.
        style={{ touchAction: "none", pointerEvents: isTouch && !droneActive ? "auto" : "none" }}
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
        waitingCount={waitingCount}
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
        publicMode={isPublic ? { backHref: `/live/${publicSlug}` } : null}
        droneActive={droneActive}
        onToggleDrone={() => toggleDroneRef.current()}
        vrSupported={vrSupported}
        inVr={inVr}
        onEnterVr={() => enterVrRef.current()}
      />
    </div>
  );
}
