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
} from "lucide-react";
import toast from "react-hot-toast";
import { toScreen, fromScreen, C as ISO_C } from "@/lib/floor-plan/iso";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import type {
  ElementType,
  LayoutElement,
  LayoutMetadata,
  Rotation,
} from "@/lib/floor-plan/elements";
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

  const nextIdRef = useRef<number>(
    Math.max(0, ...initialElements.map((e) => e.id)) + 1,
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const moveStartRef = useRef<{ id: number; col: number; row: number; mx: number; my: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

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

  /* ─── Acciones sobre elementos ─── */

  const addElement = useCallback(
    (type: string, col: number, row: number) => {
      const td = catalog.byKey.get(type);
      if (!td) return;
      const id = nextIdRef.current++;
      const elem: LayoutElement = {
        id,
        type,
        col,
        row,
        rotation: 0,
        resourceId: null,
        name: td.isChair ? "Consultorio" : null,
      };
      const snap = elements;
      const next = [...snap, elem];
      pushHistory(snap);
      setElements(next);
      setSelectedId(id);
      markDirty();
    },
    [catalog, elements, pushHistory, markDirty],
  );

  const updateElement = useCallback(
    (id: number, patch: Partial<LayoutElement>) => {
      const snap = elements;
      const next = snap.map((e) => (e.id === id ? { ...e, ...patch } : e));
      pushHistory(snap);
      setElements(next);
      markDirty();
    },
    [elements, pushHistory, markDirty],
  );

  const deleteElement = useCallback(
    (id: number) => {
      const snap = elements;
      const next = snap.filter((e) => e.id !== id);
      pushHistory(snap);
      setElements(next);
      if (selectedId === id) setSelectedId(null);
      markDirty();
    },
    [elements, selectedId, pushHistory, markDirty],
  );

  const duplicateElement = useCallback(
    (id: number) => {
      const orig = elements.find((e) => e.id === id);
      if (!orig) return;
      const newId = nextIdRef.current++;
      const dup: LayoutElement = {
        ...orig,
        id: newId,
        col: orig.col + 2,
        row: orig.row + 2,
        // Duplicar un sillón NO comparte el resourceId — quien lo duplica
        // debe asignar otro Resource manualmente.
        resourceId: null,
      };
      pushHistory(elements);
      setElements([...elements, dup]);
      setSelectedId(newId);
      markDirty();
    },
    [elements, pushHistory, markDirty],
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
        setDragType(null);
        setPanMode(false);
        return;
      }
      if (e.key === "h" || e.key === "H") {
        setPanMode((v) => !v);
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
  }, [selectedId, elements, undo, duplicateElement, deleteElement, updateElement]);

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
      if (panMode) {
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          px: panOffset.x,
          py: panOffset.y,
        };
        return;
      }
      // Click sobre el fondo deselecciona.
      const target = e.target as Element;
      if (!target.closest("[data-element-id]")) {
        setSelectedId(null);
      }
    },
    [panMode, panOffset.x, panOffset.y],
  );

  const onSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (panMode && panStartRef.current) {
        const dx = (e.clientX - panStartRef.current.x) / zoom;
        const dy = (e.clientY - panStartRef.current.y) / zoom;
        setPanOffset({
          x: panStartRef.current.px + dx,
          y: panStartRef.current.py + dy,
        });
        return;
      }
      if (dragType) {
        const g = eventToGrid(e.clientX, e.clientY);
        if (g) setDragGhost({ col: g.col, row: g.row });
        return;
      }
      if (movingId !== null && moveStartRef.current) {
        const g = eventToGrid(e.clientX, e.clientY);
        if (!g) return;
        const dx = g.col - moveStartRef.current.mx;
        const dy = g.row - moveStartRef.current.my;
        const nc = moveStartRef.current.col + dx;
        const nr = moveStartRef.current.row + dy;
        setElements((prev) =>
          prev.map((el) => (el.id === movingId ? { ...el, col: nc, row: nr } : el)),
        );
      }
    },
    [panMode, dragType, eventToGrid, movingId, zoom],
  );

  const onSvgMouseUp = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (panMode && panStartRef.current) {
        panStartRef.current = null;
        markDirty();
        return;
      }
      if (dragType) {
        const g = eventToGrid(e.clientX, e.clientY);
        if (g && g.col >= 0 && g.row >= 0 && g.col < GRID_COLS && g.row < GRID_ROWS) {
          addElement(dragType, g.col, g.row);
        }
        setDragType(null);
        setDragGhost(null);
        return;
      }
      if (movingId !== null) {
        moveStartRef.current = null;
        setMovingId(null);
        markDirty();
      }
    },
    [panMode, dragType, eventToGrid, addElement, movingId, markDirty],
  );

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
      chairs.filter(
        (c) =>
          !usedChairIds.has(c.id) ||
          (selectedElement?.resourceId && selectedElement.resourceId === c.id),
      ),
    [chairs, usedChairIds, selectedElement],
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
        const fill = (c + r) % 2 === 0 ? "rgba(255,255,255,0.4)" : "rgba(232,244,250,0.3)";
        cells.push(
          <polygon
            key={`t-${c}-${r}`}
            className={styles.tile}
            points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${Cc[0]},${Cc[1]} ${D[0]},${D[1]}`}
            fill={fill}
          />,
        );
      }
    }
    return cells;
  };

  const renderElements = () => {
    return elements
      .slice()
      .sort((a, b) => a.col + a.row - (b.col + b.row)) // back-to-front por suma col+row
      .map((el) => {
        const td = catalog.byKey.get(el.type);
        if (!td) return null;
        const [sx, sy] = toScreen(el.col, el.row, ox, oy);
        const isSel = el.id === selectedId;
        const isMoving = el.id === movingId;
        const chair = el.resourceId ? chairs.find((c) => c.id === el.resourceId) : null;
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

          {/* Toggle Edición / En Vivo (placeholder hasta commit 4) */}
          <div className={styles.modeToggle}>
            <button
              type="button"
              className={`${styles.modeBtn} ${styles.modeBtnActive}`}
              disabled
            >
              Edición
            </button>
            <button type="button" className={styles.modeBtn} disabled title="Disponible en commit 4">
              En Vivo
            </button>
          </div>

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
          <button
            type="button"
            className={`${styles.toolbarBtn} ${panMode ? styles.toolbarBtnPrimary : ""}`}
            onClick={() => setPanMode((v) => !v)}
            title="Modo manita (H)"
          >
            {panMode ? <Hand size={13} aria-hidden /> : <MousePointer2 size={13} aria-hidden />}
          </button>

          <span className={styles.kbdHint}>
            <kbd>R</kbd> rota · <kbd>Del</kbd> borra · <kbd>⌘Z</kbd> deshacer · <kbd>H</kbd> pan
          </span>
        </div>

        {/* ── Sidebar (paleta) ── */}
        <aside className={styles.sidebar}>
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
                    const totalChairs = t.isChair ? chairs.length : 0;
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

        {/* ── Canvas ── */}
        <div
          className={styles.canvasWrap}
          data-pan-mode={panMode ? "true" : "false"}
          data-panning={panStartRef.current ? "true" : "false"}
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
            onMouseLeave={onSvgMouseUp}
            onWheel={onSvgWheel}
          >
            <g>{renderGrid()}</g>
            <g>{renderElements()}</g>
            <g>{renderGhost()}</g>
          </svg>
        </div>

        {/* ── Properties panel ── */}
        <aside className={styles.propertiesPanel}>
          {!selectedElement || !selectedType ? (
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
                    {chairs.length === 0 ? (
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
