/**
 * Tipos compartidos para el editor de layout isométrico.
 *
 * Decisión de arquitectura (1 source of truth con la agenda):
 *   Sillones del layout SON Resources (kind=CHAIR) existentes. El elemento
 *   `chair` en `LayoutElement[]` referencia un Resource via `resourceId`. El
 *   editor solo coloca/posiciona; no crea sillones nuevos. Los Resources se
 *   gestionan en /dashboard/team o donde corresponda.
 *
 *   Para tipos no-sillón (paredes, lavabos, mobiliario), `resourceId` queda
 *   undefined y el `id` es local al layout.
 */

export type Rotation = 0 | 90 | 180 | 270;

export type ElementCategoryGroup =
  | "estructura"
  | "dental"
  | "recepcion"
  | "mobiliario"
  | "bano";

/** Definición estática del catálogo (geometría isométrica + icono SVG). */
export interface ElementType {
  /** ID único del tipo (e.g. "sillon", "wall_h"). */
  key: string;
  /** Nombre legible para sidebar/properties. */
  label: string;
  /** Grupo de categoría (en el sidebar del editor). */
  category: ElementCategoryGroup;
  /** Ancho en unidades de columna del grid. */
  w: number;
  /** Profundidad en unidades de fila del grid. */
  h: number;
  /** Función que produce el SVG del elemento posicionado en (ox, oy). */
  draw: (ox: number, oy: number) => string;
  /** SVG inline 40×40 para el sidebar y previews. */
  icon: string;
  /** Si true, este tipo solo puede instanciarse 1 vez por Resource(kind=CHAIR). */
  isChair?: boolean;
}

/** Instancia colocada en el canvas. Se persiste como JSON en ClinicLayout.elements. */
export interface LayoutElement {
  /** ID local al layout (number autoincrement) o cuid si la UI lo prefiere. */
  id: number;
  /** Key del ElementType. */
  type: string;
  /** Posición en grid. */
  col: number;
  row: number;
  /** Rotación 0/90/180/270. */
  rotation: Rotation;
  /** Para sillones: ID estable del Resource(kind=CHAIR). Conecta con appointments. */
  resourceId?: string | null;
  /** Etiqueta libre (ej. "Consultorio 1"). Solo informativa; el nombre real
   *  del sillón vive en Resource.name para los sillones. */
  name?: string | null;
}

/** Estado del editor que se guarda en ClinicLayout.metadata. */
export interface LayoutMetadata {
  zoom?: number;
  panOffset?: { x: number; y: number };
  lastEditAt?: string;
  gridSize?: { cols: number; rows: number };
}

/** Categoría del sidebar (un grupo + sus tipos disponibles). */
export interface CategoryGroup {
  id: ElementCategoryGroup;
  label: string;
  types: ElementType[];
}

/** Estados del modo En Vivo — coloreados por sillón. */
export type ChairStatus = "libre" | "proximo" | "ocupado";

export const STATUS_COLORS: Record<ChairStatus, string> = {
  libre: "#10B981",
  proximo: "#F59E0B",
  ocupado: "#EF4444",
};

export const STATUS_LABELS: Record<ChairStatus, string> = {
  libre: "Libre",
  proximo: "Próxima cita",
  ocupado: "Ocupado",
};

/** Status de Appointment relevante al modo En Vivo. */
export type LiveApptStatus =
  | "PENDING"
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

/** Cita normalizada para el modo En Vivo. */
export interface LiveAppointment {
  id: string;
  /** ID del Resource(kind=CHAIR) asociado. Match con LayoutElement.resourceId. */
  resourceId: string | null;
  /** Nombre del paciente — completo o iniciales según privacy. */
  patient: string;
  patientFull?: string;
  treatment: string;
  doctor: string;
  start: Date;
  end: Date;
  /** Estado del workflow. Decisivo para getChairStatus. */
  status?: LiveApptStatus;
}
