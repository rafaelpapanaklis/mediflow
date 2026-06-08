/* ============================================================
   Odontograma v2 — shared types (THE CONTRACT)
   Derived 1:1 from the design handoff: js/data.js + jsx/*.jsx.
   WS3-T3..T6 import their prop interfaces from here.
   ============================================================ */

export type Lang = "es" | "en";
export type Numbering = "fdi" | "universal" | "palmer";
export type Dentition = "permanent" | "mixed" | "primary";

export type ToothType = "central" | "lateral" | "canine" | "premolar" | "molar";
export type ArchSide = "upper" | "lower";
export type Side = "right" | "left";

/** Surface letters. Center is "O" (occlusal/posterior) or "I" (incisal/anterior). */
export type SurfaceLetter = "O" | "I" | "M" | "D" | "V" | "L";

/** Result of classify(fdi) — full anatomical metadata for a tooth. */
export interface ToothMeta {
  fdi: number;
  q: number;
  n: number;
  type: ToothType;
  roots: number;
  posterior: boolean;
  upper: boolean;
  right: boolean;
  primary: boolean;
  arch: ArchSide;
  side: Side;
  center: "O" | "I";
}

export type PalmerQuad = "ur" | "ul" | "lr" | "ll";

/** Result of numberLabel(fdi, system). `quad` is present only for palmer. */
export interface NumberLabel {
  label: string;
  quad?: PalmerQuad;
}

export type ConditionTarget = "surface" | "tooth";

/** How a finding is drawn. See Surface2D / ToothGlyph renderers. */
export type RenderKind =
  | "fill" | "outline" | "stipple" | "dots" | "ring" | "hatch" | "missing"
  | "badge" | "roman" | "icon" | "cross" | "endo" | "apical" | "implant"
  | "fracture" | "post" | "veneer" | "pontic" | "remnant" | "apico"
  | "bracket" | "recession";

/** A finding/treatment. ~45 of these, grouped by specialty. */
export interface Condition {
  id: string;
  group: string;
  es: string;
  en: string;
  target: ConditionTarget;
  render: RenderKind;
  /* per-condition extras */
  letter?: string;
  mm?: number;
  degree?: number;
  icon?: string;
  dashed?: boolean;
  partial?: boolean;
  soft?: boolean;
  steel?: boolean;
  band?: boolean;
  surfacesOnly?: string[];
}

/** A specialty group with its accent color. */
export interface Group {
  id: string;
  color: string;
  es: string;
  en: string;
}

/* ============================================================
   STATE SHAPE — records (persisted via the adapter, NOT localStorage)
   records = { [fdi]: { surfaces: { cara: condId[] }, tooth: condId[], note? } }
   ============================================================ */
export interface ToothRecord {
  /** by surface letter → array of condition ids (target "surface") */
  surfaces: { [surface: string]: string[] };
  /** whole-tooth condition ids (target "tooth") */
  tooth: string[];
  /** free clinical note (optional) */
  note?: string;
}

export type Records = { [fdi: number]: ToothRecord };

/* ---------- interaction callback shapes (shared) ---------- */
export type ApplyKind = "surface" | "tooth" | "glyphErase";
export type OnApply = (fdi: number, kind: ApplyKind, letter?: SurfaceLetter | string) => void;
export type RemoveScope = "surface" | "tooth";
export type OnRemove = (fdi: number, scope: RemoveScope, letter: string | undefined, condId: string) => void;
export type OnSurface = (letter: SurfaceLetter | string) => void;

/* ============================================================
   COMPONENT PROP INTERFACES (derived from the real design jsx).
   Each stub component (T3-T6) implements exactly these.
   ============================================================ */

/** Surface2D — the 5-zone clickable circle. (design: jsx/surface2d.jsx) */
export interface Surface2DProps {
  meta: ToothMeta;
  record: ToothRecord;
  onSurface: OnSurface;
  onTooth?: () => void;
  dimmed?: boolean;
  size?: number;
}

/** ToothGlyph — schematic anatomical tooth drawing. (design: jsx/surface2d.jsx) */
export interface ToothGlyphProps {
  meta: ToothMeta;
  record: ToothRecord;
  w?: number;
  h?: number;
}

/** OdoDefs — global SVG <pattern> defs (stipple/dots/hatch per group). Takes no props. */
export type OdoDefsProps = Record<string, never>;

/** Tooth3D — procedural Three.js tooth with 5 clickable faces. (design: jsx/tooth3d.jsx) */
export interface Tooth3DProps {
  meta: ToothMeta;
  record: ToothRecord;
  onSurface: OnSurface;
  style?: "light" | "mono" | string;
  resetKey?: number;
}

/** Odontogram — both arches grid. (design: jsx/odontogram.jsx) */
export interface OdontogramProps {
  dentition: Dentition;
  lang: Lang;
  numbering: Numbering;
  records: Records;
  brush: string | null;
  eraser: boolean;
  selected: number | null;
  onApply: OnApply;
  onSelect: (fdi: number) => void;
  compact?: boolean;
}

/** ToothCell — one tooth (glyph + circle + label).
 *  NOTE: `selected` here is a boolean — Arch passes `selected === fdi`. */
export interface ToothCellProps {
  fdi: number;
  lang: Lang;
  numbering: Numbering;
  record: ToothRecord;
  brush: string | null;
  eraser: boolean;
  selected: boolean;
  onApply: OnApply;
  onSelect: (fdi: number) => void;
  compact?: boolean;
}

/** PalmerLabel — bracket-hugging quadrant label. (design: jsx/odontogram.jsx) */
export interface PalmerLabelProps {
  quad?: PalmerQuad;
  label: string;
}

/** Palette — conditions grouped by specialty + eraser. (design: jsx/odontogram.jsx) */
export interface PaletteProps {
  lang: Lang;
  brush: string | null;
  eraser: boolean;
  onPick: (id: string) => void;
  onEraser: () => void;
}

/** ConditionSwatch — mini preview of how a condition renders. (design: jsx/odontogram.jsx) */
export interface ConditionSwatchProps {
  cond: Condition;
}

/** Legend — specialty color legend. (design: jsx/odontogram.jsx) */
export interface LegendProps {
  lang: Lang;
}

/** DetailPanel — slide-over for the selected tooth. (design: jsx/detail.jsx) */
export interface DetailPanelProps {
  fdi: number;
  lang: Lang;
  numbering: Numbering;
  record: ToothRecord;
  brush: string | null;
  eraser: boolean;
  onApply: OnApply;
  onClose: () => void;
  onClearTooth: () => void;
  onNote: (txt: string) => void;
  onRemove: OnRemove;
  onPick: (id: string) => void;
}
