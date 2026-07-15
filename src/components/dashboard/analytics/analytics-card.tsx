"use client";

import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * AnalyticsCard — card consistente para KPIs del módulo Analytics.
 * Reutilizada en todos los tabs (Resumen, Ocupación, Doctores, etc).
 *
 * Props:
 *  - label: texto pequeño arriba del número
 *  - value: número grande (string ya formateado)
 *  - delta: cambio vs período anterior; si null/undefined no se muestra
 *  - sparkline: array opcional de números 0-100 para mini-line chart
 *  - tone: "brand" (default) | "success" | "warning" | "danger"
 *  - hint: texto auxiliar debajo (ej. "vs mes anterior")
 */
export interface AnalyticsCardProps {
  label: string;
  value: string;
  delta?: { pct: number; absolute?: string } | null;
  sparkline?: number[];
  tone?: "brand" | "success" | "warning" | "danger" | "neutral";
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

const TONE_BG: Record<NonNullable<AnalyticsCardProps["tone"]>, string> = {
  brand:   "var(--brand-soft)",
  success: "var(--success-soft)",
  warning: "var(--warning-soft)",
  danger:  "var(--danger-soft)",
  neutral: "var(--bg-elev-2)",
};

const TONE_FG: Record<NonNullable<AnalyticsCardProps["tone"]>, string> = {
  brand:   "var(--brand)",
  success: "var(--success-strong)",
  warning: "var(--warning-strong)",
  danger:  "var(--danger-strong)",
  neutral: "var(--text-2)",
};

export function AnalyticsCard({
  label,
  value,
  delta,
  sparkline,
  tone = "brand",
  hint,
  icon,
  className,
}: AnalyticsCardProps) {
  return (
    <div
      className={`kpi${className ? ` ${className}` : ""}`}
      style={{ minHeight: 120 }}
    >
      <div className="kpi__top" style={{ marginBottom: 10, gap: 8 }}>
        <div
          className="kpi__label"
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {label}
        </div>
        {icon && (
          <div
            className="kpi__icon"
            aria-hidden
            style={{
              flexShrink: 0,
              ...(tone === "brand"
                ? null
                : { background: TONE_BG[tone], color: TONE_FG[tone], borderColor: "transparent" }),
            }}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="kpi__value" style={{ fontSize: "clamp(22px, 2vw, 28px)" }}>
        {value}
      </div>
      {(delta || hint) && (
        <div className="kpi__delta" style={{ display: "flex", flexWrap: "wrap", rowGap: 2 }}>
          {delta && <DeltaPill pct={delta.pct} absolute={delta.absolute} />}
          {hint && <span className="kpi__delta-sub">{hint}</span>}
        </div>
      )}
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} tone={tone} />}
    </div>
  );
}

function DeltaPill({ pct, absolute }: { pct: number; absolute?: string }) {
  const isUp = pct > 0;
  const isFlat = pct === 0;
  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
  const sign = isUp ? "+" : "";
  return (
    <span
      className={isFlat ? undefined : isUp ? "kpi__delta--up" : "kpi__delta--down"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontVariantNumeric: "tabular-nums",
        ...(isFlat ? { color: "var(--text-3)" } : null),
      }}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {sign}
      {pct.toFixed(0)}%
      {absolute && <span className="kpi__delta-sub">· {absolute}</span>}
    </span>
  );
}

function Sparkline({ data, tone }: { data: number[]; tone: NonNullable<AnalyticsCardProps["tone"]> }) {
  // SVG sparkline: 0..100 escalado al espacio del card. data ya viene
  // normalizado o se normaliza aquí. Sin librería externa para no
  // inflar el bundle del módulo Analytics; recharts/visx solo cuando
  // realmente lo necesitemos en charts grandes.
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: "100%", height: 24, marginTop: 2 }}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={TONE_FG[tone]}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
