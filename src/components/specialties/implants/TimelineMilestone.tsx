"use client";
// Implants — un hito del timeline. Botón circular 40px + ring de color
// según estado. Animación ping cuando active. Spec §6.4.

import type { LucideIcon } from "lucide-react";
import type { MilestoneState, TimelineMilestone as MilestoneKey } from "@/lib/implants/implant-helpers";

const STATE_STYLES: Record<MilestoneState, { ring: string; bg: string; text: string; pulse: boolean }> = {
  completed: {
    ring: "ring-2 ring-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    pulse: false,
  },
  active: {
    ring: "ring-2 ring-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    pulse: true,
  },
  future: {
    ring: "ring-1 ring-gray-300 dark:ring-gray-600",
    bg: "bg-gray-50 dark:bg-gray-900/40",
    text: "text-gray-400 dark:text-gray-500",
    pulse: false,
  },
  skipped: {
    ring: "ring-1 ring-dashed ring-gray-200 dark:ring-gray-700",
    bg: "bg-transparent",
    text: "text-gray-300 dark:text-gray-700",
    pulse: false,
  },
  failed: {
    ring: "ring-2 ring-red-500",
    bg: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    pulse: false,
  },
};

export interface TimelineMilestoneProps {
  milestone: MilestoneKey;
  state: MilestoneState;
  Icon: LucideIcon;
  label: string;
  date?: string | null;
  summary?: string | null;
  onClick?: () => void;
}

export function TimelineMilestone(props: TimelineMilestoneProps) {
  const styles = STATE_STYLES[props.state];
  return (
    <div className="flex flex-col items-center gap-2 min-w-[110px]">
      <button
        type="button"
        aria-label={`${props.label} — ${props.state}`}
        disabled={props.state === "skipped"}
        onClick={props.onClick}
        className={[
          "relative h-10 w-10 rounded-full flex items-center justify-center",
          styles.ring,
          styles.bg,
          styles.text,
          props.state === "skipped" ? "cursor-default" : "hover:scale-105 transition-transform",
        ].join(" ")}
      >
        <props.Icon className="h-5 w-5" />
        {styles.pulse && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
        )}
      </button>
      <div className="text-center">
        <p className={`text-xs font-medium ${styles.text}`}>{props.label}</p>
        {props.date && (
          <p className="text-[10px] text-[var(--text-3,theme(colors.gray.500))]">{props.date}</p>
        )}
        {props.summary && (
          <p className="text-[10px] text-[var(--text-3,theme(colors.gray.500))] max-w-[100px] truncate">
            {props.summary}
          </p>
        )}
      </div>
    </div>
  );
}
