"use client";
import { useMemo } from "react";

export type TrialUrgency = "none" | "calm" | "warning" | "urgent" | "critical";

export interface TrialInfo {
  days: number;
  hours: number;
  urgency: TrialUrgency;
  expired: boolean;
  absent: boolean;
}

export function computeTrialInfo(
  trialEndsAt: Date | string | null | undefined,
  now: Date = new Date(),
): TrialInfo {
  if (trialEndsAt == null) {
    return { days: 0, hours: 0, urgency: "none", expired: false, absent: true };
  }
  const end = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) {
    return { days: 0, hours: 0, urgency: "none", expired: false, absent: true };
  }
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { days: 0, hours: 0, urgency: "none", expired: true, absent: false };
  }
  const hours = Math.max(0, Math.floor(diffMs / 3600_000));
  const days = Math.max(1, Math.ceil(diffMs / 86400_000));

  let urgency: TrialUrgency;
  if (days > 7) urgency = "calm";
  else if (days >= 4) urgency = "warning";
  else if (days >= 2) urgency = "urgent";
  else urgency = "critical";

  return { days, hours, urgency, expired: false, absent: false };
}

export function useTrialDaysLeft(
  trialEndsAt: Date | string | null | undefined,
): TrialInfo {
  return useMemo(() => computeTrialInfo(trialEndsAt), [trialEndsAt]);
}

export function trialPillDismissKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `trial-pill-dismissed-${y}-${m}-${d}`;
}
