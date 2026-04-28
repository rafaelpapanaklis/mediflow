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
} from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { toScreen, fromScreen, C as ISO_C } from "@/lib/floor-plan/iso";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import type {
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
import { SharePanel } from "./components/share-panel";
import { WaitingRoom, type WaitingRoomEntry } from "./components/waiting-room";
import { WelcomePrompt } from "./components/welcome-prompt";
import { Share2 } from "lucide-react";
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
const HISTORY_LIMIT = 24;
const AUTOSAVE_DELAY_MS = 1500;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export function ClinicLayoutClient({
  clinic,
  initialElements,
  initialMetadata,
  chairs,
}: Props) {
  const askConfirm = useConfirm();
  const catalog = useMemo(() => getCatalogForClinic(clinic.category), [clinic.category]);

  const [elements, setElements] = useState<LayoutElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<LayoutElement[][]>([initialElements]);
  const [zoom, setZoom] = useState(initialMetadata?.zoom ?? 1);
  const [panOffset, setPanOffset] = useState(
    initialMetadata?.panOffset ?? { x: 0, y: 0 },
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
  const [liveConfig, setLiveConfig] = useState({
    enabled: clinic.liveModeEnabled,
    slug: clinic.liveModeSlug,
    showPatientNames: clinic.liveModeShowPatientNames,
    hasPassword: false, // detectado al abrir share panel via PATCH response
  });
  const [welcomeDismissed, setWelcomeDismissed] = useState(initialElements.length > 0);
  const [chairsState, setChairsState] = useState<Chair[]>(chairs);
  // En todo el render usamos `liveChairs` como source of truth (puede crecer
  // tras seed-demo o creación al drag). El prop original `chairs` queda
  // intacto para no perder referencias.
  const liveChairs = chairsState;

  const nextIdRef = useRef<number>(
    Math.max(0, ...initialElements.map((e) => e.id)) + 1,
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
        toast.error("No se pudo guardar el layout");
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
      if (sec < 5) setSavedAgo("ahora");
      else if (sec < 60) setSavedAgo(`hace ${sec}s`);
      else if (sec < 3600) setSavedAgo(`hace ${Math.floor(sec / 60)} min`);
      else setSavedAgo("hace > 1 h");
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
        const dateStr = viewTime.toISOString().slice(0, 10);
        const res = await fetch(`/api/clinic-layout/appointments?date=${dateStr}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const parsed: LiveAppointment[] = (data.appointments ?? []).map(
          (a: { id: string; resourceId: string; patient: string; patientFull?: string; treatment: string; doctor: string; start: string; end: string; status?: string }) => ({
            id: a.id,
            resourceId: a.resourceId,
            patient: a.patient,
            patientFull: a.patientFull,
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
  }, [liveMode, viewTime]);

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
    if (liveMode) {
      setSelectedId(null);
      setDragType(null);
      setPanMode(false);
      setViewTime(new Date());
    }
  }, [liveMode]);

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
              body: JSON.stringify({ name: proposed, kind: "CHAIR" }),
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
                toast.success(`Sillón "${created.name}" creado en la agenda`);
              }
            } else {
              toast.error("No se pudo crear el Resource en la agenda");
            }
          } catch {
            toast.error("Error al crear Resource");
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
        const chairName = chair?.name ?? "este sillón";
        alsoDeleteResource = await askConfirm({
          title: `¿Eliminar "${chairName}" también de la agenda?`,
          description:
            "Confirmar elimina el sillón del layout Y del recurso de agenda (irreversible). Cancelar solo lo quita del layout y mantiene el sillón disponible en la agenda.",
          variant: "danger",
          confirmText: "Eliminar de ambos",
          cancelText: "Solo del layout",
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
            toast.success("Sillón eliminado del layout y de la agenda");
          } else if (res.status === 409) {
            toast.error(
              "No se pudo eliminar de la agenda: hay citas asociadas. Quitado solo del layout.",
            );
          } else {
            toast.error("No se pudo eliminar de la agenda. Quitado solo del layout.");
          }
        } catch {
          toast.error("Error al eliminar Resource. Quitado solo del layout.");
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

      if (panMode) {
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          px: panOffset.x,
          py: panOffset.y,
        };
        return;
      }
      // Click sobre el fondo deselecciona (solo con tool select).
      const target = e.target as Element;
      if (!target.closest("[data-element-id]")) {
        setSelectedId(null);
      }
    },
    [panMode, dragType, panOffset.x, panOffset.y],
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
        }
        moveStartRef.current = null;
        setMovingId(null);
        setMovingPosition(null);
        markDirty();
      }
    },
    [panMode, movingId, movingPosition, markDirty],
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
    [panMode, dragType, elements, eventToGrid],
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

  const ox = ORIG_X + panOffset.x;
  const oy = ORIG_Y + panOffset.y;

  /* ─── Helpers de render del canvas ─── */
  const renderGrid = () => {
    const cells: React.ReactElement[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const A = toScreen(c, r, ox, oy);
        const B = toScreen(c + 1, r, ox, oy);
        const Cc = toScreen(c + 1, r + 1, ox, oy);
        const D = toScreen(c, r + 1, ox, oy);
        // Fill via CSS class para que dark mode pueda swap-ear los colores
        // sin tocar el JSX. Inline `fill` ganaba a la regla CSS y dejaba
        // el grid blanco en dark mode.
        const tileClass = (c + r) % 2 === 0 ? styles.tileA : styles.tileB;
        cells.push(
          <polygon
            key={`t-${c}-${r}`}
            className={`${styles.tile} ${tileClass}`}
            points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${Cc[0]},${Cc[1]} ${D[0]},${D[1]}`}
          />,
        );
      }
    }
    return cells;
  };

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
      const isSel = el.id === selectedId;
      const chair = el.resourceId ? liveChairs.find((c) => c.id === el.resourceId) : null;
      const labelText = td.isChair ? chair?.name ?? el.name ?? "Consultorio" : null;
      return (
        <g
          key={el.id}
          data-element-id={el.id}
          className={isMoving ? styles.elementMoving : undefined}
          onMouseDown={(e) => onElementMouseDown(e, el.id)}
          style={{ cursor: panMode ? "inherit" : "move" }}
          transform={el.rotation !== 0 ? `rotate(${el.rotation} ${sx} ${sy})` : undefined}
        >
          <g dangerouslySetInnerHTML={{ __html: td.draw(sx, sy) }} />
          {labelText && (
            <text x={sx + 20} y={sy - 64} className={styles.chairLabel} textAnchor="middle">
              {labelText}
            </text>
          )}
          {isSel && (
            <rect
              x={sx - 10}
              y={sy - 88}
              width={(td.w + 0.5) * ISO_C * 1.2}
              height={(td.h + 1) * ISO_C}
              className={styles.elementSelected}
              fill="none"
              pointerEvents="none"
              rx={4}
            />
          )}
        </g>
      );
    });
  };

  const renderGhost = () => {
    if (!dragType || !dragGhost) return null;
    const td = catalog.byKey.get(dragType);
    if (!td) return null;
    const [sx, sy] = toScreen(dragGhost.col, dragGhost.row, ox, oy);
    return (
      <g
        className={styles.ghostElement}
        dangerouslySetInnerHTML={{ __html: td.draw(sx, sy) }}
      />
    );
  };

  /* ─── Renders ─── */

  // Welcome prompt cuando no hay layout previo (clínica nueva).
  if (!welcomeDismissed) {
    return (
      <>
        <div className={styles.mobileBlock}>
          <div className={styles.mobileBlockIcon}>
            <Monitor size={32} aria-hidden />
          </div>
          <h1>Abre en una computadora</h1>
          <p>El editor requiere ≥ 1024 px de ancho.</p>
        </div>
        <div className={styles.welcomeWrap}>
          <WelcomePrompt
            onLoaded={(data) => {
              const els = data.elements as LayoutElement[];
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
      <div className={styles.mobileBlock}>
        <div className={styles.mobileBlockIcon}>
          <Monitor size={32} aria-hidden />
        </div>
        <h1>Abre en una computadora</h1>
        <p>
          El editor visual de Mi Clínica Visual requiere una pantalla amplia
          (≥ 1024 px) para arrastrar elementos con precisión. Vuelve a entrar
          desde tu computadora.
        </p>
      </div>

      <div className={styles.page}>
        {/* ── Topbar ── */}
        <div className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}><Building2 size={16} aria-hidden /></span>
            <span className={styles.brandText}>MediFlow</span>
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
              Edición
            </button>
            <button
              type="button"
              className={`${styles.modeBtn} ${liveMode ? styles.modeBtnActiveLive : ""}`}
              onClick={() => setLiveMode(true)}
              aria-pressed={liveMode}
            >
              En Vivo
            </button>
          </div>

          {liveMode && <LiveClock />}
          {liveMode && liveConfig.enabled && liveConfig.slug && (
            <Link
              href={`/live/${liveConfig.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.toolbarBtn}
              title="Abrir vista pública en nueva pestaña"
            >
              <ExternalLink size={13} aria-hidden /> {liveConfig.slug}
            </Link>
          )}
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={() => setShareOpen(true)}
            title="Compartir vista en vivo"
          >
            <Share2 size={13} aria-hidden /> Compartir
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
              ? "Guardando…"
              : saveState === "pending"
              ? "Cambios sin guardar"
              : saveState === "error"
              ? "Error al guardar"
              : savedAgo
              ? `Guardado ${savedAgo}`
              : "Sin cambios"}
          </span>

          {!liveMode && (
            <>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={undo}
                disabled={history.length <= 1}
                title="Deshacer (⌘Z)"
              >
                <Undo2 size={13} aria-hidden /> Deshacer
              </button>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={() => setZoom((z) => Math.max(0.4, z / 1.1))}
                title="Zoom -"
              >
                <ZoomOut size={13} aria-hidden />
              </button>
              <span className={styles.zoomPercent}>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={() => setZoom((z) => Math.min(2.2, z * 1.1))}
                title="Zoom +"
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
                title="Restablecer 1:1"
              >
                <Maximize2 size={13} aria-hidden /> 1:1
              </button>
              <div
                className={styles.toolToggleGroup}
                role="group"
                aria-label="Herramienta activa"
              >
                <button
                  type="button"
                  className={`${styles.toolToggleBtn} ${!panMode ? styles.toolToggleBtnActive : ""}`}
                  onClick={() => setPanMode(false)}
                  aria-pressed={!panMode}
                  title="Seleccionar (V)"
                >
                  <MousePointer2 size={13} aria-hidden />
                  <kbd>V</kbd>
                </button>
                <button
                  type="button"
                  className={`${styles.toolToggleBtn} ${panMode ? styles.toolToggleBtnActive : ""}`}
                  onClick={() => setPanMode(true)}
                  aria-pressed={panMode}
                  title="Mano / Pan (H)"
                >
                  <Hand size={13} aria-hidden />
                  <kbd>H</kbd>
                </button>
              </div>

              <span className={styles.kbdHint}>
                <kbd>R</kbd> rota · <kbd>Del</kbd> borra · <kbd>⌘Z</kbd> deshacer
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
            <strong>Modo En Vivo</strong>
            Edición desactivada — vuelve a Edición para cambiar el layout.
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
                  {group.types.map((t) => {
                    const placedChairs = t.isChair
                      ? elements.filter((e) => e.type === t.key && e.resourceId).length
                      : 0;
                    const totalChairs = t.isChair ? liveChairs.length : 0;
                    return (
                      <div
                        key={t.key}
                        className={styles.elementCard}
                        onMouseDown={() => onSidebarMouseDown(t.key)}
                        title={t.label}
                      >
                        <svg width="40" height="40" viewBox="0 0 40 40">
                          <g dangerouslySetInnerHTML={{ __html: t.icon }} />
                        </svg>
                        <span className={styles.elementCardLabel}>{t.label}</span>
                        {t.isChair && totalChairs > 0 && (
                          <span className={styles.elementCardChairCount}>
                            {placedChairs}/{totalChairs}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* ── Canvas + (Timeline si liveMode) ── */}
        <div
          className={styles.canvasWrap}
          data-pan-mode={panMode && !liveMode ? "true" : "false"}
          data-panning={panStartRef.current ? "true" : "false"}
          style={
            liveMode
              ? { display: "grid", gridTemplateRows: "1fr 180px" }
              : undefined
          }
        >
          <svg
            ref={svgRef}
            className={styles.svgRoot}
            viewBox="0 0 1920 1080"
            preserveAspectRatio="xMidYMid meet"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            onMouseDown={onSvgMouseDown}
            onMouseMove={onSvgMouseMove}
            onMouseUp={onSvgMouseUp}
            onMouseLeave={cancelMoveOrPan}
            onWheel={onSvgWheel}
          >
            <g>{renderGrid()}</g>
            <g>{renderElements()}</g>
            <g>{renderGhost()}</g>
            {liveMode && (
              <LiveOverlay
                elements={elements}
                ox={ox}
                oy={oy}
                viewTime={viewTime}
                appointments={appointments}
                showFullNames={clinic.liveModeShowPatientNames}
                onHover={setHover}
              />
            )}
          </svg>
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
        <LiveTooltip data={hover} />

        {shareOpen && (
          <SharePanel
            initial={liveConfig}
            clinicName={clinic.name}
            onClose={() => setShareOpen(false)}
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
                <strong>Selecciona un elemento</strong>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Arrastra desde la paleta o haz click en un elemento del canvas.
                </div>
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
                  <div className={styles.propTypePreviewMeta}>Elemento #{selectedElement.id}</div>
                </div>
              </div>

              {selectedType.isChair && (
                <div className={styles.propGroup}>
                  <div className={styles.propLabel}>Sillón asignado</div>
                  <select
                    className={styles.propChairSelect}
                    value={selectedElement.resourceId ?? ""}
                    onChange={(e) =>
                      updateElement(selectedElement.id, {
                        resourceId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">— Sin asignar —</option>
                    {availableChairs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className={styles.propChairHint}>
                    {liveChairs.length === 0 ? (
                      <>No hay sillones registrados. <a href="/dashboard/team">Crea uno en Equipo →</a></>
                    ) : (
                      <>El sillón conecta este elemento con la agenda en modo En Vivo.</>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.propGroup}>
                <div className={styles.propLabel}>Posición</div>
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
                <div className={styles.propLabel}>Rotación</div>
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
                <div className={styles.propLabel}>Atajos</div>
                <ul className={styles.propKbdList}>
                  <li className={styles.propKbdRow}><span>Rotar</span><code>R</code></li>
                  <li className={styles.propKbdRow}><span>Eliminar</span><code>Del</code></li>
                  <li className={styles.propKbdRow}><span>Duplicar</span><code>⌘D</code></li>
                  <li className={styles.propKbdRow}><span>Deshacer</span><code>⌘Z</code></li>
                  <li className={styles.propKbdRow}><span>Pan</span><code>H</code></li>
                </ul>
              </div>

              <button
                type="button"
                className={styles.propDeleteBtn}
                onClick={() => deleteElement(selectedElement.id)}
              >
                <Trash2 size={13} aria-hidden /> Eliminar elemento
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
