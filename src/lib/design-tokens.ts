/**
 * MediFlow — Design Tokens (TypeScript bindings)
 *
 * Refleja los tokens CSS de `globals.css` como strings para uso en inline
 * styles, componentes custom, y lógica TS. La fuente de verdad SIGUE siendo
 * globals.css — este archivo existe solo por DX (autocomplete, type safety).
 *
 * Regla: NUNCA hardcodear un hex aquí. Si necesitas un color nuevo,
 * agrégalo PRIMERO al CSS como token, después aquí.
 */

// ── Colores base ──────────────────────────────────────────────────

export const bg = {
  base: "var(--bg)",
  elev: "var(--bg-elev)",
  elev2: "var(--bg-elev-2)",
  hover: "var(--bg-hover)",
} as const;

export const border = {
  soft: "var(--border-soft)",
  strong: "var(--border-strong)",
  brand: "var(--border-brand)",
  /** Reservado para inputs/botones secondary en Fase 2.2+. No usar todavía. */
  interactive: "var(--border-interactive)",
} as const;

export const text = {
  /** Headings, body primary */
  primary: "var(--text-1)",
  /** Body secondary */
  secondary: "var(--text-2)",
  /** Labels, captions */
  muted: "var(--text-3)",
  /** Placeholders, disabled */
  subtle: "var(--text-4)",
} as const;

export const brand = {
  DEFAULT: "var(--brand)",
  soft: "var(--brand-soft)",
  softer: "var(--brand-softer)",
} as const;

export const semantic = {
  success: "var(--success)",
  successSoft: "var(--success-soft)",
  warning: "var(--warning)",
  warningSoft: "var(--warning-soft)",
  warningSoftStrong: "var(--warning-soft-strong)",
  warningBorderStrong: "var(--warning-border-strong)",
  danger: "var(--danger)",
  dangerSoft: "var(--danger-soft)",
  dangerSoftStrong: "var(--danger-soft-strong)",
  dangerBorderStrong: "var(--danger-border-strong)",
  info: "var(--info)",
  infoSoft: "var(--info-soft)",
} as const;

export const consult = {
  activeBg: "var(--consult-active-bg)",
  activeBorder: "var(--consult-active-border)",
  activeAccent: "var(--consult-active-accent)",
  activeDot: "var(--consult-active-dot)",
} as const;

export const radius = {
  sm: "6px",
  DEFAULT: "10px",
  lg: "14px",
  pill: "20px",
  full: "9999px",
} as const;

export const shadow = {
  card: "0 1px 3px rgba(15,10,30,0.04), 0 1px 2px rgba(15,10,30,0.03)",
  cardMd: "0 4px 16px rgba(0,0,0,0.08)",
  modal: "0 24px 60px -12px rgba(0,0,0,0.6)",
  brandGlow: "0 0 20px rgba(124, 58, 237, 0.4)",
  brandGlowStrong: "0 0 24px rgba(124, 58, 237, 0.6)",
} as const;

export const font = {
  sora: "var(--font-sora, 'Sora', sans-serif)",
  mono: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)",
} as const;

export const fontSize = {
  h1: "clamp(16px, 1.4vw, 22px)",
  h2: "18px",
  body: "13px",
  label: "11px",
  labelSmall: "10px",
  kpi: "26px",
  badge: "10px",
} as const;

export const layout = {
  topbarHeight: "52px",
  contextBarHeight: "52px",
  sidebarWidth: "clamp(180px, 14vw, 232px)",
  sidebarWidthCollapsed: "68px",
  maxContentWidth: "1280px",
  pagePaddingX: "clamp(12px, 1.5vw, 28px)",
  pagePaddingY: "clamp(14px, 1.6vw, 28px)",
} as const;

export const breakpoint = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1440,
  xxxl: 1920,
} as const;

export const transition = {
  fast: "all 0.15s",
  slide: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
  focus: "box-shadow 0.12s, border-color 0.12s",
} as const;

export type TextTone = keyof typeof text;
export type BrandTone = keyof typeof brand;
export type SemanticTone = keyof typeof semantic;
export type Breakpoint = keyof typeof breakpoint;
