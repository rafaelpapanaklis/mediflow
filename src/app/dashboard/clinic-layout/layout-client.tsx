"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
  ChevronDown,
  Lock,
  Monitor,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Hand,
  MousePointer2,
  ExternalLink,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Moon,
} from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { toScreen, fromScreen, isoViewBox, C as ISO_C } from "@/lib/floor-plan/iso";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import { OPENABLE_TYPES } from "@/lib/floor-plan/element-types";
import { sanitizeElements, sanitizeMetadata } from "@/lib/floor-plan/sanitize";
import type {
  ChairStatus,
  ElementType,
  LayoutElement,
  LayoutMetadata,
  LiveAppointment,
  Rotation,
} from "@/lib/floor-plan/elements";
import {
  LiveOverlay,
  LiveTooltip,
  LiveClock,
  LiveStatusPanel,
  LiveTimeline,
  type HoverData,
} from "./components/live-mode";
import { ChairCard, type ChairCardData } from "./components/chair-card";
/* Las palabras de los tres estados. Viven fuera de la capa compartida —que
   no conoce ni una palabra del negocio— y las lee también el televisor de
   /live/[slug], para que los dos digan lo mismo. */
import { COUNT_KEY, DETAIL_KEY, ESTADOS, LABEL_KEY } from "./components/floor-copy";
/* Los tokens `--mc-*` del piso, y su traduccion a los `--fp-*` que lee la
   capa compartida. Viven en su propia hoja porque el televisor de
   /live/[slug] pinta el MISMO piso y necesita los mismos colores; ver la
   cabecera de floor-tokens.module.css. */
import mc from "./components/floor-tokens.module.css";
import {
  ANCHO_MIN_3D,
  LiveWorld,
  hayWebGL,
  useMundoEstable,
  type Clinic3DPick,
} from "./components/live-world";
import { SharePanel } from "./components/share-panel";
import { WaitingRoom, type WaitingRoomEntry } from "./components/waiting-room";
import { WelcomePrompt } from "./components/welcome-prompt";
import { OptimizerModal } from "./components/optimizer-modal";
import { Share2, Box, Map as MapIcon } from "lucide-react";
import {
  fmtHM,
  getChairAppointment,
  getChairStatus,
  getNextChairAppointment,
} from "@/lib/floor-plan/live-mode";
import { useT } from "@/i18n/i18n-provider";
// ── La capa visual COMPARTIDA (src/components/floor-plan) ──────────────
// El dibujo del piso, la paleta y los contadores son los mismos que usa el
// vertical institucional en /instituto/clinica. Vive fuera de los dos
// productos a propósito: dos cáscaras que se parecen se separan en el
// primer arreglo. Lo que NO se comparte es el comportamiento —el arrastre,
// el autoguardado, el optimizador y el modo En Vivo siguen aquí— ni una
// sola palabra: los textos entran por props, resueltos con el t() del
// panel.
import { IsoElement, IsoGhost, IsoTiles } from "@/components/floor-plan/iso-canvas";
import {
  FloorCounters,
  FloorLegend,
  FloorPalette,
  FloorPaletteItem,
  FloorPanelHelp,
  FloorPanelTitle,
  type FloorCountItem,
  type FloorLegendItem,
} from "@/components/floor-plan/floor-chrome";
import { FloorShadows, FloorSlab } from "@/components/floor-plan/floor-ground";
import styles from "./clinic-layout.module.css";

interface Chair {
  id: string;
  name: string;
  color: string | null;
  orderIndex: number;
}

interface Clinic {
  id: string;
  name: string;
  category: string;
  liveModeSlug: string | null;
  liveModeEnabled: boolean;
  liveModeShowPatientNames: boolean;
}

interface Props {
  clinic: Clinic;
  initialElements: LayoutElement[];
  initialMetadata: LayoutMetadata | null;
  chairs: Chair[];
}

/** Origen del grid en pantalla (ajustado por panOffset). */
const ORIG_X = 680;
const ORIG_Y = 260;
const GRID_COLS = 32;
const GRID_ROWS = 24;
/** El recorte del SVG, calculado para que el piso entero quepa (isoViewBox). */
const VIEW_BOX = isoViewBox(GRID_COLS, GRID_ROWS, ORIG_X, ORIG_Y);
const HISTORY_LIMIT = 24;
const AUTOSAVE_DELAY_MS = 1500;

/**
 * EL PISO DE "EN VIVO" ES EL MUNDO 3D.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL MODO EDICIÓN SIGUE EN 2D, Y NO SE DISCUTE. Arrastrar un mueble
 * a una casilla se hace en el plano isométrico, como siempre: colocar es
 * una tarea de rejilla y en perspectiva se pierde exactamente la precisión
 * que hace falta. Lo que cambia aquí es SOLO el piso de En Vivo, que no es
 * una herramienta sino un tablero — "¿qué sillón está libre y dónde".
 *
 * El motor es el compartido (`src/components/clinic-3d/`), montado con
 * `host` desde components/live-world.tsx: vista aérea, sin caminar, sin
 * mira y sin VR. El recorrido a pie sigue estando donde estaba, en
 * /dashboard/clinic-layout/3d, y esa página no se toca.
 */
const LEYENDA_3D_PANEL = [
  "Clic en un sillón para ver quién está dentro",
  "Arrastra para girar el piso · rueda para acercarte",
];

/** Cuánto puede alejarse la línea de tiempo de "ahora" antes de avisar. */
const VIAJE_MS = 90_000;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export function ClinicLayoutClient({
  clinic,
  initialElements,
  initialMetadata,
  chairs,
}: Props) {
  const t = useT();
  const askConfirm = useConfirm();
  const catalog = useMemo(() => getCatalogForClinic(clinic.category), [clinic.category]);

  // Saneamos el JSON persistido ANTES de sembrar el estado. El layout pudo
  // guardarse con un schema viejo (elements no-array, entradas sin col/row);
  // sin esto el editor crashea igual que la vista pública /live/[slug].
  const safeInitialElements = useMemo(() => sanitizeElements(initialElements), [initialElements]);
  const safeInitialMetadata = useMemo(() => sanitizeMetadata(initialMetadata), [initialMetadata]);

  const [elements, setElements] = useState<LayoutElement[]>(safeInitialElements);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<LayoutElement[][]>([safeInitialElements]);
  const [zoom, setZoom] = useState(safeInitialMetadata.zoom ?? 1);
  const [panOffset, setPanOffset] = useState(
    safeInitialMetadata.panOffset ?? { x: 0, y: 0 },
  );
  const [panMode, setPanMode] = useState(false);
  const [dragType, setDragType] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ col: number; row: number } | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedAgo, setSavedAgo] = useState<string>("");

  // Modo En Vivo
  const [liveMode, setLiveMode] = useState(false);
  const [viewTime, setViewTime] = useState<Date>(() => new Date());
  const [appointments, setAppointments] = useState<LiveAppointment[]>([]);
  const [waitingRoom, setWaitingRoom] = useState<WaitingRoomEntry[]>([]);
  const [hover, setHover] = useState<HoverData | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  /**
   * Sillón abierto en la tarjeta flotante (solo modo En Vivo). Se guarda el
   * `resourceId` y NO el elemento del layout: la tarjeta habla de la
   * unidad de la agenda, y así sobrevive a que el plano se reordene.
   */
  const [pickedChairId, setPickedChairId] = useState<string | null>(null);

  // ── El piso de En Vivo: mundo 3D (por defecto) o el plano de siempre ──
  const PISO_STORAGE_KEY = `mf:layout-piso:${clinic.id}`;
  /** `null` = aún sin medir (primer render, servidor incluido). */
  const [puede3D, setPuede3D] = useState<boolean | null>(null);
  /** Lo que eligió esta persona a mano. Manda sobre la medición. */
  const [modoPiso, setModoPiso] = useState<"3d" | "2d" | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(PISO_STORAGE_KEY);
      if (v === "3d" || v === "2d") setModoPiso(v);
    } catch {/* localStorage bloqueado — manda la medición */}
  }, [PISO_STORAGE_KEY]);

  const elegirPiso = useCallback(
    (v: "3d" | "2d") => {
      setModoPiso(v);
      try {
        window.localStorage.setItem(PISO_STORAGE_KEY, v);
      } catch {/* quota / SecurityError — vale para esta sesión */}
    },
    [PISO_STORAGE_KEY],
  );

  // ¿Puede este equipo pintar el mundo? (WebGL + ancho). `hayWebGL()`
  // contesta una vez y suelta su contexto — ver la nota en live-world.tsx.
  useEffect(() => {
    const medir = () => setPuede3D(hayWebGL() && window.innerWidth >= ANCHO_MIN_3D);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  // v2: animaciones puerta/gabinete + iluminación dinámica
  /**
   * IDs de elementos (puertas/gabinetes) actualmente "abiertos". Click sobre
   * un OPENABLE_TYPE alterna su estado. No se persiste — es estado puramente
   * visual de la sesión, complemento al modo Edición.
   */
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  /** Hora del filtro de iluminación (0–23). Inicia en la hora real; el
   *  pill del topbar la avanza 3h en cada click para previsualizar. */
  const [lightingHour, setLightingHour] = useState<number>(() => new Date().getHours());
  /** Hover sobre un elemento del canvas (modo Edición) — produce un tooltip
   *  con el label del tipo. Se desactiva durante panMode y dragType. */
  const [elementHover, setElementHover] = useState<
    { id: number; cx: number; topY: number; label: string; isOpen: boolean } | null
  >(null);
  const [liveConfig, setLiveConfig] = useState({
    enabled: clinic.liveModeEnabled,
    slug: clinic.liveModeSlug,
    showPatientNames: clinic.liveModeShowPatientNames,
    hasPassword: false, // detectado al abrir share panel via PATCH response
  });
  const [welcomeDismissed, setWelcomeDismissed] = useState(safeInitialElements.length > 0);
  const [chairsState, setChairsState] = useState<Chair[]>(chairs);
  // En todo el render usamos `liveChairs` como source of truth (puede crecer
  // tras seed-demo o creación al drag). El prop original `chairs` queda
  // intacto para no perder referencias.
  const liveChairs = chairsState;

  const nextIdRef = useRef<number>(
    Math.max(0, ...safeInitialElements.map((e) => e.id)) + 1,
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const moveStartRef = useRef<{ id: number; col: number; row: number; mx: number; my: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // ── Drag local sin tocar `elements` hasta soltar ──
  // movingPosition refleja la posición instantánea del elemento siendo
  // movido. Durante el drag NO mutamos `elements` (eso disparaba 60 fps
  // de setElements + sort + autosave-effect → ghosting visual). El render
  // hace override solo del elemento siendo movido. Al onMouseUp se commitea.
  const [movingPosition, setMovingPosition] = useState<{ col: number; row: number } | null>(null);
  // RAF throttle: 1 update por frame de paint del browser, no 1 por evento.
  const rafIdRef = useRef<number | null>(null);
  const pendingMouseRef = useRef<{ x: number; y: number } | null>(null);
  // Flag para evitar múltiples drops async simultáneos.
  const dropInFlightRef = useRef<boolean>(false);

  /** Cancela TODO drag/move incluyendo el drag desde catálogo. Solo lo
   *  llamamos en Escape y al unmount — eventos terminales del usuario. */
  const cancelDrag = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingMouseRef.current = null;
    panStartRef.current = null;
    moveStartRef.current = null;
    setDragType(null);
    setDragGhost(null);
    setMovingId(null);
    setMovingPosition(null);
  }, []);

  /** Cancela SOLO move de elemento + pan en progreso. No toca dragType
   *  porque el drag desde catálogo está manejado en window listener y
   *  debe seguir vivo aunque el cursor salga del SVG. Llamado en
   *  onMouseLeave del SVG. */
  const cancelMoveOrPan = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingMouseRef.current = null;
    panStartRef.current = null;
    moveStartRef.current = null;
    setMovingId(null);
    setMovingPosition(null);
  }, []);

  const selectedElement = useMemo(
    () => elements.find((e) => e.id === selectedId) ?? null,
    [elements, selectedId],
  );
  const selectedType: ElementType | null = selectedElement
    ? catalog.byKey.get(selectedElement.type) ?? null
    : null;

  /** Push snapshot al historial (con cap a HISTORY_LIMIT). */
  const pushHistory = useCallback((snapshot: LayoutElement[]) => {
    setHistory((prev) => {
      const next = [...prev, snapshot];
      if (next.length > HISTORY_LIMIT) next.shift();
      return next;
    });
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("pending");
  }, []);

  /** Autosave debounced. */
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch("/api/clinic-layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            elements,
            metadata: {
              zoom,
              panOffset,
              lastEditAt: new Date().toISOString(),
              gridSize: { cols: GRID_COLS, rows: GRID_ROWS },
            },
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        dirtyRef.current = false;
        setSaveState("saved");
        setSavedAt(new Date());
      } catch {
        setSaveState("error");
        toast.error(t("pages.clinicLayout.saveError"));
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [elements, zoom, panOffset]);

  /** Indicador "guardado hace Xs". */
  useEffect(() => {
    if (!savedAt) {
      setSavedAgo("");
      return;
    }
    const update = () => {
      const sec = Math.max(0, Math.floor((Date.now() - savedAt.getTime()) / 1000));
      if (sec < 5) setSavedAgo(t("pages.clinicLayout.agoNow"));
      else if (sec < 60) setSavedAgo(t("pages.clinicLayout.agoSeconds", { count: sec }));
      else if (sec < 3600) setSavedAgo(t("pages.clinicLayout.agoMinutes", { count: Math.floor(sec / 60) }));
      else setSavedAgo(t("pages.clinicLayout.agoOverHour"));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [savedAt]);

  /* ─── Modo En Vivo: fetch appointments + auto-tick viewTime ─── */

  useEffect(() => {
    if (!liveMode) return;
    let cancelled = false;
    const fetchAppointments = async () => {
      try {
        // Sin `?date=`: el dia lo decide el servidor, en la zona de la
        // clinica. `viewTime.toISOString()` daba la fecha UTC — y ademas
        // ataba este sondeo al minutero (ver la dependencia del efecto).
        const res = await fetch("/api/clinic-layout/appointments");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const parsed: LiveAppointment[] = (data.appointments ?? []).map(
          (a: { id: string; resourceId: string; patient: string; patientFull?: string; patientId?: string; treatment: string; doctor: string; start: string; end: string; status?: string }) => ({
            id: a.id,
            resourceId: a.resourceId,
            patient: a.patient,
            patientFull: a.patientFull,
            patientId: a.patientId,
            treatment: a.treatment,
            doctor: a.doctor,
            start: new Date(a.start),
            end: new Date(a.end),
            status: a.status as LiveAppointment["status"],
          }),
        );
        setAppointments(parsed);
        setWaitingRoom((data.waitingRoom ?? []) as WaitingRoomEntry[]);
      } catch {/* silent */}
    };
    fetchAppointments();
    // Pausa polling cuando la pestaña no está visible (el editor en
    // background no necesita refetch de appointments).
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId === null) intervalId = setInterval(fetchAppointments, 30_000);
    };
    const stop = () => {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") { fetchAppointments(); start(); }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
    // 🔴 `viewTime` YA NO es dependencia, y esa era la mitad cara del
    // fallo. El minutero lo mueve cada 5 s, asi que este efecto se
    // desmontaba y volvia a montarse doce veces por minuto — con su
    // `fetchAppointments()` de entrada cada vez. Eran 12 consultas por
    // minuto contra las citas del dia en vez de 2. Ahora la URL no depende
    // de la hora que se este mirando (el dia lo decide el servidor), asi
    // que el sondeo late solo con su intervalo de 30 s.
  }, [liveMode]);

  // Auto-tick viewTime cada 5s si está cerca de "now" (no estamos viajando).
  useEffect(() => {
    if (!liveMode) return;
    const id = setInterval(() => {
      const now = new Date();
      if (Math.abs(now.getTime() - viewTime.getTime()) < 90_000) {
        setViewTime(now);
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [liveMode, viewTime]);

  // Al activar live, deselecciona y resetea viewTime a ahora.
  useEffect(() => {
    setPickedChairId(null);
    if (liveMode) {
      setSelectedId(null);
      setDragType(null);
      setPanMode(false);
      setViewTime(new Date());
      setElementHover(null);
    }
  }, [liveMode]);

  // Mantener `lightingHour` sincronizado con la hora real cada minuto, salvo
  // que el usuario haya avanzado manualmente vía pill (caso en que dejamos
  // su preview tal cual hasta que vuelva a la hora real con doble click —
  // por ahora un click adelanta 3h y eventualmente recorre las 24h).
  useEffect(() => {
    const id = setInterval(() => {
      setLightingHour((h) => {
        const real = new Date().getHours();
        // Si el usuario está en la hora real, mantenla actualizada;
        // si está previsualizando otra hora, no toques.
        return h === real || Math.abs(h - real) <= 1 ? real : h;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  /* ─── Acciones sobre elementos ─── */

  const addElement = useCallback(
    async (type: string, col: number, row: number) => {
      const td = catalog.byKey.get(type);
      if (!td) return;
      // Evita carreras: si una promesa de creación de Resource sigue en
      // vuelo, ignoramos drops nuevos (el usuario debe esperar). Sin esto
      // dos drops rápidos podían crear 2 Resources con el mismo nombre.
      if (dropInFlightRef.current) return;
      dropInFlightRef.current = true;

      const id = nextIdRef.current++;

      // Para sillones (isChair): si hay un Resource(CHAIR) existente sin
      // colocar en el layout, lo reusamos. Si no, creamos uno nuevo en la
      // agenda automáticamente — 1 source of truth.
      let resourceId: string | null = null;
      let chairName: string | null = null;
      if (td.isChair) {
        const placed = new Set(
          elements.filter((e) => e.resourceId).map((e) => e.resourceId!),
        );
        const free = liveChairs.find((c) => !placed.has(c.id));
        if (free) {
          resourceId = free.id;
          chairName = free.name;
        } else {
          try {
            const proposed = `Consultorio ${liveChairs.length + 1}`;
            const res = await fetch("/api/agenda/resources", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: proposed, kind: "SILLA_DENTAL" }),
            });
            if (res.ok) {
              const data = await res.json();
              const created = data.resource;
              if (created?.id) {
                resourceId = created.id;
                chairName = created.name;
                setChairsState((prev) => [
                  ...prev,
                  {
                    id: created.id,
                    name: created.name,
                    color: created.color ?? null,
                    orderIndex: created.orderIndex ?? prev.length,
                  },
                ]);
                toast.success(t("pages.clinicLayout.chairCreated", { name: created.name }));
              }
            } else {
              toast.error(t("pages.clinicLayout.resourceCreateError"));
            }
          } catch {
            toast.error(t("pages.clinicLayout.resourceCreateErrorGeneric"));
          }
        }
      }

      const elem: LayoutElement = {
        id,
        type,
        col,
        row,
        rotation: 0,
        resourceId,
        name: chairName ?? (td.isChair ? "Consultorio" : null),
      };
      // Functional setState evita stale closures entre el inicio del
      // fetch (que puede tomar 200ms+) y el commit del nuevo elemento.
      setElements((prev) => {
        pushHistory(prev);
        return [...prev, elem];
      });
      setSelectedId(id);
      markDirty();
      dropInFlightRef.current = false;
    },
    [catalog, elements, liveChairs, pushHistory, markDirty],
  );

  const updateElement = useCallback(
    (id: number, patch: Partial<LayoutElement>) => {
      setElements((prev) => {
        pushHistory(prev);
        return prev.map((e) => (e.id === id ? { ...e, ...patch } : e));
      });
      markDirty();
    },
    [pushHistory, markDirty],
  );

  const deleteElement = useCallback(
    async (id: number) => {
      const elem = elements.find((e) => e.id === id);
      if (!elem) return;

      // Si es un sillón con Resource asociado, ofrecemos también borrar el
      // Resource en la agenda (no solo quitarlo del canvas).
      let alsoDeleteResource = false;
      if (elem.resourceId) {
        const chair = liveChairs.find((c) => c.id === elem.resourceId);
        const chairName = chair?.name ?? t("pages.clinicLayout.thisChair");
        alsoDeleteResource = await askConfirm({
          title: t("pages.clinicLayout.deleteChairTitle", { name: chairName }),
          description: t("pages.clinicLayout.deleteChairDescription"),
          variant: "danger",
          confirmText: t("pages.clinicLayout.deleteFromBoth"),
          cancelText: t("pages.clinicLayout.onlyFromLayout"),
        });
      }

      setElements((prev) => {
        pushHistory(prev);
        return prev.filter((e) => e.id !== id);
      });
      if (selectedId === id) setSelectedId(null);
      markDirty();

      if (alsoDeleteResource && elem.resourceId) {
        try {
          const res = await fetch(`/api/agenda/resources/${elem.resourceId}`, {
            method: "DELETE",
          });
          if (res.ok) {
            setChairsState((prev) => prev.filter((c) => c.id !== elem.resourceId));
            toast.success(t("pages.clinicLayout.chairDeletedBoth"));
          } else if (res.status === 409) {
            const body = (await res.json().catch(() => ({}))) as { count?: number };
            const n = body.count ?? 0;
            toast.error(
              n > 0
                ? t("pages.clinicLayout.archiveBlockedActiveAppointments", { count: n })
                : t("pages.clinicLayout.deleteBlockedAssociated"),
            );
          } else {
            toast.error(t("pages.clinicLayout.deleteAgendaError"));
          }
        } catch {
          toast.error(t("pages.clinicLayout.deleteResourceError"));
        }
      }
    },
    [elements, liveChairs, selectedId, pushHistory, markDirty],
  );

  const duplicateElement = useCallback(
    (id: number) => {
      setElements((prev) => {
        const orig = prev.find((e) => e.id === id);
        if (!orig) return prev;
        const newId = nextIdRef.current++;
        const dup: LayoutElement = {
          ...orig,
          id: newId,
          col: orig.col + 2,
          row: orig.row + 2,
          resourceId: null,
        };
        pushHistory(prev);
        setSelectedId(newId);
        return [...prev, dup];
      });
      markDirty();
    },
    [pushHistory, markDirty],
  );

  const undo = useCallback(() => {
    if (history.length <= 1) return;
    const prev = history[history.length - 2];
    setHistory((h) => h.slice(0, -1));
    setElements(prev);
    markDirty();
  }, [history, markDirty]);

  /* ─── Atajos teclado ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId !== null) duplicateElement(selectedId);
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setPickedChairId(null);
        cancelDrag();
        setPanMode(false);
        return;
      }
      // Tool switching estilo Figma: V = select, H = hand (no toggle).
      if (e.key === "v" || e.key === "V") {
        setPanMode(false);
        return;
      }
      if (e.key === "h" || e.key === "H") {
        setPanMode(true);
        return;
      }
      if (selectedId === null) return;
      if (e.key === "r" || e.key === "R") {
        const cur = elements.find((x) => x.id === selectedId);
        if (cur) {
          const next = ((cur.rotation + 90) % 360) as Rotation;
          updateElement(selectedId, { rotation: next });
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteElement(selectedId);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, elements, undo, duplicateElement, deleteElement, updateElement, cancelDrag]);

  // Cleanup del RAF al desmontar (estricto en strict mode dev).
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  /* ─── Drag & drop / pan / mouse ─── */

  const eventToGrid = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const sx = (clientX - rect.left) / zoom;
      const sy = (clientY - rect.top) / zoom;
      const [col, row] = fromScreen(sx, sy, ORIG_X + panOffset.x, ORIG_Y + panOffset.y);
      return {
        col: Math.round(col),
        row: Math.round(row),
        colExact: col,
        rowExact: row,
      };
    },
    [zoom, panOffset.x, panOffset.y],
  );

  const onSidebarMouseDown = useCallback((typeKey: string) => {
    setDragType(typeKey);
  }, []);

  const onSvgMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      // Si hay un drag desde catálogo activo, no iniciar pan ni
      // deselección — el window listener maneja el drop.
      if (dragType) return;

      // El pan va PRIMERO: la mano (H) sigue funcionando también En Vivo,
      // que es como se recorre un plano grande en el monitor de la sala.
      if (panMode) {
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          px: panOffset.x,
          py: panOffset.y,
        };
        return;
      }

      const target = e.target as Element;

      // En Vivo: clic en el piso vacío = cerrar la tarjeta. El halo del
      // sillón (`data-live-chair`) y su dibujo (`data-element-id`) tienen
      // su propio manejador y NO cuentan como piso vacío.
      if (liveMode) {
        if (!target.closest("[data-live-chair]") && !target.closest("[data-element-id]")) {
          setPickedChairId(null);
        }
        return;
      }

      // Click sobre el fondo deselecciona (solo con tool select).
      if (!target.closest("[data-element-id]")) {
        setSelectedId(null);
      }
    },
    [liveMode, panMode, dragType, panOffset.x, panOffset.y],
  );

  /** Mousemove throttled con requestAnimationFrame para PAN y MOVE.
   *  El drag desde el catálogo (dragType) NO se maneja aquí — vive en un
   *  window listener (ver useEffect más abajo) para ser tool-agnostic:
   *  funciona con cualquier herramienta (V/H) activa, sin que el botón
   *  de mano interfiera con el drop. */
  const onSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const cx = e.clientX;
      const cy = e.clientY;
      pendingMouseRef.current = { x: cx, y: cy };
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const last = pendingMouseRef.current;
        if (!last) return;
        // Pan (solo cuando hand tool activo Y el usuario inició drag en
        // canvas vacío con mousedown).
        if (panMode && panStartRef.current) {
          const dx = (last.x - panStartRef.current.x) / zoom;
          const dy = (last.y - panStartRef.current.y) / zoom;
          setPanOffset({
            x: panStartRef.current.px + dx,
            y: panStartRef.current.py + dy,
          });
          return;
        }
        // Move de elemento existente — actualiza SOLO movingPosition,
        // no toques `elements` hasta el mouseUp.
        if (movingId !== null && moveStartRef.current) {
          const g = eventToGrid(last.x, last.y);
          if (!g) return;
          const dx = g.col - moveStartRef.current.mx;
          const dy = g.row - moveStartRef.current.my;
          setMovingPosition({
            col: moveStartRef.current.col + dx,
            row: moveStartRef.current.row + dy,
          });
        }
      });
    },
    [panMode, eventToGrid, movingId, zoom],
  );

  const onSvgMouseUp = useCallback(
    (_e: React.MouseEvent<SVGSVGElement>) => {
      // Cancela cualquier RAF pendiente para que no procese eventos
      // posteriores al mouseUp.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingMouseRef.current = null;

      if (panMode && panStartRef.current) {
        panStartRef.current = null;
        markDirty();
        return;
      }
      // dragType (drag desde catálogo) se maneja en window listener —
      // ver useEffect "drag from catalog". Aquí solo manejamos el move
      // de elementos existentes.
      if (movingId !== null) {
        // Commitea la posición final al array `elements` con functional
        // setState. Solo aquí pagamos el re-render + autosave dirty.
        const finalPos = movingPosition;
        const id = movingId;
        if (finalPos) {
          setElements((prev) =>
            prev.map((el) => (el.id === id ? { ...el, col: finalPos.col, row: finalPos.row } : el)),
          );
          markDirty();
        } else {
          // mouseDown + mouseUp sin movimiento → click. Si el tipo es
          // OPENABLE (puerta/gabinete/puerta_bano), alternar isOpen.
          const elem = elements.find((e) => e.id === id);
          if (elem && OPENABLE_TYPES.has(elem.type)) {
            setOpenIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }
        }
        moveStartRef.current = null;
        setMovingId(null);
        setMovingPosition(null);
      }
    },
    [panMode, movingId, movingPosition, elements, markDirty],
  );

  /** Drag desde el catálogo (sidebar) → drop en cualquier parte.
   *  Se monta como listeners de WINDOW cuando dragType cambia para que:
   *  - El drop funcione con cualquier tool activa (V/H), porque no
   *    depende del SVG handler que comparte branches con pan/move.
   *  - El ghost se actualice incluso si el cursor entra/sale del SVG.
   *  - El mouseup llegue garantizado, aunque el cursor caiga sobre un
   *    elemento hijo o panel hermano. */
  useEffect(() => {
    if (!dragType) return;
    const currentDragType = dragType;
    let rafLocal: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const flush = () => {
      rafLocal = null;
      const g = eventToGrid(lastX, lastY);
      if (g) setDragGhost({ col: g.col, row: g.row });
    };
    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafLocal !== null) return;
      rafLocal = requestAnimationFrame(flush);
    };
    const onUp = (e: MouseEvent) => {
      if (rafLocal !== null) {
        cancelAnimationFrame(rafLocal);
        rafLocal = null;
      }
      const g = eventToGrid(e.clientX, e.clientY);
      // Limpia ghost ANTES del addElement async para evitar duplicados.
      setDragType(null);
      setDragGhost(null);
      if (g && g.col >= 0 && g.row >= 0 && g.col < GRID_COLS && g.row < GRID_ROWS) {
        void addElement(currentDragType, g.col, g.row);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafLocal !== null) cancelAnimationFrame(rafLocal);
    };
  }, [dragType, eventToGrid, addElement]);

  const onElementMouseDown = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      // 🔴 En Vivo el piso NO se edita. Antes el candado solo tapaba el
      // catálogo: el lienzo seguía aceptando arrastres, así que mirar el
      // tablero y rozar un sillón movía el plano de una clínica en
      // producción (y lo autoguardaba en silencio).
      //
      // Lo ÚNICO que se quita del modo es mover: el clic sigue haciendo
      // algo. En un sillón abre su tarjeta; en una puerta o un gabinete
      // los sigue abriendo y cerrando, igual que antes.
      if (liveMode) {
        const vivo = elements.find((x) => x.id === id);
        if (!vivo) return;
        if (vivo.resourceId) {
          setPickedChairId(vivo.resourceId);
          return;
        }
        if (OPENABLE_TYPES.has(vivo.type)) {
          setOpenIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
        return;
      }
      if (panMode || dragType) return;
      setSelectedId(id);
      const elem = elements.find((x) => x.id === id);
      if (!elem) return;
      const g = eventToGrid(e.clientX, e.clientY);
      if (!g) return;
      moveStartRef.current = {
        id,
        col: elem.col,
        row: elem.row,
        mx: g.col,
        my: g.row,
      };
      setMovingId(id);
    },
    [liveMode, panMode, dragType, elements, eventToGrid],
  );

  const onSvgWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.max(0.4, Math.min(2.2, z * (e.deltaY > 0 ? 1 / 1.1 : 1.1))));
  }, []);

  /* ─── Render del catálogo / sidebar ─── */

  const usedChairIds = useMemo(
    () => new Set(elements.filter((e) => e.resourceId).map((e) => e.resourceId)),
    [elements],
  );
  const availableChairs = useMemo(
    () =>
      liveChairs.filter(
        (c) =>
          !usedChairIds.has(c.id) ||
          (selectedElement?.resourceId && selectedElement.resourceId === c.id),
      ),
    [liveChairs, usedChairIds, selectedElement],
  );

  /* ─── En Vivo: contadores de arriba y tarjeta del sillón ─────────────
   * Todo sale de las MISMAS citas que ya pintaron los halos: los
   * contadores no pueden decir "2 libres" con tres halos verdes en
   * pantalla, y la tarjeta no puede enseñar algo que el piso no enseñe.
   */

  /** Sillones DIBUJADOS en el plano. Uno dado de alta pero sin colocar no
   *  cuenta: no está en el piso, así que no se puede contestar "¿dónde?". */
  const placedLiveChairs = useMemo(() => {
    const out: { resourceId: string; name: string }[] = [];
    for (const el of elements) {
      if (!el.resourceId) continue;
      const chair = liveChairs.find((c) => c.id === el.resourceId);
      if (chair) out.push({ resourceId: chair.id, name: chair.name });
    }
    return out;
  }, [elements, liveChairs]);

  const liveCounts = useMemo<FloorCountItem[]>(() => {
    if (!liveMode) return [];
    const tally: Record<ChairStatus, number> = { libre: 0, proximo: 0, ocupado: 0 };
    for (const c of placedLiveChairs) {
      tally[getChairStatus(c.resourceId, viewTime, appointments)] += 1;
    }
    // El texto entra por prop: la capa compartida no conoce ni una palabra
    // del negocio, y por eso la puede montar también el instituto.
    return ESTADOS.map((estado) => ({
      key: estado,
      tone: estado,
      count: tally[estado],
      label: t(COUNT_KEY[estado]),
      detail: t(DETAIL_KEY[estado]),
    }));
  }, [liveMode, placedLiveChairs, viewTime, appointments, t]);

  /** Qué significa cada color. En modo Armar no hay estados: solo la
   *  línea que explica cómo se pone un mueble. */
  const legendItems = useMemo<FloorLegendItem[]>(
    () =>
      liveMode
        ? ESTADOS.map((estado) => ({
            key: estado,
            tone: estado,
            label: t(LABEL_KEY[estado]),
            detail: t(DETAIL_KEY[estado]),
          }))
        : [],
    [liveMode, t],
  );

  const pickedCard: ChairCardData | null = useMemo(() => {
    if (!liveMode || !pickedChairId) return null;
    const chair = placedLiveChairs.find((c) => c.resourceId === pickedChairId);
    if (!chair) return null;
    const current = getChairAppointment(pickedChairId, viewTime, appointments);
    const next = getNextChairAppointment(pickedChairId, viewTime, appointments);
    const upcoming = appointments
      .filter(
        (a) =>
          a.resourceId === pickedChairId &&
          a.id !== current?.id &&
          a.id !== next?.id &&
          a.start.getTime() > viewTime.getTime(),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return {
      chairName: chair.name,
      status: getChairStatus(pickedChairId, viewTime, appointments),
      current,
      next,
      upcoming,
    };
  }, [liveMode, pickedChairId, placedLiveChairs, viewTime, appointments]);

  /**
   * La geometría del mundo, con identidad congelada contra su contenido
   * (ver `useMundoEstable`). Aquí el plano solo cambia editando, y editando
   * no se está En Vivo — pero la firma cuesta nada y quita de en medio toda
   * una clase de fallo: que un render cualquiera reconstruya la escena y
   * tire la posición de la cámara.
   *
   * De `metadata` el mundo solo mira `gridSize`, así que se le pasa la del
   * primer render y NO `{ zoom, panOffset }`, que cambian con la rueda del
   * lienzo 2D y no significan nada en 3D.
   */
  const geometria = useMundoEstable(elements, safeInitialMetadata, liveChairs);

  /**
   * ¿El piso de En Vivo se pinta en 3D? Hace falta estar En Vivo, que haya
   * plano, que el equipo pueda y que nadie haya pedido el 2D.
   *
   * 🔴 En EDICIÓN esto es siempre false: armar el plano se hace en la
   * rejilla isométrica, arrastrando, como hasta hoy.
   */
  const piso3D =
    liveMode &&
    elements.length > 0 &&
    (modoPiso ? modoPiso === "3d" : puede3D === true);

  /** La línea de tiempo está lejos de "ahora" (alguien viajó la hora). */
  const viajando = piso3D && Math.abs(Date.now() - viewTime.getTime()) >= VIAJE_MS;

  /**
   * Clic en un sillón del mundo. Abre LA MISMA tarjeta que el clic en el
   * plano 2D (`ChairCard`), con el mismo enmascarado: el pick solo trae el
   * `resourceId` del sillón, y de ahí en adelante manda `pickedCard`.
   */
  const elegirSillon3D = useCallback(
    (pick: Clinic3DPick) => setPickedChairId(pick.resourceId),
    [],
  );

  /** Abre el expediente del paciente de una cita en una pestaña nueva. */
  const openPatientRecord = useCallback(
    (apt: LiveAppointment) => {
      // Sin patientId no podemos navegar al expediente — la ruta
      // /dashboard/patients/[id] requiere ese segmento.
      if (!apt.patientId) {
        toast.error(t("pages.clinicLayout.recordNotAvailable"));
        return;
      }
      // Pestaña nueva para no salir del modo En Vivo.
      window.open(`/dashboard/patients/${apt.patientId}`, "_blank", "noopener,noreferrer");
    },
    [t],
  );

  const ox = ORIG_X + panOffset.x;
  const oy = ORIG_Y + panOffset.y;

  /* ─── Helpers de render del canvas ─── */
  // El suelo, el mueble y el fantasma los pinta la capa compartida
  // (IsoTiles / IsoElement / IsoGhost). Aquí solo se decide QUÉ se pinta:
  // el arrastre, el zoom y el desplazamiento siguen siendo de este archivo.

  /** Sort memoizado: el sort por col+row solo se recalcula si `elements`
   *  cambia. Sin esto cada render rebuild el array. Durante un drag de
   *  move, `elements` NO cambia (solo movingPosition) → no reordenamos
   *  → no re-keying en DOM → sin flicker. */
  const sortedElements = useMemo(
    () =>
      elements
        .slice()
        .sort((a, b) => a.col + a.row - (b.col + b.row)),
    [elements],
  );

  const renderElements = () => {
    return sortedElements.map((el) => {
      const td = catalog.byKey.get(el.type);
      if (!td) return null;
      // Override visual: el elemento siendo movido se renderiza con
      // movingPosition (state local), no con el col/row del array.
      const isMoving = el.id === movingId;
      const renderCol = isMoving && movingPosition ? movingPosition.col : el.col;
      const renderRow = isMoving && movingPosition ? movingPosition.row : el.row;
      const [sx, sy] = toScreen(renderCol, renderRow, ox, oy);
      const chair = el.resourceId ? liveChairs.find((c) => c.id === el.resourceId) : null;
      const labelText = td.isChair
        ? chair?.name ?? el.name ?? t("pages.clinicLayout.chairFallbackLabel")
        : null;
      // Opts dinámicos para draw():
      // - isOpen: el id está en openIds (puertas/gabinetes click-toggleable)
      // - isOccupied: solo en modo En Vivo, sólo sillones, ocupados ahora
      const isOpen = openIds.has(el.id);
      const isOccupied =
        liveMode &&
        td.isChair &&
        !!el.resourceId &&
        getChairStatus(el.resourceId, viewTime, appointments) === "ocupado";
      // Centro y top para el tooltip de hover (en coordenadas de pantalla).
      const cx = sx + ((td.w - td.h) * ISO_C) / 2;
      const topY = sy - (td.h + 1) * ISO_C * 0.9;
      const showHoverTip = !panMode && !dragType && !liveMode;
      return (
        <IsoElement
          key={el.id}
          elementId={el.id}
          type={td}
          col={renderCol}
          row={renderRow}
          rotation={el.rotation}
          ox={ox}
          oy={oy}
          label={labelText}
          selected={el.id === selectedId}
          moving={isMoving}
          // Con la herramienta de mano el cursor lo pone el contenedor
          // (`grab`/`grabbing`): el `move` del elemento lo tapaba.
          locked={panMode}
          drawOpts={{ isOpen, isOccupied }}
          onMouseDown={(e) => onElementMouseDown(e, el.id)}
          onMouseEnter={() => {
            if (!showHoverTip) return;
            setElementHover({ id: el.id, cx, topY, label: td.label, isOpen });
          }}
          onMouseLeave={() => {
            setElementHover((h) => (h?.id === el.id ? null : h));
          }}
          // Un sillon sin `resourceId` se dibuja igual pero no esta
          // conectado a la agenda: no se pinta En Vivo y nunca tendra
          // citas. La etiqueta en rojo lo dice desde el piso, que es
          // donde se mira; el panel de la derecha ya lo explicaba, pero
          // solo si lo seleccionabas.
          labelBad={td.isChair && !el.resourceId}
        />
      );
    });
  };

  const renderGhost = () => {
    if (!dragType || !dragGhost) return null;
    const td = catalog.byKey.get(dragType);
    if (!td) return null;
    return <IsoGhost type={td} col={dragGhost.col} row={dragGhost.row} ox={ox} oy={oy} />;
  };

  /** Filtro feColorMatrix para iluminación dinámica según `lightingHour`.
   *  6-9h dorado · 9-17h neutro · 17-20h ámbar cálido · 20-6h azul frío. */
  const lightingMatrix = useMemo(() => {
    const h = lightingHour;
    if (h >= 6 && h < 9) {
      return "1.06 0.04 0 0 0.02  0 0.98 0 0 0  0 0 0.82 0 0  0 0 0 1 0";
    }
    if (h >= 17 && h < 20) {
      return "1.10 0.08 0 0 0.04  0 0.93 0 0 0  0 0 0.68 0 0  0 0 0 1 0";
    }
    if (h >= 20 || h < 6) {
      return "0.82 0 0 0 0  0 0.88 0 0 0  0 0 1.08 0 0.04  0 0 0 1 0";
    }
    return null;
  }, [lightingHour]);

  /** Etiqueta + ícono + color del pill de iluminación en el topbar. */
  const lightingMeta = useMemo(() => {
    const h = lightingHour;
    if (h >= 6 && h < 9) return { label: t("pages.clinicLayout.lightingMorning"), color: "#F59E0B", Icon: Sunrise };
    if (h >= 9 && h < 17) return { label: t("pages.clinicLayout.lightingDay"), color: "#4A90E2", Icon: Sun };
    if (h >= 17 && h < 20) return { label: t("pages.clinicLayout.lightingAfternoon"), color: "#EA580C", Icon: Sunset };
    return { label: t("pages.clinicLayout.lightingNight"), color: "#6366F1", Icon: Moon };
  }, [lightingHour, t]);

  /* ─── Renders ─── */

  /** El globo del hover. Medía 88 px fijos y recortaba "Puerta de baño";
   *  ahora se estira con el texto (SVG no sabe ajustar una caja a su
   *  contenido, así que se estima a ~5.9 px por carácter de la Inter 10). */
  const hoverTipText = elementHover
    ? `${elementHover.label}${elementHover.isOpen ? ` · ${t("pages.clinicLayout.openSuffix")}` : ""}`
    : "";
  const hoverTipWidth = Math.max(72, Math.min(240, hoverTipText.length * 5.9 + 26));

  // Welcome prompt cuando no hay layout previo (clínica nueva).
  if (!welcomeDismissed) {
    return (
      <>
        <div className={`${styles.mobileBlock} ${mc.mcTokens}`}>
          <div className={styles.mobileBlockIcon}>
            <Monitor size={32} aria-hidden />
          </div>
          <h1>{t("pages.clinicLayout.openOnComputer")}</h1>
          <p>{t("pages.clinicLayout.editorWidthShort")}</p>
        </div>
        <div className={`${styles.welcomeWrap} ${mc.mcTokens}`}>
          <WelcomePrompt
            onLoaded={(data) => {
              const els = sanitizeElements(data.elements);
              setElements(els);
              setHistory([els]);
              if (data.chairs.length > 0) setChairsState(data.chairs);
              setWelcomeDismissed(true);
              // No marca dirty: el server ya persistió.
            }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile block */}
      <div className={`${styles.mobileBlock} ${mc.mcTokens}`}>
        <div className={styles.mobileBlockIcon}>
          <Monitor size={32} aria-hidden />
        </div>
        <h1>{t("pages.clinicLayout.openOnComputer")}</h1>
        <p>{t("pages.clinicLayout.editorWidthLong")}</p>
      </div>

      <div className={`${styles.page} ${mc.mcTokens}`}>
        {/* ── Topbar ── */}
        <div className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}><Building2 size={16} aria-hidden /></span>
            <span className={styles.brandText}>DaleControl</span>
          </div>
          <span className={styles.divider} />
          <span className={styles.clinicPill}>{clinic.name}</span>
          <span className={styles.divider} />

          {/* Toggle Edición / En Vivo */}
          <div className={styles.modeToggle}>
            <button
              type="button"
              className={`${styles.modeBtn} ${!liveMode ? styles.modeBtnActive : ""}`}
              onClick={() => setLiveMode(false)}
              aria-pressed={!liveMode}
            >
              {t("pages.clinicLayout.modeEdit")}
            </button>
            <button
              type="button"
              className={`${styles.modeBtn} ${liveMode ? styles.modeBtnActiveLive : ""}`}
              onClick={() => setLiveMode(true)}
              aria-pressed={liveMode}
            >
              {t("pages.clinicLayout.modeLive")}
            </button>
          </div>

          {liveMode && <LiveClock />}
          {/* Piso 3D ↔ plano 2D, solo En Vivo y solo si el equipo puede
              pintarlo. La elección se guarda por clínica. */}
          {liveMode && puede3D && elements.length > 0 && (
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => elegirPiso(piso3D ? "2d" : "3d")}
              aria-pressed={piso3D}
              title={
                piso3D
                  ? "Ver el plano isométrico en 2D"
                  : "Ver el piso en 3D, desde arriba"
              }
            >
              {piso3D ? (
                <MapIcon size={13} aria-hidden />
              ) : (
                <Box size={13} aria-hidden />
              )}{" "}
              {piso3D ? "Plano 2D" : "Piso 3D"}
            </button>
          )}
          {liveMode && (
            <button
              type="button"
              className={styles.optimizerBtn}
              onClick={() => setShowOptimizer(true)}
              title={t("pages.clinicLayout.optimizeTitle")}
            >
              <Sparkles size={13} aria-hidden /> {t("pages.clinicLayout.optimizeWithAi")}
            </button>
          )}
          {liveMode && liveConfig.enabled && liveConfig.slug && (
            <Link
              href={`/live/${liveConfig.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.toolbarBtn}
              title={t("pages.clinicLayout.openPublicView")}
            >
              <ExternalLink size={13} aria-hidden /> {liveConfig.slug}
            </Link>
          )}
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={() => setShareOpen(true)}
            title={t("pages.clinicLayout.shareLiveTitle")}
          >
            <Share2 size={13} aria-hidden /> {t("pages.clinicLayout.share")}
          </button>
          {/* Mi Clínica 3D: recorrido en primera persona del plano (aparte de
              "Ver en vivo"). Vista nueva, no toca el modo en vivo. */}
          <Link
            href="/dashboard/clinic-layout/3d"
            className={styles.toolbarBtn}
            title="Recorre tu clínica en 3D (vista en primera persona)"
          >
            <Box size={13} aria-hidden /> Mi Clínica 3D
          </Link>
          {/* Pill de iluminación dinámica — click avanza 3 horas y previsualiza
              el filtro feColorMatrix sobre el canvas. */}
          <button
            type="button"
            className={styles.lightingPill}
            onClick={() => setLightingHour((h) => (h + 3) % 24)}
            title={t("pages.clinicLayout.lightingSimTitle")}
            style={{ color: lightingMeta.color }}
          >
            <lightingMeta.Icon size={13} aria-hidden />
            <span>{lightingMeta.label}</span>
            <span className={styles.lightingHourTxt}>
              {String(lightingHour).padStart(2, "0")}:00
            </span>
          </button>

          <span className={styles.spacer} />

          {/* Indicador autosave */}
          <span className={styles.savedIndicator}>
            <span
              className={`${styles.savedDot} ${
                saveState === "pending" || saveState === "saving"
                  ? styles.savedDotPending
                  : saveState === "error"
                  ? styles.savedDotError
                  : ""
              }`}
              aria-hidden
            />
            {saveState === "saving"
              ? t("pages.clinicLayout.savingEllipsis")
              : saveState === "pending"
              ? t("pages.clinicLayout.unsavedChanges")
              : saveState === "error"
              ? t("pages.clinicLayout.saveErrorShort")
              : savedAgo
              ? t("pages.clinicLayout.savedAgo", { ago: savedAgo })
              : t("pages.clinicLayout.noChanges")}
          </span>

          {!liveMode && (
            <>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={undo}
                disabled={history.length <= 1}
                title={t("pages.clinicLayout.undoTitle")}
              >
                <Undo2 size={13} aria-hidden /> {t("pages.clinicLayout.undo")}
              </button>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={() => setZoom((z) => Math.max(0.4, z / 1.1))}
                title={t("pages.clinicLayout.zoomOut")}
              >
                <ZoomOut size={13} aria-hidden />
              </button>
              <span className={styles.zoomPercent}>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={() => setZoom((z) => Math.min(2.2, z * 1.1))}
                title={t("pages.clinicLayout.zoomIn")}
              >
                <ZoomIn size={13} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={() => {
                  setZoom(1);
                  setPanOffset({ x: 0, y: 0 });
                }}
                title={t("pages.clinicLayout.reset1to1")}
              >
                <Maximize2 size={13} aria-hidden /> 1:1
              </button>
              <div
                className={styles.toolToggleGroup}
                role="group"
                aria-label={t("pages.clinicLayout.activeTool")}
              >
                <button
                  type="button"
                  className={`${styles.toolToggleBtn} ${!panMode ? styles.toolToggleBtnActive : ""}`}
                  onClick={() => setPanMode(false)}
                  aria-pressed={!panMode}
                  title={t("pages.clinicLayout.toolSelect")}
                >
                  <MousePointer2 size={13} aria-hidden />
                  <kbd>V</kbd>
                </button>
                <button
                  type="button"
                  className={`${styles.toolToggleBtn} ${panMode ? styles.toolToggleBtnActive : ""}`}
                  onClick={() => setPanMode(true)}
                  aria-pressed={panMode}
                  title={t("pages.clinicLayout.toolHand")}
                >
                  <Hand size={13} aria-hidden />
                  <kbd>H</kbd>
                </button>
              </div>

              <span className={styles.kbdHint}>
                <kbd>R</kbd> {t("pages.clinicLayout.kbdRotate")} · <kbd>Del</kbd> {t("pages.clinicLayout.kbdDelete")} · <kbd>⌘Z</kbd> {t("pages.clinicLayout.kbdUndo")}
              </span>
            </>
          )}
        </div>

        {/* ── Sidebar (paleta) ── */}
        <aside className={styles.sidebar}>
          <div
            className={`${styles.sidebarLockedOverlay} ${liveMode ? styles.sidebarLockedOverlayVisible : ""}`}
            aria-hidden={!liveMode}
          >
            <Lock size={26} aria-hidden />
            <strong>{t("pages.clinicLayout.liveModeTitle")}</strong>
            {t("pages.clinicLayout.editingDisabled")}
          </div>
          {catalog.grouped.map((group) => (
            <div key={group.id}>
              <button
                type="button"
                className={styles.categoryHeader}
                onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                aria-expanded={!collapsed[group.id]}
              >
                <span>{group.label}</span>
                <ChevronDown
                  size={12}
                  aria-hidden
                  className={`${styles.categoryChevron} ${collapsed[group.id] ? styles.categoryChevronCollapsed : ""}`}
                />
              </button>
              {!collapsed[group.id] && (
                <div className={styles.categoryGrid}>
                  <FloorPalette>
                    {group.types.map((item) => {
                      const placedChairs = item.isChair
                        ? elements.filter((e) => e.type === item.key && e.resourceId).length
                        : 0;
                      const totalChairs = item.isChair ? liveChairs.length : 0;
                      return (
                        <FloorPaletteItem
                          key={item.key}
                          icon={item.icon}
                          label={item.label}
                          badge={
                            item.isChair && totalChairs > 0
                              ? `${placedChairs}/${totalChairs}`
                              : undefined
                          }
                          onMouseDown={() => onSidebarMouseDown(item.key)}
                        />
                      );
                    })}
                  </FloorPalette>
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* ── Canvas + (Timeline si liveMode) ── */}
        <div
          className={`${styles.canvasWrap} ${liveMode ? styles.canvasWrapLive : ""}`}
          data-pan-mode={panMode && !liveMode ? "true" : "false"}
          data-panning={panStartRef.current ? "true" : "false"}
        >
          {/* La caja del piso. Existe para que los flotantes (contadores,
              leyenda y tarjeta) se coloquen contra el PISO y no contra el
              hueco entero, que En Vivo incluye la línea de tiempo. */}
          <div className={styles.canvasStage}>
            {/* ── EL PISO ────────────────────────────────────────────
                En Vivo se pinta el mundo 3D (vista aérea, sin caminar); en
                Edición, y como respaldo, la rejilla isométrica de siempre.

                🔴 El isométrico se DESMONTA, no se esconde: son 768 baldosas
                más los muebles reconciliándose en cada render, y el reloj de
                En Vivo re-renderiza esta pantalla cada segundo durante horas.
                Un `display:none` ahorraría el pintado pero no el trabajo de
                React. */}
            {piso3D ? (
              <div className={styles.stage3d}>
                <LiveWorld
                  clinic={{ id: clinic.id, name: clinic.name, category: clinic.category }}
                  mundo={geometria}
                  /* El estado vivo PRIVADO del dueño: trae `patientId`, así
                     que el clic puede acabar en un expediente. Es la misma
                     ruta que ya usa /dashboard/clinic-layout/3d. */
                  endpoint="/api/clinic-layout/3d-state"
                  onPick={elegirSillon3D}
                  legend={LEYENDA_3D_PANEL}
                />
              </div>
            ) : (
              <svg
                ref={svgRef}
                className={styles.svgRoot}
                viewBox={VIEW_BOX}
                preserveAspectRatio="xMidYMid meet"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
                onMouseDown={onSvgMouseDown}
                onMouseMove={onSvgMouseMove}
                onMouseUp={onSvgMouseUp}
                onMouseLeave={cancelMoveOrPan}
                onWheel={onSvgWheel}
              >
                <defs>
                  {lightingMatrix && (
                    <filter
                      id="mfLighting"
                      x="0%"
                      y="0%"
                      width="100%"
                      height="100%"
                      colorInterpolationFilters="sRGB"
                    >
                      <feColorMatrix type="matrix" values={lightingMatrix} />
                    </filter>
                  )}
                </defs>
                {/* La losa va DEBAJO de las baldosas: le da grosor al piso
                    para que deje de flotar sobre el fondo. */}
                <FloorSlab ox={ox} oy={oy} cols={GRID_COLS} rows={GRID_ROWS} />
                <IsoTiles cols={GRID_COLS} rows={GRID_ROWS} ox={ox} oy={oy} />
                {/* Las sombras, entre el piso y los muebles. */}
                <FloorShadows
                  elements={sortedElements}
                  byKey={catalog.byKey}
                  ox={ox}
                  oy={oy}
                  movingId={movingId}
                  movingPosition={movingPosition}
                />
                <g filter={lightingMatrix ? "url(#mfLighting)" : undefined}>
                  {renderElements()}
                  {renderGhost()}
                </g>
                {/* Tooltip flotante sobre el elemento hovereado (modo Edición). */}
                {elementHover && (
                  <g pointerEvents="none">
                    <rect
                      x={elementHover.cx - hoverTipWidth / 2}
                      y={elementHover.topY - 22}
                      width={hoverTipWidth}
                      height={18}
                      rx={5}
                      className={styles.hoverTipBox}
                    />
                    <text
                      x={elementHover.cx}
                      y={elementHover.topY - 9}
                      textAnchor="middle"
                      className={styles.hoverTipText}
                    >
                      {hoverTipText}
                    </text>
                  </g>
                )}
                {liveMode && (
                  <LiveOverlay
                    elements={elements}
                    ox={ox}
                    oy={oy}
                    viewTime={viewTime}
                    appointments={appointments}
                    showFullNames={clinic.liveModeShowPatientNames}
                    onHover={setHover}
                    onPick={setPickedChairId}
                  />
                )}
              </svg>
            )}

            {/* 🔴 El piso en 3D enseña AHORA y solo AHORA: su estado sale de
                su propio sondeo, no de la línea de tiempo. Si alguien viaja
                la hora, el panel y la línea sí la siguen — y callarlo sería
                dejar dos relojes distintos en la misma pantalla. */}
            {viajando && (
              <div className={styles.stageNote} role="status">
                <span>
                  El piso muestra <strong>ahora</strong>; abajo estás viendo las{" "}
                  {fmtHM(viewTime)}.
                </span>
                <button
                  type="button"
                  className={styles.stageNoteBtn}
                  onClick={() => setViewTime(new Date())}
                >
                  {t("pages.clinicLayout.backToNow")}
                </button>
              </div>
            )}

            {/* ── Lo que flota sobre el piso ───────────────────────── */}
            {/* Contadores y leyenda: con el mundo montado los trae SU HUD
                (abajo a la derecha y abajo a la izquierda). Pintarlos otra
                vez aquí sería duplicarlos —y además contradecirlos: estos
                cuentan a la hora de la línea de tiempo y los del HUD cuentan
                AHORA, que es lo único que sabe el piso en 3D. */}
            {liveMode && !piso3D && liveCounts.length > 0 && (
              <div className={styles.floatCounters}>
                <FloorCounters
                  items={liveCounts}
                  ariaLabel={t("pages.clinicLayout.statusCountsLabel")}
                />
              </div>
            )}
            {!piso3D && (
              <div className={styles.floatLegend}>
                <FloorLegend
                  items={legendItems}
                  title={liveMode ? t("pages.clinicLayout.legendTitle") : undefined}
                  help={t(liveMode ? "pages.clinicLayout.legendHintLive" : "pages.clinicLayout.legendHintEdit")}
                />
              </div>
            )}
            {liveMode && pickedCard && (
              <ChairCard
                data={pickedCard}
                viewTime={viewTime}
                /* 🔴 La MISMA bandera que el panel y el tooltip. Abrir una
                   tarjeta no destapa el nombre que la clínica pidió ocultar. */
                showFullNames={clinic.liveModeShowPatientNames}
                onClose={() => setPickedChairId(null)}
                onOpenRecord={openPatientRecord}
                t={t}
              />
            )}
          </div>
          {liveMode && (
            <LiveTimeline
              elements={elements}
              chairs={liveChairs}
              viewTime={viewTime}
              appointments={appointments}
              onSeek={setViewTime}
              onResetNow={() => setViewTime(new Date())}
            />
          )}
        </div>
        {/* El tooltip lo alimenta el hover del plano 2D. Al cambiar de
            piso a mitad de un hover se quedaba flotando para siempre. */}
        <LiveTooltip data={piso3D ? null : hover} />

        {shareOpen && (
          <SharePanel
            initial={liveConfig}
            clinicName={clinic.name}
            onClose={() => setShareOpen(false)}
          />
        )}

        {showOptimizer && (
          <OptimizerModal
            appointments={appointments}
            chairs={liveChairs.map((c) => ({ id: c.id, name: c.name }))}
            onClose={() => setShowOptimizer(false)}
          />
        )}

        {/* ── Properties panel / Live status ── */}
        <aside className={styles.propertiesPanel}>
          {liveMode ? (
            <>
              <LiveStatusPanel
                elements={elements}
                chairs={liveChairs}
                viewTime={viewTime}
                appointments={appointments}
                showFullNames={clinic.liveModeShowPatientNames}
                onOpenOdontogram={openPatientRecord}
              />
              <div style={{ marginTop: 14 }}>
                <WaitingRoom
                  waiting={waitingRoom}
                  appointments={appointments}
                  chairs={liveChairs}
                />
              </div>
            </>
          ) : !selectedElement || !selectedType ? (
            <div className={styles.propEmpty}>
              <MousePointer2 size={36} aria-hidden className={styles.propEmptyIcon} />
              <div>
                <strong>{t("pages.clinicLayout.selectElement")}</strong>
                <FloorPanelHelp>{t("pages.clinicLayout.selectElementHint")}</FloorPanelHelp>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.propTypePreview}>
                <span className={styles.propTypePreviewIcon}>
                  <svg width="36" height="36" viewBox="0 0 40 40">
                    <g dangerouslySetInnerHTML={{ __html: selectedType.icon }} />
                  </svg>
                </span>
                <div>
                  <div className={styles.propTypePreviewName}>{selectedType.label}</div>
                  <div className={styles.propTypePreviewMeta}>{t("pages.clinicLayout.elementNumber", { id: selectedElement.id })}</div>
                </div>
              </div>

              {selectedType.isChair && (
                <div className={styles.propGroup}>
                  <FloorPanelTitle>{t("pages.clinicLayout.assignedChair")}</FloorPanelTitle>
                  <select
                    className={styles.propChairSelect}
                    value={selectedElement.resourceId ?? ""}
                    onChange={(e) =>
                      updateElement(selectedElement.id, {
                        resourceId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">{t("pages.clinicLayout.unassigned")}</option>
                    {availableChairs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className={styles.propChairHint}>
                    {liveChairs.length === 0 ? (
                      <>{t("pages.clinicLayout.noChairsRegistered")} <a href="/dashboard/resources">{t("pages.clinicLayout.createInResources")}</a></>
                    ) : (
                      <>{t("pages.clinicLayout.chairConnectsHint")}</>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.propGroup}>
                <FloorPanelTitle>{t("pages.clinicLayout.position")}</FloorPanelTitle>
                <div className={styles.propInputRow}>
                  <input
                    type="number"
                    className={styles.propInput}
                    value={selectedElement.col}
                    onChange={(e) =>
                      updateElement(selectedElement.id, { col: parseInt(e.target.value || "0", 10) })
                    }
                  />
                  <input
                    type="number"
                    className={styles.propInput}
                    value={selectedElement.row}
                    onChange={(e) =>
                      updateElement(selectedElement.id, { row: parseInt(e.target.value || "0", 10) })
                    }
                  />
                </div>
              </div>

              <div className={styles.propGroup}>
                <FloorPanelTitle>{t("pages.clinicLayout.rotation")}</FloorPanelTitle>
                <div className={styles.propRotationRow}>
                  {[0, 90, 180, 270].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      className={`${styles.propRotBtn} ${selectedElement.rotation === deg ? styles.propRotBtnActive : ""}`}
                      onClick={() => updateElement(selectedElement.id, { rotation: deg as Rotation })}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.propGroup}>
                <FloorPanelTitle>{t("pages.clinicLayout.shortcuts")}</FloorPanelTitle>
                <ul className={styles.propKbdList}>
                  <li className={styles.propKbdRow}><span>{t("pages.clinicLayout.shortcutRotate")}</span><code>R</code></li>
                  <li className={styles.propKbdRow}><span>{t("common.delete")}</span><code>Del</code></li>
                  <li className={styles.propKbdRow}><span>{t("pages.clinicLayout.shortcutDuplicate")}</span><code>⌘D</code></li>
                  <li className={styles.propKbdRow}><span>{t("pages.clinicLayout.shortcutUndo")}</span><code>⌘Z</code></li>
                  <li className={styles.propKbdRow}><span>{t("pages.clinicLayout.shortcutPan")}</span><code>H</code></li>
                </ul>
              </div>

              <button
                type="button"
                className={styles.propDeleteBtn}
                onClick={() => deleteElement(selectedElement.id)}
              >
                <Trash2 size={13} aria-hidden /> {t("pages.clinicLayout.deleteElement")}
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
