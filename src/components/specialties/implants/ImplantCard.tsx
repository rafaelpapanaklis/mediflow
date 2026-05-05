"use client";
// Implants — tarjeta-timeline horizontal del implante. La pieza visual
// estrella del módulo. Spec §6.2, §1.4. Borde coloreado según
// currentStatus.

import { useState } from "react";
import { ImplantHeader } from "./ImplantHeader";
import { ImplantTimeline } from "./ImplantTimeline";
import { ImplantSidePanel } from "./ImplantSidePanel";
import { ImplantActions, type ImplantActionType } from "./ImplantActions";
import type { ImplantFull } from "@/lib/types/implants";
import { implantBorderColor, shouldDefaultExpand } from "@/lib/implants/implant-helpers";
import type { TimelineMilestone as MilestoneKey } from "@/lib/implants/implant-helpers";

const BORDER_CLASS = {
  blue: "border-l-4 border-l-blue-500",
  green: "border-l-4 border-l-emerald-500",
  yellow: "border-l-4 border-l-amber-500",
  orange: "border-l-4 border-l-orange-500",
  red: "border-l-4 border-l-red-500",
  gray: "border-l-4 border-l-gray-400",
} as const;

export interface ImplantCardProps {
  implant: ImplantFull;
  isMostRecent?: boolean;
  forceCollapsed?: boolean;
  onAction: (action: ImplantActionType, implantId: string) => void;
  onMilestoneClick?: (milestone: MilestoneKey, implantId: string) => void;
}

export function ImplantCard(props: ImplantCardProps) {
  const { implant } = props;
  const hasActiveComplication = implant.complications.some((c) => !c.resolvedAt);
  const defaultExpanded = shouldDefaultExpand({
    isMostRecent: props.isMostRecent ?? false,
    hasActiveComplication,
  });
  const [expanded, setExpanded] = useState(!props.forceCollapsed && defaultExpanded);

  const borderClass = BORDER_CLASS[implantBorderColor(implant.currentStatus)];

  return (
    <article
      className={[
        "rounded-lg bg-white dark:bg-gray-900 border border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800 shadow-sm",
        borderClass,
        "overflow-hidden",
      ].join(" ")}
    >
      <ImplantHeader
        implant={implant}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <>
          <div className="flex flex-col md:flex-row">
            <div className="flex-1 min-w-0">
              <ImplantTimeline
                implant={implant}
                onMilestoneClick={(m) => props.onMilestoneClick?.(m, implant.id)}
              />
            </div>
            <ImplantSidePanel implant={implant} />
          </div>
          <ImplantActions
            implant={implant}
            onAction={(a) => props.onAction(a, implant.id)}
          />
        </>
      )}
    </article>
  );
}
