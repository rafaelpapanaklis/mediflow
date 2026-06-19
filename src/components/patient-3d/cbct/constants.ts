// Constantes del visor CBCT. Portado de config.jsx (los iconos pasan de
// `()=>window.IcX()` a referencias de componente ESM de ./icons).

import type { CbctIcon } from "./icons";
import {
  IcCursor,
  IcRuler,
  IcAngle,
  IcNote,
  IcNerve,
  IcImplant,
  IcLoupe,
  IcLayers,
  IcCoronal,
  IcSagital,
  IcCube,
  IcBone,
  IcTooth,
  IcSun,
  IcContrast,
} from "./icons";
import type { AnnoType, Plane, Tool } from "./types";

/** Color de cada tipo de anotación (overlay + lista de hallazgos). */
export const TOOL_COLORS: Record<AnnoType, string> = {
  distancia: "#38bdf8",
  angulo: "#c084fc",
  anotacion: "#fbbf24",
  canal: "#ff5d73",
  implante: "#34d399",
};

export interface ToolDef {
  id: Tool;
  label: string;
  hint: string;
  Icon: CbctIcon;
}

export const TOOLS: ToolDef[] = [
  { id: "cursor", label: "Navegar", hint: "Arrastra para mover · rueda/pellizco para zoom", Icon: IcCursor },
  { id: "distancia", label: "Distancia", hint: "Toca 2 puntos para medir en milímetros", Icon: IcRuler },
  { id: "angulo", label: "Ángulo", hint: "Toca 3 puntos: lado · vértice · lado", Icon: IcAngle },
  { id: "anotacion", label: "Anotación", hint: "Toca para colocar una nota clínica", Icon: IcNote },
  { id: "canal", label: "Canal nervioso", hint: "Traza el conducto punto a punto · doble toque para cerrar", Icon: IcNerve },
  { id: "implante", label: "Implante", hint: "Toca para colocar · arrastra los tiradores para ajustar", Icon: IcImplant },
  { id: "lupa", label: "Lupa", hint: "Mantén pulsado para ampliar la zona", Icon: IcLoupe },
];

export interface PlaneDef {
  id: Plane;
  label: string;
  Icon: CbctIcon;
  /** filtro CSS base del plano (afina además con HU brillo/contraste). */
  filter: string;
  flip: boolean;
  rot: number;
}

export const PLANES: PlaneDef[] = [
  { id: "axial", label: "Axial", Icon: IcLayers, filter: "brightness(1.04) contrast(1.06)", flip: false, rot: 90 },
  { id: "coronal", label: "Coronal", Icon: IcCoronal, filter: "brightness(0.98) contrast(1.1)", flip: true, rot: 0 },
  { id: "sagital", label: "Sagital", Icon: IcSagital, filter: "none", flip: false, rot: 0 },
  { id: "vol3d", label: "Volumen 3D", Icon: IcCube, filter: "none", flip: false, rot: 0 },
];

/**
 * Máximo de cortes por plano (placeholder del prototipo). T7 lo sustituye por el
 * conteo real del estudio (DecodedSlice / dimensiones del volumen) por plano.
 */
export const PLANE_MAX: Record<Plane, number> = {
  axial: 512,
  coronal: 512,
  sagital: 668,
  vol3d: 1,
};

export interface HUPreset {
  id: string;
  label: string;
  sub: string;
  brillo: number;
  contraste: number;
  Icon: CbctIcon;
}

export const HU_PRESETS: HUPreset[] = [
  { id: "hueso", label: "Hueso", sub: "Bone window", brillo: 46, contraste: 78, Icon: IcBone },
  { id: "dientes", label: "Esmalte", sub: "Tooth/enamel", brillo: 38, contraste: 92, Icon: IcTooth },
  { id: "blando", label: "Tejido blando", sub: "Soft tissue", brillo: 62, contraste: 44, Icon: IcSun },
  { id: "seno", label: "Vía aérea", sub: "Airway/sinus", brillo: 70, contraste: 60, Icon: IcContrast },
];
