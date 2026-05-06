// Barrel atoms — re-exports de la familia de componentes base del rediseño.
// El TimelineRow es client-only (interactivo); se importa directo desde su
// archivo cuando se necesita.

export { Card } from "./Card";
export type { CardProps } from "./Card";

export { Pill } from "./Pill";
export type { PillColor, PillProps } from "./Pill";

export { Btn } from "./Btn";
export type { BtnProps } from "./Btn";

export { KV } from "./KV";
export type { KVProps } from "./KV";

export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

export { StatChip } from "./StatChip";
export type { StatChipProps } from "./StatChip";

export { PhasePill } from "./PhasePill";
export type { PhasePillProps } from "./PhasePill";

export { KpiTile } from "./KpiTile";
export type { KpiTileProps } from "./KpiTile";

export {
  fmtMoney,
  fmtDate,
  fmtDateShort,
  fmtTime,
  fmtPct,
  fmtMm,
  avatarInitials,
  clinicalSeverityColor,
} from "./format";
