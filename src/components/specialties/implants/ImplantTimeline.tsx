"use client";
// Implants — timeline horizontal de 6 hitos. Spec §6.3.
// Si OSSEOINTEGRATING, muestra countdown debajo.

import {
  Compass,
  Stethoscope,
  Heart,
  Scissors,
  Crown,
  Activity,
} from "lucide-react";
import { TimelineMilestone } from "./TimelineMilestone";
import type { ImplantFull } from "@/lib/types/implants";
import {
  activeMilestone,
  shouldSkipSecondStage,
  type MilestoneState,
  type TimelineMilestone as MilestoneKey,
} from "@/lib/implants/implant-helpers";

const ORDER: MilestoneKey[] = [
  "PLANNING",
  "SURGERY",
  "OSSEOINTEGRATION",
  "SECOND_STAGE",
  "PROSTHETIC",
  "MAINTENANCE",
];

const ICON: Record<MilestoneKey, typeof Compass> = {
  PLANNING: Compass,
  SURGERY: Stethoscope,
  OSSEOINTEGRATION: Heart,
  SECOND_STAGE: Scissors,
  PROSTHETIC: Crown,
  MAINTENANCE: Activity,
};

const LABEL: Record<MilestoneKey, string> = {
  PLANNING: "Planeación",
  SURGERY: "Cirugía",
  OSSEOINTEGRATION: "Osteointegración",
  SECOND_STAGE: "2ª cirugía",
  PROSTHETIC: "Prótesis",
  MAINTENANCE: "Mantenimiento",
};

function formatShort(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export interface ImplantTimelineProps {
  implant: ImplantFull;
  onMilestoneClick?: (milestone: MilestoneKey) => void;
}

export function ImplantTimeline({ implant, onMilestoneClick }: ImplantTimelineProps) {
  const active = activeMilestone(implant.currentStatus);
  const isFailedOrRemoved =
    implant.currentStatus === "FAILED" || implant.currentStatus === "REMOVED";

  const stateOf = (m: MilestoneKey): MilestoneState => {
    if (m === "SECOND_STAGE" && shouldSkipSecondStage(implant.protocol)) {
      return "skipped";
    }
    const idx = ORDER.indexOf(m);
    const activeIdx = ORDER.indexOf(active);
    if (m === active) return isFailedOrRemoved ? "failed" : "active";
    if (idx < activeIdx) return "completed";
    return "future";
  };

  const dateOf = (m: MilestoneKey): string | null => {
    switch (m) {
      case "PLANNING":
        return formatShort(implant.placedAt); // proxy — no hay planning en MVP
      case "SURGERY":
        return formatShort(implant.surgicalRecord?.performedAt ?? implant.placedAt);
      case "OSSEOINTEGRATION":
        return formatShort(implant.healingPhase?.startedAt ?? null);
      case "SECOND_STAGE":
        return formatShort(implant.secondStage?.performedAt ?? null);
      case "PROSTHETIC":
        return formatShort(implant.prostheticPhase?.prosthesisDeliveredAt ?? null);
      case "MAINTENANCE":
        return implant.followUps.length > 0
          ? formatShort(implant.followUps[implant.followUps.length - 1]?.performedAt)
          : null;
    }
  };

  const showCountdown =
    implant.currentStatus === "OSSEOINTEGRATING" && implant.healingPhase;
  let countdown: string | null = null;
  if (showCountdown && implant.healingPhase) {
    const startedAt = new Date(implant.healingPhase.startedAt);
    const now = new Date();
    const elapsedWeeks = Math.floor(
      (now.getTime() - startedAt.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    const total = implant.healingPhase.expectedDurationWeeks;
    const remaining = Math.max(0, total - elapsedWeeks);
    const isq = implant.healingPhase.isqLatest;
    countdown = `Semana ${elapsedWeeks} / ${total} — quedan ~${remaining} sem${
      isq ? ` · ISQ último: ${isq}` : ""
    }`;
  }

  return (
    <div className="px-2 py-3">
      <div className="flex items-start justify-between gap-2 overflow-x-auto">
        {ORDER.map((m) => (
          <TimelineMilestone
            key={m}
            milestone={m}
            state={stateOf(m)}
            Icon={ICON[m]}
            label={LABEL[m]}
            date={dateOf(m)}
            onClick={() => onMilestoneClick?.(m)}
          />
        ))}
      </div>
      {countdown && (
        <div className="mt-3 text-xs text-center text-blue-600 dark:text-blue-400 font-medium">
          {countdown}
        </div>
      )}
    </div>
  );
}
