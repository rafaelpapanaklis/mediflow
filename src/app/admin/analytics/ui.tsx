"use client";

// Kit visual compartido del panel de analítica. Todas las tabs reutilizan estos
// componentes para mantener consistencia (tema oscuro vía CSS vars del proyecto).

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

/** Paleta categórica para series de charts (dataviz-consistente). */
export const SERIES = ["#7c3aed", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#6366f1", "#f43f5e", "#14b8a6"];

export const TOOLTIP_STYLE = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  color: "var(--text-1)",
  fontSize: 12,
} as const;

/* ------------------------------- Estados ---------------------------------- */
export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div style={{ padding: "44px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <Loader2 size={22} className="animate-spin" style={{ color: "var(--brand)" }} />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      style={{
        padding: 18,
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.25)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)", margin: 0 }}>No se pudo cargar</h3>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-2)", wordBreak: "break-all", margin: 0 }}>{message}</p>
      {onRetry && (
        <div>
          <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon = "📊", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div style={{ padding: "44px 18px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      <div style={{ fontSize: 30 }}>{icon}</div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>{title}</h3>
      {hint && <p style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 440, margin: 0 }}>{hint}</p>}
    </div>
  );
}

/* --------------------------------- Segmented ------------------------------ */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { k: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={`segment-new__btn ${value === o.k ? "segment-new__btn--active" : ""}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- StatTile ------------------------------- */
export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneColor =
    tone === "good" ? "var(--success)" : tone === "bad" ? "var(--danger)" : tone === "warn" ? "var(--warning)" : "var(--text-1)";
  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 12,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: toneColor, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* --------------------------------- BarList -------------------------------- */
export interface BarItem {
  label: ReactNode;
  value: number;
  display?: string;
  sub?: string;
  href?: string;
}

export function BarList({
  items,
  color = "var(--brand)",
  emptyLabel = "Sin datos",
}: {
  items: BarItem[];
  color?: string;
  emptyLabel?: string;
}) {
  if (!items.length) {
    return <div style={{ padding: "18px 4px", fontSize: 12, color: "var(--text-3)" }}>{emptyLabel}</div>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, idx) => (
        <div key={idx} style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: `${Math.max(2, (it.value / max) * 100)}%`,
              background: color,
              opacity: 0.16,
              borderRadius: 8,
              transition: "width .3s ease",
            }}
          />
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px" }}>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.label}
              </span>
              {it.sub && <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{it.sub}</span>}
            </div>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", flexShrink: 0 }}>
              {it.display ?? it.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Sparkline ------------------------------ */
export function Sparkline({ data, color = "var(--brand)", height = 36 }: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return null;
  const w = 120;
  const max = Math.max(...data, 1);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------- Chip ----------------------------------- */
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "good" | "warn" | "bad" }) {
  const map: Record<string, [string, string]> = {
    neutral: ["var(--text-3)", "var(--border-soft)"],
    brand: ["var(--brand)", "rgba(124,58,237,0.3)"],
    good: ["var(--success)", "rgba(16,185,129,0.3)"],
    warn: ["var(--warning)", "rgba(245,158,11,0.3)"],
    bad: ["var(--danger)", "rgba(239,68,68,0.3)"],
  };
  const [fg, bd] = map[tone] || map.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        fontWeight: 600,
        color: fg,
        border: `1px solid ${bd}`,
        borderRadius: 999,
        padding: "1px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
