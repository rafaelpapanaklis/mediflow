"use client";

import Link from "next/link";
import { STEPS } from "./onboarding-steps";
import { Progress } from "@/components/ui/progress";

interface Props {
  /** IDs of completed steps (from server). Missing IDs are treated as pending. */
  completed: string[];
}

export function OnboardingMini({ completed }: Props) {
  const doneCount = STEPS.filter((s) => completed.includes(s.id)).length;
  const total     = STEPS.length;
  const pct       = Math.round((doneCount / total) * 100);

  if (doneCount >= total) return null;

  const firstPending = STEPS.find((s) => !completed.includes(s.id));

  return (
    <Link
      href={firstPending?.href ?? "/dashboard"}
      className="block rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-3 transition-colors hover:bg-sidebar-accent/60"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Onboarding</span>
        <span className="text-xs text-muted-foreground">{doneCount}/{total}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
      {firstPending && (
        <div className="mt-2 truncate text-[11px] text-muted-foreground">
          Siguiente: {firstPending.label}
        </div>
      )}
    </Link>
  );
}
