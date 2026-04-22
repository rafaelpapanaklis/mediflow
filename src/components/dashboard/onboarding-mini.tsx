"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { STEPS } from "./onboarding-steps";
import { Progress } from "@/components/ui/progress";

interface Props {
  completed: string[];
}

export function OnboardingMini({ completed }: Props) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("onboarding-dismissed") === "true") setDismissed(true);
    } catch { /* incógnito puede bloquear */ }
  }, []);

  const doneCount = STEPS.filter((s) => completed.includes(s.id)).length;
  const total     = STEPS.length;
  const pct       = Math.round((doneCount / total) * 100);

  if (doneCount >= total || dismissed) return null;

  function dismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try { localStorage.setItem("onboarding-dismissed", "true"); } catch { /* incógnito */ }
    setDismissed(true);
  }

  const firstPending = STEPS.find((s) => !completed.includes(s.id));

  return (
    <Link
      href={firstPending?.href ?? "/dashboard"}
      className="block rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-3 transition-colors hover:bg-sidebar-accent/60"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Onboarding</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{doneCount}/{total}</span>
          <button
            onClick={dismiss}
            className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            aria-label="Cerrar onboarding"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
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
