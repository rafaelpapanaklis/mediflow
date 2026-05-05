"use client";
// Periodontics — silueta del diente con badges (movilidad, furca, ausente,
// implante). SPEC §6.4. Usa tokens dark mode.

import { memo } from "react";
import type { ToothLevel } from "@/lib/periodontics/schemas";
import { toothCategory } from "@/lib/periodontics/site-helpers";

export interface ToothCenterProps {
  fdi: number;
  tooth?: ToothLevel;
  isUpperArcade: boolean;
  onClick: (fdi: number) => void;
}

function ToothCenterInner({ fdi, tooth, isUpperArcade, onClick }: ToothCenterProps) {
  const cat = toothCategory(fdi);
  const absent = tooth?.absent ?? false;
  const implant = tooth?.isImplant ?? false;

  // SVG paths simplificados por categoría — la silueta tiene la corona arriba
  // siempre (lo invierte CSS para arcada inferior).
  const path = TOOTH_PATHS[cat];

  return (
    <button
      type="button"
      data-perio-tooth
      data-fdi={fdi}
      onClick={() => onClick(fdi)}
      title={`Diente ${fdi}`}
      style={{
        position: "relative",
        width: "100%",
        height: 56,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-label={`Diente ${fdi}${absent ? " — ausente" : ""}${implant ? " — implante" : ""}`}
    >
      <svg
        width={26}
        height={36}
        viewBox="0 0 26 36"
        style={{
          opacity: absent ? 0.25 : 1,
          // Arcada inferior: girar 180° para que la corona apunte hacia abajo.
          transform: isUpperArcade ? undefined : "rotate(180deg)",
          fill: implant
            ? "var(--text-2, #94a3b8)"
            : absent
              ? "var(--bg-elev, #1f2937)"
              : "var(--brand-soft, #1e293b)",
          stroke: "var(--border, #334155)",
          strokeWidth: 1,
        }}
        aria-hidden
      >
        <path d={path} />
      </svg>

      <span
        style={{
          fontSize: 9,
          color: "var(--text-2, #94a3b8)",
          marginTop: 2,
        }}
      >
        {fdi}
      </span>

      {/* Badges */}
      {tooth && tooth.mobility > 0 ? (
        <span
          style={{
            position: "absolute",
            top: 0,
            right: 2,
            fontSize: 8,
            padding: "1px 3px",
            borderRadius: 3,
            background: "var(--warning-soft, rgba(234,179,8,0.2))",
            color: "var(--warning, #eab308)",
          }}
          title={`Movilidad ${tooth.mobility}`}
        >
          M{tooth.mobility}
        </span>
      ) : null}
      {tooth && tooth.furcation > 0 ? (
        <span
          style={{
            position: "absolute",
            top: 0,
            left: 2,
            fontSize: 8,
            padding: "1px 3px",
            borderRadius: 3,
            background: "var(--danger-soft, rgba(239,68,68,0.2))",
            color: "var(--danger, #ef4444)",
          }}
          title={`Furcación ${tooth.furcation}`}
        >
          F{tooth.furcation}
        </span>
      ) : null}
    </button>
  );
}

export const ToothCenter = memo(ToothCenterInner);

// Siluetas simplificadas, la corona arriba (luego se rota para arcada inferior).
const TOOTH_PATHS: Record<ReturnType<typeof toothCategory>, string> = {
  incisor_upper: "M8 2 Q13 0 18 2 L20 14 Q13 17 6 14 Z M8 14 L9 32 Q13 35 17 32 L18 14 Z",
  incisor_lower: "M9 2 Q13 0 17 2 L19 14 Q13 17 7 14 Z M9 14 L10 32 Q13 35 16 32 L17 14 Z",
  canine: "M8 1 Q13 -1 18 1 L21 13 Q13 17 5 13 Z M8 13 L9 32 Q13 35 17 32 L18 13 Z",
  premolar:
    "M5 4 Q13 1 21 4 L21 14 Q13 17 5 14 Z M7 14 L8 31 Q13 34 18 31 L19 14 Z",
  molar:
    "M3 4 Q7 0 13 2 Q19 0 23 4 L23 15 Q13 18 3 15 Z M5 15 L6 31 Q13 35 20 31 L21 15 Z",
};
