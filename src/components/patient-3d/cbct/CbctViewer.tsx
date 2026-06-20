"use client";

// ─────────────────────────────────────────────────────────────────────────────
// <CbctViewer/> — componente raíz del visor CBCT rediseñado. Portado de app.jsx
// (estado global + 3 layouts: inmersivo / modal / mpr) a TypeScript real, contra
// el contrato de ./types. La fundación (T4) deja el ARMAZÓN funcional con stubs;
// el render real, los gestos y los paneles llegan en T5/T6, y la integración en
// Models3DTab + cargador DICOM en T7.
//
// Reglas del repo: sin for...of sobre Map/Set; unión de anotaciones por `type`
// (string), no por booleano; multi-tenant respetado (la persistencia se delega a
// onGuardarHallazgos/onGuardarNota, que T7 ancla a PatientFile por paciente).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import type {
  Anno,
  AnnoPatch,
  CbctViewerProps,
  HUState,
  Layout,
  Plane,
  Setter,
  Tool,
  ViewState,
  VolState,
} from "./types";
import { PLANES, PLANE_MAX, TOOLS } from "./constants";
import { IcCube, IcCompare, IcDownload, IcClose, IcChevR, IcChevL, IcCheck, IcExpand, IcSagital, IcGrid, type CbctIcon } from "./icons";
import { Stage } from "./Stage";
import { Toolbar } from "./panels/Toolbar";
import { PlaneSwitch } from "./panels/PlaneSwitch";
import { Scrubber } from "./panels/Scrubber";
import { WindowPanel } from "./panels/WindowPanel";
import { VolumePanel } from "./panels/VolumePanel";
import { FindingsPanel } from "./panels/FindingsPanel";
import { NotesPanel } from "./panels/NotesPanel";
import { Seg } from "./panels/Seg";

const LAYOUTS: { id: Layout; label: string; Icon: CbctIcon }[] = [
  { id: "inmersivo", label: "Inmersivo", Icon: IcExpand },
  { id: "modal", label: "Ventana", Icon: IcSagital },
  { id: "mpr", label: "MPR 2×2", Icon: IcGrid },
];

const blankView = (): ViewState => ({ zoom: 1, panX: 0, panY: 0, yaw: 0 });
const ACCENT = "#2a6fdb";

export function CbctViewer({
  estudio,
  paciente,
  mmPorPixel,
  renderContent,
  initialAnnos,
  initialNotes,
  onGuardarHallazgos,
  onGuardarNota,
  onCerrar,
}: CbctViewerProps) {
  const [layout, setLayout] = useState<Layout>("inmersivo");
  const [plane, setPlane] = useState<Plane>("vol3d");
  const [tool, setTool] = useState<Tool>("cursor");
  const [views, setViews] = useState<Record<Plane, ViewState>>({
    axial: blankView(),
    coronal: blankView(),
    sagital: blankView(),
    vol3d: blankView(),
  });
  const [viewB, setViewB] = useState<ViewState>(blankView());
  const [annos, setAnnos] = useState<Anno[]>(initialAnnos ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hu, setHu] = useState<HUState>({ preset: "hueso", brillo: 46, contraste: 78 });
  const [vol, setVol] = useState<VolState>({ mode: "solido", umbral: 62 });
  const [slices, setSlices] = useState<Record<Plane, number>>({ axial: 256, coronal: 256, sagital: 335, vol3d: 1 });
  const [sliceB, setSliceB] = useState<number>(360);
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [saved, setSaved] = useState<boolean>(false);
  const [rightOpen, setRightOpen] = useState<boolean>(true);
  const [compare, setCompare] = useState<boolean>(false);
  const [focusPlane, setFocusPlane] = useState<Plane>("vol3d");
  const [flash, setFlash] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHint, setShowHint] = useState<boolean>(true);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMount = useRef(false);
  // Persistencia de hallazgos (T7): debounce + flush al desmontar. El handler y
  // los annos van por ref para no reiniciar el temporizador por cambios de
  // identidad y para flushear la última edición pendiente.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annosRef = useRef<Anno[]>(annos);
  annosRef.current = annos;
  const dirtyRef = useRef(false);
  const onGuardarHallazgosRef = useRef(onGuardarHallazgos);
  onGuardarHallazgosRef.current = onGuardarHallazgos;

  // ── Anotaciones (ops del §3) ─────────────────────────────────────────────
  const addAnno = (a: Anno) => {
    setAnnos((p) => [...p, a]);
    setSelectedId(a.id);
  };
  const updateAnno = (id: string, patch: AnnoPatch | ((a: Anno) => Anno)) =>
    setAnnos((p) =>
      p.map((a) => {
        if (a.id !== id) return a;
        return typeof patch === "function" ? patch(a) : ({ ...a, ...patch } as Anno);
      }),
    );
  const removeAnno = (id: string) => {
    setAnnos((p) => p.filter((a) => a.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };
  const undo = () => setAnnos((p) => p.slice(0, -1));
  const clearAll = () => {
    if (annos.length && typeof window !== "undefined" && !window.confirm("¿Eliminar todas las mediciones y marcas?")) return;
    setAnnos([]);
    setSelectedId(null);
  };
  const renameAnno = (id: string, label: string) => updateAnno(id, { label });

  // ── Toast + captura + guardado ────────────────────────────────────────────
  const showToast = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };
  const shot = () => {
    // TODO(T5/T7): captura real (canvas.toBlob del lienzo + overlay → expediente).
    setFlash(true);
    setTimeout(() => setFlash(false), 320);
    showToast("Captura guardada en el estudio");
  };
  const saveNotes = async () => {
    try {
      await onGuardarNota(notes);
      setSaved(true);
      showToast("Notas guardadas");
      setTimeout(() => setSaved(false), 1600);
    } catch {
      showToast("No se pudo guardar la nota");
    }
  };

  // Persistencia de hallazgos (T7): debounce 800ms al cambiar `annos` (tras el
  // montaje) + aviso de error visible. El primer render (montaje) no guarda.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      dirtyRef.current = false;
      Promise.resolve(onGuardarHallazgosRef.current(annosRef.current)).catch(() =>
        showToast("No se pudieron guardar los hallazgos"),
      );
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annos]);

  // Flush al desmontar: no perder la última edición pendiente del debounce.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirtyRef.current) {
        dirtyRef.current = false;
        Promise.resolve(onGuardarHallazgosRef.current(annosRef.current)).catch(() => {});
      }
    },
    [],
  );

  // limpia el timer del toast al desmontar
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // hint de herramienta: aparece al cambiar de tool y se desvanece a los ~5s
  useEffect(() => {
    setShowHint(true);
    const t = setTimeout(() => setShowHint(false), 5200);
    return () => clearTimeout(t);
  }, [tool]);

  // ── Setters por plano ─────────────────────────────────────────────────────
  const setViewFor = (pl: Plane): Setter<ViewState> => (next) =>
    setViews((v) => ({ ...v, [pl]: typeof next === "function" ? (next as (p: ViewState) => ViewState)(v[pl]) : next }));
  const resetView = (pl: Plane) => setViews((v) => ({ ...v, [pl]: blankView() }));
  const setZoomFor = (pl: Plane): Setter<number> => (next) =>
    setViewFor(pl)((v) => ({ ...v, zoom: typeof next === "function" ? (next as (z: number) => number)(v.zoom) : next }));

  const activeTool = TOOLS_BY_ID[tool];

  // fábrica de Stage acotada
  const makeStage = (
    pl: Plane,
    opts: { viewB?: boolean; compact?: boolean; focused?: boolean; onFocus?: () => void } = {},
  ) => (
    <Stage
      plane={pl}
      view={opts.viewB ? viewB : views[pl]}
      setView={opts.viewB ? setViewB : setViewFor(pl)}
      tool={tool}
      annos={annos}
      selectedId={selectedId}
      onSelect={setSelectedId}
      addAnno={addAnno}
      updateAnno={updateAnno}
      hu={hu}
      vol={vol}
      sliceIndex={opts.viewB ? sliceB : slices[pl]}
      planeLabel={(PLANES.find((p) => p.id === pl) || { label: "" }).label}
      mmPorPixel={mmPorPixel}
      renderContent={renderContent}
      compact={opts.compact}
      focused={opts.focused}
      onFocus={opts.onFocus}
    />
  );

  // ── Chrome ────────────────────────────────────────────────────────────────
  const header = (
    <div className="vc-header" style={styles.header}>
      <div className="vc-brand" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div className="vc-brand-mark" style={styles.brandMark}>
          <IcCube />
        </div>
        <div className="vc-brand-tx" style={{ minWidth: 0 }}>
          <div className="vc-file" style={{ fontSize: 13, fontWeight: 700, color: "#e4eaf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(estudio.modalidad || "DICOM") + " · " + paciente.nombre}
          </div>
          <div className="vc-meta" style={{ fontSize: 11, color: "#7d8aa0" }}>
            {(estudio.titulo || "CBCT") +
              (estudio.numCortes ? ` · ${estudio.numCortes} cortes` : "") +
              (estudio.espaciadoMm ? ` · ${estudio.espaciadoMm} mm` : "")}
          </div>
        </div>
      </div>
      <div className="vc-header-mid" style={{ display: "flex", justifyContent: "center" }}>
        <Seg
          options={LAYOUTS.map((l) => ({ id: l.id, label: l.label, icon: <l.Icon /> }))}
          value={layout}
          onChange={(id) => setLayout(id as Layout)}
        />
      </div>
      <div className="vc-header-actions" style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        {layout !== "mpr" && (
          <button className={"vc-hbtn" + (compare ? " on" : "")} style={styles.hbtn(compare)} onClick={() => setCompare((c) => !c)} title="Comparar cortes">
            <IcCompare />
            <span>Comparar</span>
          </button>
        )}
        <button className="vc-hbtn" style={styles.hbtn(false)} onClick={shot} title="Captura">
          <IcDownload />
        </button>
        <button className="vc-hbtn close" style={styles.hbtn(false)} title="Cerrar" onClick={onCerrar}>
          <IcClose />
        </button>
      </div>
    </div>
  );

  // ── Área de stage por layout ───────────────────────────────────────────────
  let stageArea: JSX.Element;
  if (layout === "mpr") {
    stageArea = (
      <div className="vc-grid" style={styles.grid}>
        {PLANES.map((p) => (
          <div key={p.id} className={"vc-cell" + (focusPlane === p.id ? " focus" : "")} style={styles.cell}>
            {makeStage(p.id, { compact: true, focused: focusPlane === p.id, onFocus: () => setFocusPlane(p.id) })}
            <div className="vc-cell-bar" style={styles.cellBar} onPointerDown={(e) => e.stopPropagation()}>
              {p.id !== "vol3d" ? (
                <input
                  type="range"
                  min={1}
                  max={PLANE_MAX[p.id]}
                  value={slices[p.id]}
                  onChange={(e) => setSlices((s) => ({ ...s, [p.id]: Number(e.target.value) }))}
                  style={{ width: "100%", accentColor: ACCENT }}
                />
              ) : (
                <span className="vc-cell-hint" style={{ fontSize: 11, color: "#6f7c92" }}>arrastra para rotar</span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    stageArea = (
      <div className="vc-stagewrap" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 8 }}>
        {compare ? (
          <div className="vc-compare" style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, minHeight: 0 }}>
            <div className="vc-compare-col" style={{ position: "relative", minHeight: 0 }}>
              <span className="vc-compare-tag" style={styles.compareTag}>A</span>
              {makeStage(plane, {})}
            </div>
            <div className="vc-compare-col" style={{ position: "relative", minHeight: 0 }}>
              <span className="vc-compare-tag" style={styles.compareTag}>B</span>
              {makeStage(plane, { viewB: true })}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>{makeStage(plane, {})}</div>
        )}
        <Scrubber
          plane={plane}
          sliceIndex={slices[plane]}
          setSlice={(v) => setSlices((s) => ({ ...s, [plane]: v }))}
          onReset={() => resetView(plane)}
          zoom={views[plane].zoom}
          setZoom={setZoomFor(plane)}
        />
      </div>
    );
  }

  const rightPanel = (
    <div className={"vc-right" + (rightOpen ? "" : " closed")} style={styles.right(rightOpen)}>
      <button className="vc-right-toggle" style={styles.rightToggle} onClick={() => setRightOpen((o) => !o)} title={rightOpen ? "Ocultar panel" : "Mostrar panel"}>
        {rightOpen ? <IcChevR /> : <IcChevL />}
      </button>
      {rightOpen && (
        <div className="vc-right-scroll" style={{ overflowY: "auto", height: "100%" }}>
          <WindowPanel hu={hu} setHu={setHu} />
          <VolumePanel vol={vol} setVol={setVol} active={plane === "vol3d" || layout === "mpr"} />
          <FindingsPanel
            annos={annos}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRemove={removeAnno}
            onRename={renameAnno}
            onEditImplant={updateAnno}
            mmPorPixel={mmPorPixel}
          />
          <NotesPanel notes={notes} setNotes={setNotes} onSave={saveNotes} saved={saved} />
        </div>
      )}
    </div>
  );

  const planeSwitch = layout !== "mpr" && (
    <PlaneSwitch
      plane={plane}
      setPlane={(p) => {
        setPlane(p);
        setFocusPlane(p);
      }}
    />
  );

  const hintBar = showHint && activeTool && (
    <div className="vc-hint" key={tool} style={styles.hint}>
      <activeTool.Icon />
      <span>{activeTool.hint}</span>
    </div>
  );

  const inner = (
    <div className={"vc-body layout-" + layout} style={styles.body}>
      <div className="vc-rail" style={styles.rail}>
        <Toolbar tool={tool} setTool={setTool} orientation="v" onUndo={undo} canUndo={annos.length > 0} onClear={clearAll} onShot={shot} />
      </div>
      <div className="vc-main" style={styles.main}>
        <div className="vc-main-top" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {planeSwitch}
          {hintBar}
        </div>
        {stageArea}
      </div>
      {rightPanel}
      {flash && <div className="vc-flash" style={styles.flash} />}
      {toast && (
        <div className="vc-toast" style={styles.toast}>
          <IcCheck />
          {toast}
        </div>
      )}
    </div>
  );

  if (layout === "modal") {
    return (
      <div className="vc-app theme-clinic" style={appStyle}>
        <div className="vc-modal-backdrop" style={styles.modalBackdrop}>
          <div className="vc-modal" style={styles.modal}>
            {header}
            {inner}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vc-app theme-clinic" style={appStyle}>
      {header}
      {inner}
    </div>
  );
}

export default CbctViewer;

// ── Variables de tema + estilos del armazón ──────────────────────────────────
// La fundación trae estilos inline mínimos para ver el armazón. T5/T6 portan
// visor.css real (clases vc-*) alineado a los tokens de DaleControl.
const appStyle = {
  ["--accent"]: ACCENT,
  ["--accent-soft"]: "rgba(42,111,219,.17)",
  display: "flex",
  flexDirection: "column",
  minHeight: 560,
  height: "100%",
  background: "#0a0e14",
  color: "#dbe3ee",
  fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
} as unknown as React.CSSProperties;

const styles = {
  header: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid #161d27",
    background: "#0c1118",
  } as React.CSSProperties,
  brandMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: 9,
    background: "var(--accent-soft, rgba(42,111,219,.17))",
    color: "var(--accent, #2a6fdb)",
    flex: "0 0 auto",
  } as React.CSSProperties,
  hbtn: (on: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid " + (on ? "var(--accent, #2a6fdb)" : "#1e2733"),
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    color: on ? "#fff" : "#aeb9cc",
    background: on ? "var(--accent-soft, rgba(42,111,219,.17))" : "transparent",
  }),
  body: { flex: 1, display: "flex", minHeight: 0, position: "relative" } as React.CSSProperties,
  rail: { flex: "0 0 auto", borderRight: "1px solid #161d27", background: "#0c1118" } as React.CSSProperties,
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, gap: 10, padding: 12 } as React.CSSProperties,
  right: (open: boolean): React.CSSProperties => ({
    position: "relative",
    flex: "0 0 auto",
    width: open ? 300 : 22,
    borderLeft: "1px solid #161d27",
    background: "#0c1118",
    transition: "width .18s ease",
  }),
  rightToggle: {
    position: "absolute",
    left: -14,
    top: 12,
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px solid #1e2733",
    background: "#0e141d",
    color: "#9aa7bd",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  } as React.CSSProperties,
  grid: { flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 8, minHeight: 0 } as React.CSSProperties,
  cell: { position: "relative", display: "flex", flexDirection: "column", minHeight: 0, gap: 6 } as React.CSSProperties,
  cellBar: { flex: "0 0 auto", display: "flex", alignItems: "center", minHeight: 28 } as React.CSSProperties,
  compareTag: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 2,
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    background: "var(--accent, #2a6fdb)",
    borderRadius: 6,
    padding: "1px 7px",
  } as React.CSSProperties,
  hint: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#9aa7bd",
    background: "#0e141d",
    border: "1px solid #1e2733",
    borderRadius: 999,
    padding: "5px 12px",
  } as React.CSSProperties,
  flash: { position: "absolute", inset: 0, background: "#fff", opacity: 0.7, pointerEvents: "none", animation: "none" } as React.CSSProperties,
  toast: {
    position: "absolute",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#fff",
    background: "#1f8a5b",
    borderRadius: 10,
    padding: "8px 14px",
    boxShadow: "0 8px 24px rgba(0,0,0,.4)",
    zIndex: 5,
  } as React.CSSProperties,
  modalBackdrop: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "rgba(0,0,0,.55)",
  } as React.CSSProperties,
  modal: {
    display: "flex",
    flexDirection: "column",
    width: "min(1100px, 96vw)",
    height: "min(740px, 92vh)",
    background: "#0a0e14",
    border: "1px solid #1e2733",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 30px 80px rgba(0,0,0,.5)",
  } as React.CSSProperties,
};

// Índice id→herramienta para el hint (evita recalcular en cada render con find).
const TOOLS_BY_ID: Record<string, (typeof TOOLS)[number]> = TOOLS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, (typeof TOOLS)[number]>,
);
