"use client";
// Implants — vista compacta para 8+ implantes (rehabilitaciones
// completas, All-on-4 doble arcada). Expande uno a la vez. Spec §6.8.

import { useState } from "react";
import { Anchor, ChevronDown, ChevronRight } from "lucide-react";
import { ImplantCard } from "./ImplantCard";
import type { ImplantFull } from "@/lib/types/implants";
import type { ImplantStatus } from "@prisma/client";
import type { ImplantActionType } from "./ImplantActions";

const STATUS_DOT: Record<ImplantStatus, string> = {
  PLANNED:           "bg-amber-400",
  PLACED:            "bg-blue-500",
  OSSEOINTEGRATING:  "bg-blue-500",
  UNCOVERED:         "bg-blue-500",
  LOADED_PROVISIONAL:"bg-amber-500",
  LOADED_DEFINITIVE: "bg-emerald-500",
  FUNCTIONAL:        "bg-emerald-500",
  COMPLICATION:      "bg-orange-500",
  FAILED:            "bg-red-500",
  REMOVED:           "bg-gray-400",
};

interface CompactRowProps {
  implant: ImplantFull;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: ImplantActionType, implantId: string) => void;
}

function CompactRow({ implant, expanded, onToggle, onAction }: CompactRowProps) {
  const brand =
    implant.brand === "OTRO" && implant.brandCustomName
      ? implant.brandCustomName
      : implant.brand;

  return (
    <div className="border border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800 rounded-md">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--bg-elev,theme(colors.gray.50))] dark:hover:bg-gray-800/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[implant.currentStatus]}`} />
          <span className="font-mono text-sm font-bold text-blue-700 dark:text-blue-300 min-w-[28px]">
            {implant.toothFdi}
          </span>
          <span className="text-sm text-[var(--text-1,theme(colors.gray.900))] truncate">
            {brand} {implant.modelName}
          </span>
          <span className="text-xs text-[var(--text-3,theme(colors.gray.500))] truncate hidden sm:inline">
            ⌀{String(implant.diameterMm)}×{String(implant.lengthMm)}mm
          </span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="border-t border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800 p-2">
          <ImplantCard
            implant={implant}
            isMostRecent={false}
            forceCollapsed={false}
            onAction={onAction}
          />
        </div>
      )}
    </div>
  );
}

export interface CompactImplantListProps {
  implants: ImplantFull[];
  onAction: (action: ImplantActionType, implantId: string) => void;
}

export function CompactImplantList({ implants, onAction }: CompactImplantListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/40 p-3 flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
        <Anchor className="h-4 w-4" />
        {implants.length} implantes registrados — vista compacta. Click para expandir uno a la vez.
      </div>
      <div className="space-y-2">
        {implants.map((imp) => (
          <CompactRow
            key={imp.id}
            implant={imp}
            expanded={expandedId === imp.id}
            onToggle={() => setExpandedId((curr) => (curr === imp.id ? null : imp.id))}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
}
