"use client";
// Pediatrics — Diente reutilizable (SVG simplificado anatómico). Spec: §1.8, §4.A.7

import { memo } from "react";
import type { ToothState } from "@/types/pediatrics";

export interface ToothProps {
  fdi: number;
  type: "temporal" | "permanent";
  state: ToothState;
  hasSealant?: boolean;
  hasRestoration?: boolean;
  caries?: boolean;
  isErupting?: boolean;
  size?: number;
  highlight?: boolean;
  onClick?: () => void;
}

export const Tooth = memo(function Tooth(props: ToothProps) {
  const {
    fdi, type, state, hasSealant, hasRestoration, caries, isErupting,
    size = 40, highlight, onClick,
  } = props;

  const fill =
    state === "missing-patho" ? "var(--danger-soft)"
    : state === "missing-physio" ? "var(--bg)"
    : hasRestoration ? "var(--bg)"
    : type === "temporal" ? "var(--brand-soft)"
    : "var(--bg-elev-2)";

  const border =
    state === "missing-patho" ? "var(--danger)"
    : caries ? "var(--danger)"
    : hasSealant ? "var(--success)"
    : type === "temporal" ? "color-mix(in srgb, var(--brand) 40%, transparent)"
    : "var(--brand)";

  const opacity = isErupting ? 0.65 : 1;
  const cls = `ped-tooth ped-tooth--${type} ${highlight ? "tooth--saved" : ""} ${state === "missing-physio" ? "ped-tooth--dashed" : ""}`;

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-label={`Diente ${fdi}`}
      style={{ width: size, height: size }}
      data-fdi={fdi}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <rect
          x={3} y={3} width={34} height={34}
          rx={8}
          fill={fill}
          stroke={border}
          strokeWidth={hasSealant || caries || state === "missing-patho" ? 2 : 1.5}
          opacity={opacity}
          strokeDasharray={state === "missing-physio" ? "3 3" : undefined}
        />
        {state === "missing-patho" ? (
          <g aria-hidden>
            <line x1={10} y1={10} x2={30} y2={30} stroke="var(--danger)" strokeWidth={2.5} />
            <line x1={30} y1={10} x2={10} y2={30} stroke="var(--danger)" strokeWidth={2.5} />
          </g>
        ) : null}
        {caries ? (
          <circle cx={20} cy={20} r={3.5} fill="var(--danger)" aria-hidden />
        ) : null}
        <text
          x={20} y={20}
          dominantBaseline="middle"
          textAnchor="middle"
          fontSize={9}
          fontFamily="var(--font-jetbrains-mono, ui-monospace, monospace)"
          fill="var(--text-2)"
          aria-hidden
        >
          {fdi}
        </text>
      </svg>
    </button>
  );
});
