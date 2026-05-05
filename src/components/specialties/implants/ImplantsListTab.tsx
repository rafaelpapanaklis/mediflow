"use client";
// Implants — sub-tab "Implantes" con header + lista de tarjetas.
// Conmuta a CompactImplantList cuando hay 8+ implantes. Spec §6.

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { ImplantCard } from "./ImplantCard";
import { CompactImplantList } from "./CompactImplantList";
import { EmptyState } from "./EmptyState";
import type { ImplantFull } from "@/lib/types/implants";
import type { ImplantActionType } from "./ImplantActions";
import type { TimelineMilestone as MilestoneKey } from "@/lib/implants/implant-helpers";

const COMPACT_THRESHOLD = 8;

export interface ImplantsListTabProps {
  implants: ImplantFull[];
  onNew: () => void;
  onAction: (action: ImplantActionType, implantId: string) => void;
  onMilestoneClick?: (milestone: MilestoneKey, implantId: string) => void;
}

export function ImplantsListTab(props: ImplantsListTabProps) {
  const sorted = useMemo(
    () =>
      [...props.implants].sort(
        (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
      ),
    [props.implants],
  );
  const mostRecentId = sorted[0]?.id;
  const useCompact = sorted.length >= COMPACT_THRESHOLD;

  if (sorted.length === 0) {
    return <EmptyState onNew={props.onNew} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-1,theme(colors.gray.900))]">
            Implantes
          </h2>
          <p className="text-xs text-[var(--text-3,theme(colors.gray.500))]">
            {sorted.length} implante{sorted.length === 1 ? "" : "s"}
            {sorted.filter((i) => i.currentStatus === "COMPLICATION").length > 0
              ? " · 1 con complicación activa"
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onNew}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5"
        >
          <Plus className="h-4 w-4" />
          Nuevo implante
        </button>
      </div>

      {useCompact ? (
        <CompactImplantList implants={sorted} onAction={props.onAction} />
      ) : (
        <div className="space-y-3">
          {sorted.map((imp) => (
            <ImplantCard
              key={imp.id}
              implant={imp}
              isMostRecent={imp.id === mostRecentId}
              onAction={props.onAction}
              onMilestoneClick={props.onMilestoneClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
