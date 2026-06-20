// ─────────────────────────────────────────────────────────────────────────────
// VISOR CBCT REDISEÑADO — CONTRATO ÚNICO (tipos públicos).
//
// Este archivo es EL CONTRATO entre la fundación (T4) y las olas siguientes:
//   · T5 implementa Stage (render + gestos + captura de puntos) y Scrubber/Toolbar.
//   · T6 implementa los paneles (Window/Volume/Findings/Notes).
//   · T7 conecta el cargador DICOM real y persiste contra PatientFile.
// No depende de three ni de React-DOM; solo de tipos de React para los props.
//
// Modelo portado de _design_odontograma/.../INTEGRACION.md (§3 estado, §4
// anotaciones) a TypeScript real. Coordenadas de anotación SIEMPRE normalizadas
// 0..1 respecto a la caja de imagen (sobreviven a zoom/pan y a cualquier tamaño).
//
// Reglas del repo respetadas: tsconfig NO strict y SIN target ES2015 → uniones
// discriminadas por STRING (campo `type`), nunca por booleano; nada de for...of
// sobre Map/Set en los consumidores.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";

// ── Enumeraciones base (§3) ──────────────────────────────────────────────────

/** Disposición de la interfaz. */
export type Layout = "inmersivo" | "modal" | "mpr";

/** Plano/vista activa. `vol3d` = render de volumen 3D. */
export type Plane = "axial" | "coronal" | "sagital" | "vol3d";

/** Herramienta activa del rail. `cursor`=navegar, `lupa`=magnificador transitorio. */
export type Tool =
  | "cursor"
  | "distancia"
  | "angulo"
  | "anotacion"
  | "canal"
  | "implante"
  | "lupa";

// ── Geometría / estado de vista (§3) ─────────────────────────────────────────

/** Punto NORMALIZADO 0..1 dentro de la caja de imagen. */
export interface Pt {
  x: number;
  y: number;
}

/** Estado de cámara por plano. `yaw` solo aplica al volumen 3D (rotación). */
export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  yaw: number;
}

/** Ventana de densidad (HU): preset + ajuste fino de brillo/contraste (0..100). */
export interface HUState {
  /** id de un HU_PRESETS (constants.ts): "hueso"|"dientes"|"blando"|"seno". */
  preset: string;
  brillo: number;
  contraste: number;
}

/** Render de volumen: modo y umbral (0..100). */
export interface VolState {
  mode: "solido" | "mip";
  umbral: number;
}

// ── Anotaciones (§4) — unión discriminada por `type` (string) ────────────────
// Todas comparten { id, type, plane }. Coordenadas normalizadas 0..1.

export interface AnnoBase {
  /** id estable (geometry.uid()). */
  id: string;
  /** plano donde vive la anotación. */
  plane: Plane;
}

/** Medición de distancia: 2 puntos → mm vía mmBetween(escala del plano). */
export interface AnnoDistancia extends AnnoBase {
  type: "distancia";
  points: [Pt, Pt];
}

/** Ángulo: [lado, vértice, lado] → grados vía angleAt. */
export interface AnnoAngulo extends AnnoBase {
  type: "angulo";
  points: [Pt, Pt, Pt];
}

/** Nota clínica anclada a un punto, con etiqueta editable. */
export interface AnnoAnotacion extends AnnoBase {
  type: "anotacion";
  points: [Pt];
  label: string;
}

/** Trazado de conducto dentario: spline multipunto, con etiqueta. */
export interface AnnoCanal extends AnnoBase {
  type: "canal";
  points: Pt[];
  label: string;
}

/** Planificación de implante: posición + ángulo y dimensiones normalizadas. */
export interface AnnoImplante extends AnnoBase {
  type: "implante";
  p: Pt;
  /** ángulo del tornillo en grados (0 = vertical). */
  angle: number;
  /** longitud como fracción del alto de la caja (0..1). */
  length01: number;
  /** diámetro como fracción del ancho de la caja (0..1). */
  diam01: number;
}

export type Anno =
  | AnnoDistancia
  | AnnoAngulo
  | AnnoAnotacion
  | AnnoCanal
  | AnnoImplante;

/** Discriminante de Anno. */
export type AnnoType = Anno["type"];

/**
 * Parche para updateAnno. Conjunto plano de los campos editables de CUALQUIER
 * Anno (evita Partial<Anno>, que sobre una unión solo deja los campos comunes).
 * Para cambios estructurales (p.ej. empujar un punto al canal) usa la forma de
 * función `(a) => Anno`.
 */
export interface AnnoPatch {
  label?: string;
  angle?: number;
  length01?: number;
  diam01?: number;
  points?: Pt[];
  p?: Pt;
  plane?: Plane;
}

// ── Helper de setters estilo React (valor o updater) ─────────────────────────
export type Setter<T> = (next: T | ((prev: T) => T)) => void;

// ── Entrada del componente raíz ──────────────────────────────────────────────

/** Paciente dueño del estudio (multi-tenant: el id ancla la persistencia). */
export interface CbctPaciente {
  id: string;
  nombre: string;
}

/** Metadatos del estudio CBCT (para el header y la persistencia). */
export interface CbctEstudio {
  id: string;
  /** PatientFile.id contra el que persiste T7 (annotations / doctorNotes). */
  fileId?: string | null;
  /** p.ej. "CBCT maxilofacial". */
  titulo?: string;
  /** p.ej. "DICOM" / "CBCT". */
  modalidad?: string;
  /** número de cortes del set (para el header). */
  numCortes?: number;
  /** espaciado nominal en mm (para el header), p.ej. 0.30. */
  espaciadoMm?: number;
  fechaISO?: string;
}

/**
 * Firma del render REAL del corte/volumen, inyectable desde el cargador DICOM
 * (T7). La COMPARTEN <CbctViewer/> (que la recibe y la baja a cada Stage) y
 * StageProps (que la invoca). El render debe rellenar la caja de imagen al
 * 100%×100% y ser PURO: el Stage lo llama más de una vez por render (contenido
 * del recuadro + duplicado dentro de la lupa).
 */
export type RenderContent = (args: {
  plane: Plane;
  sliceIndex: number;
  view: ViewState;
  hu: HUState;
  vol: VolState;
}) => ReactNode;

/**
 * Props del componente raíz <CbctViewer/>.
 *
 * `mmPorPixel`: escala REAL por plano para convertir distancias normalizadas a
 * milímetros. Por compatibilidad con el doc de diseño se llama "mmPorPixel",
 * pero el VALOR es "mm que abarca el ancho normalizado completo (0→1) del
 * plano" (= cols × PixelSpacing.x, etc.). Lo deriva el cargador real (T7) de las
 * cabeceras DICOM (ver DecodedSlice.pixelSpacing en dicom-decode-core.ts) y
 * reemplaza el FOV_MM fijo del prototipo (§5). geometry.mmBetween(a,b,escala) lo
 * usa tal cual.
 */
export interface CbctViewerProps {
  estudio: CbctEstudio;
  paciente: CbctPaciente;
  mmPorPixel: Record<Plane, number>;
  /**
   * (T7) Render REAL del corte/volumen, que <CbctViewer/> baja a CADA Stage
   * (incluido el modo MPR 2×2 y el comparar A/B). Si se omite, el Stage usa su
   * placeholder procedural. Misma firma que StageProps.renderContent.
   */
  renderContent?: RenderContent;
  /** Anotaciones iniciales (cargadas de PatientFile.annotations por T7). */
  initialAnnos?: Anno[];
  /** Nota inicial del estudio (PatientFile.doctorNotes). */
  initialNotes?: string | null;
  /** Persistir hallazgos (anotaciones). Puede ser async. */
  onGuardarHallazgos: (a: Anno[]) => void | Promise<void>;
  /** Persistir la nota del estudio. Puede ser async. */
  onGuardarNota: (s: string) => void | Promise<void>;
  /** Cerrar el visor (vuelve al contexto que lo abrió). */
  onCerrar: () => void;
}

// ── Props de los subcomponentes (los implementan T5/T6) ──────────────────────

/**
 * Stage = UN visor (un plano). Render del corte/volumen + overlay de
 * anotaciones + gestos (pan/zoom/pinch) + captura de puntos. Implementa T5.
 */
export interface StageProps {
  plane: Plane;
  view: ViewState;
  setView: Setter<ViewState>;
  tool: Tool;
  annos: Anno[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  addAnno: (a: Anno) => void;
  updateAnno: (id: string, patch: AnnoPatch | ((a: Anno) => Anno)) => void;
  hu: HUState;
  vol: VolState;
  /** índice de corte actual (1..N); ignorado en vol3d. */
  sliceIndex: number;
  /** etiqueta legible del plano (header del cuadrante). */
  planeLabel: string;
  /** escala mm por plano (para los valores del overlay). */
  mmPorPixel: Record<Plane, number>;
  /** modo compacto (celda MPR). */
  compact?: boolean;
  /** cuadrante enfocado (MPR). */
  focused?: boolean;
  /** pedir foco de este cuadrante (MPR). */
  onFocus?: () => void;
  /**
   * (T7) Inyección del render REAL del corte/volumen. ADITIVO sobre el contrato:
   * si se provee, REEMPLAZA el placeholder procedural de T5. Lo implementa T7
   * desde el cargador DICOM (DecodedSlice → canvas/bitmap), usando los argumentos
   * para elegir corte/plano y aplicar la ventana HU / el volumen. Firma compartida
   * con CbctViewerProps.renderContent → ver RenderContent.
   */
  renderContent?: RenderContent;
}

/** Rail de herramientas (vertical u horizontal). Implementa T5. */
export interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  orientation?: "v" | "h";
  onUndo: () => void;
  canUndo: boolean;
  onClear: () => void;
  onShot: () => void;
}

/** Conmutador de plano activo (no-MPR). Implementa T5. */
export interface PlaneSwitchProps {
  plane: Plane;
  setPlane: (p: Plane) => void;
}

/** Barra inferior: corte + reset + zoom. Implementa T5. */
export interface ScrubberProps {
  plane: Plane;
  sliceIndex: number;
  setSlice: (v: number) => void;
  onReset: () => void;
  zoom: number;
  setZoom: Setter<number>;
}

/** Panel de ventana de densidad (HU). Implementa T6. */
export interface WindowPanelProps {
  hu: HUState;
  setHu: Setter<HUState>;
}

/** Panel de render de volumen. Implementa T6. */
export interface VolumePanelProps {
  vol: VolState;
  setVol: Setter<VolState>;
  /** true cuando el volumen 3D está visible (vol3d activo o layout MPR). */
  active: boolean;
}

/** Panel de hallazgos (lista de anotaciones). Implementa T6. */
export interface FindingsPanelProps {
  annos: Anno[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onEditImplant: (id: string, patch: AnnoPatch | ((a: Anno) => Anno)) => void;
  /** escala mm por plano (para mostrar valores de distancia). */
  mmPorPixel: Record<Plane, number>;
}

/** Panel de notas del estudio. Implementa T6. */
export interface NotesPanelProps {
  notes: string;
  setNotes: Setter<string>;
  onSave: () => void;
  saved: boolean;
}

// ── Helpers de UI del header ─────────────────────────────────────────────────

/** Una opción del control segmentado (selector de layout). */
export interface SegOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface SegProps {
  options: SegOption[];
  value: string;
  onChange: (id: string) => void;
}
