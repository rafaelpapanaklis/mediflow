// Punto de entrada del módulo del visor CBCT rediseñado.
// T7 integra desde aquí: import { CbctViewer, type CbctViewerProps } from
// "@/components/patient-3d/cbct".

export { CbctViewer, default } from "./CbctViewer";
export * from "./types";
export {
  TOOLS,
  PLANES,
  PLANE_MAX,
  HU_PRESETS,
  TOOL_COLORS,
} from "./constants";
export { dist01, mmBetween, angleAt, mid, smoothPath, uid } from "./geometry";
