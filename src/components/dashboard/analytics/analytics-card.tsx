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
  brand:   "var(--brand-softer)",
  success: "rgba(16, 185, 129, 0.10)",
  warning: "rgba(217, 119, 6, 0.10)",
  danger:  "rgba(220, 38, 38, 0.10)",
  neutral: "var(--bg-elev-2)",
};

const TONE_BORDER: Record<NonNullable<AnalyticsCardProps["tone"]>, string> = {
  brand:   "rgba(124, 58, 237, 0.20)",
  success: "rgba(16, 185, 129, 0.25)",
  warning: "rgba(217, 119, 6, 0.25)",
  danger:  "rgba(220, 38, 38, 0.25)",
  neutral: "var(--border-soft)",
};

const TONE_FG: Record<NonNullable<AnalyticsCardProps["tone"]>, string> = {
  brand:   "var(--brand)",
  success: "#059669",
  warning: "#d97706",
  danger:  "#dc2626",
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
      className={className}
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 120,
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && (
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: TONE_BG[tone],
              border: `1px solid ${TONE_BORDER[tone]}`,
              display: "grid",
              placeItems: "center",
              color: TONE_FG[tone],
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      </div>
      <div
        style={{
          fontSize: "clamp(22px, 2vw, 28px)",
          fontWeight: 700,
          color: "var(--text-1)",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {(delta || hint) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          {delta && <DeltaPill pct={delta.pct} absolute={delta.absolute} />}
          {hint && <span style={{ color: "var(--text-3)" }}>{hint}</span>}
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
  const color = isFlat ? "var(--text-3)" : isUp ? "#059669" : "#dc2626";
  const sign = isUp ? "+" : "";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        color,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon size={12} aria-hidden />
      {sign}
      {pct.toFixed(0)}%
      {absolute && <span style={{ color: "var(--text-3)", fontWeight: 500 }}>· {absolute}</span>}
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
