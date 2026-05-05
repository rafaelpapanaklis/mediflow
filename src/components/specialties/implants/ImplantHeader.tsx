"use client";
// Implants — header de la tarjeta. FDI grande + Anchor + badge estado.
// Spec §6.5.

import { Anchor, ChevronDown, ChevronUp } from "lucide-react";
import type { ImplantFull } from "@/lib/types/implants";
import type { ImplantStatus } from "@prisma/client";

const STATUS_BADGE: Record<
  ImplantStatus,
  { label: string; className: string }
> = {
  PLANNED:           { label: "Planeado",       className: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  PLACED:            { label: "Colocado",       className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  OSSEOINTEGRATING:  { label: "Cicatrizando",   className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  UNCOVERED:         { label: "Descubierto",    className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  LOADED_PROVISIONAL:{ label: "Carga provisional", className: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  LOADED_DEFINITIVE: { label: "Carga definitiva", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  FUNCTIONAL:        { label: "En función",     className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  COMPLICATION:      { label: "Complicación",   className: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" },
  FAILED:            { label: "Fracaso",        className: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  REMOVED:           { label: "Removido",       className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export interface ImplantHeaderProps {
  implant: ImplantFull;
  expanded: boolean;
  onToggle: () => void;
}

export function ImplantHeader({ implant, expanded, onToggle }: ImplantHeaderProps) {
  const badge = STATUS_BADGE[implant.currentStatus];
  const brandLabel =
    implant.brand === "OTRO" && implant.brandCustomName
      ? implant.brandCustomName
      : implant.brand;

  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex-shrink-0 h-14 w-14 rounded-md bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
          <span className="font-mono text-lg font-bold text-blue-700 dark:text-blue-300">
            {implant.toothFdi}
          </span>
        </div>
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
          <Anchor className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-[var(--text-1,theme(colors.gray.900))] truncate">
              {brandLabel} {implant.modelName}
            </h3>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-[var(--text-3,theme(colors.gray.500))] mt-0.5 truncate">
            ⌀ {String(implant.diameterMm)}mm × {String(implant.lengthMm)}mm · Lote{" "}
            <span className="font-mono text-amber-600 dark:text-amber-400">
              {implant.lotNumber}
            </span>{" "}
            · Colocado {fmtDate(implant.placedAt)}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? "Colapsar" : "Expandir"}
        className="flex-shrink-0 h-8 w-8 rounded-md hover:bg-[var(--bg-elev,theme(colors.gray.100))] flex items-center justify-center text-[var(--text-2,theme(colors.gray.600))]"
      >
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
