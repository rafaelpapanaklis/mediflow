"use client";
// Orthodontics — badge de fase con color SPEC §11.2.

import type { OrthoPhaseKey } from "@prisma/client";
import { PHASE_LABELS } from "@/lib/orthodontics/kanban-helpers";

const PHASE_COLOR: Record<OrthoPhaseKey, { bg: string; text: string }> = {
  ALIGNMENT: { bg: "rgba(59,130,246,0.16)", text: "#3B82F6" },
  LEVELING: { bg: "rgba(59,130,246,0.16)", text: "#3B82F6" },
  SPACE_CLOSURE: { bg: "rgba(37,99,235,0.20)", text: "#2563EB" },
  DETAILS: { bg: "rgba(6,182,212,0.16)", text: "#06B6D4" },
  FINISHING: { bg: "rgba(16,185,129,0.16)", text: "#10B981" },
  RETENTION: { bg: "rgba(139,92,246,0.16)", text: "#8B5CF6" },
};

export function OrthoStageBadge({ phaseKey }: { phaseKey: OrthoPhaseKey }) {
  const color = PHASE_COLOR[phaseKey];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        background: color.bg,
        color: color.text,
      }}
    >
      {PHASE_LABELS[phaseKey]}
    </span>
  );
}
