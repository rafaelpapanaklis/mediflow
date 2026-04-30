"use client";
// Pediatrics — Odontograma con segmented control (temporal/mixta/permanente). Spec: §1.8, §4.A.7

import { memo, useEffect, useState } from "react";
import { Tooth, type ToothProps } from "./Tooth";
import type { DentitionType } from "@/lib/pediatrics/dentition";

export type OdontogramView = "temporal" | "mixta" | "permanente";

export interface PediatricOdontogramProps {
  defaultView?: DentitionType;
  toothStates?: Record<number, Pick<ToothProps, "state" | "hasSealant" | "hasRestoration" | "caries" | "isErupting">>;
  onToothClick?: (fdi: number) => void;
  highlightFdi?: number | null;
}

const TEMPORAL_UPPER_RIGHT = [55, 54, 53, 52, 51];
const TEMPORAL_UPPER_LEFT  = [61, 62, 63, 64, 65];
const TEMPORAL_LOWER_LEFT  = [71, 72, 73, 74, 75];
const TEMPORAL_LOWER_RIGHT = [85, 84, 83, 82, 81];

const PERMANENT_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const PERMANENT_UPPER_LEFT  = [21, 22, 23, 24, 25, 26, 27, 28];
const PERMANENT_LOWER_LEFT  = [31, 32, 33, 34, 35, 36, 37, 38];
const PERMANENT_LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];

const STORAGE_KEY = "pedo.viewMode";

export const PediatricOdontogram = memo(function PediatricOdontogram(props: PediatricOdontogramProps) {
  const { defaultView, toothStates, onToothClick, highlightFdi } = props;

  const [view, setView] = useState<OdontogramView>(() => {
    if (typeof window === "undefined") return defaultView ?? "mixta";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "temporal" || stored === "mixta" || stored === "permanente") return stored;
    return defaultView ?? "mixta";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, view);
  }, [view]);

  const showTemporal  = view !== "permanente";
  const showPermanent = view !== "temporal";

  return (
    <div className="ped-odontogram">
      <div className="ped-odontogram__toolbar" role="tablist" aria-label="Vista del odontograma">
        {(["temporal", "mixta", "permanente"] as OdontogramView[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`ped-odontogram__tab ${view === v ? "is-active" : ""}`}
            onClick={() => setView(v)}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div className="ped-odontogram__quadrants">
        {/* Maxilar superior */}
        <div className="ped-odontogram__row ped-odontogram__row--upper">
          {showPermanent && [...PERMANENT_UPPER_RIGHT].reverse().map((fdi) => renderTooth(fdi, "permanent", toothStates, onToothClick, highlightFdi))}
          {showTemporal  && TEMPORAL_UPPER_RIGHT.map((fdi) => renderTooth(fdi, "temporal", toothStates, onToothClick, highlightFdi))}
          <div className="ped-odontogram__midline" aria-hidden />
          {showTemporal  && TEMPORAL_UPPER_LEFT.map((fdi) => renderTooth(fdi, "temporal", toothStates, onToothClick, highlightFdi))}
          {showPermanent && PERMANENT_UPPER_LEFT.map((fdi) => renderTooth(fdi, "permanent", toothStates, onToothClick, highlightFdi))}
        </div>

        <div className="ped-odontogram__separator" aria-hidden />

        {/* Maxilar inferior */}
        <div className="ped-odontogram__row ped-odontogram__row--lower">
          {showPermanent && [...PERMANENT_LOWER_RIGHT].reverse().map((fdi) => renderTooth(fdi, "permanent", toothStates, onToothClick, highlightFdi))}
          {showTemporal  && TEMPORAL_LOWER_RIGHT.map((fdi) => renderTooth(fdi, "temporal", toothStates, onToothClick, highlightFdi))}
          <div className="ped-odontogram__midline" aria-hidden />
          {showTemporal  && TEMPORAL_LOWER_LEFT.map((fdi) => renderTooth(fdi, "temporal", toothStates, onToothClick, highlightFdi))}
          {showPermanent && PERMANENT_LOWER_LEFT.map((fdi) => renderTooth(fdi, "permanent", toothStates, onToothClick, highlightFdi))}
        </div>
      </div>

      <p className="ped-odontogram__hint">
        Click en un diente para registrar restauración, sellante, endodoncia o extracción.
      </p>
    </div>
  );
});

function renderTooth(
  fdi: number,
  type: "temporal" | "permanent",
  states: PediatricOdontogramProps["toothStates"],
  onClick: PediatricOdontogramProps["onToothClick"],
  highlightFdi: number | null | undefined,
) {
  const s = states?.[fdi];
  return (
    <Tooth
      key={fdi}
      fdi={fdi}
      type={type}
      state={s?.state ?? "erupted"}
      hasSealant={s?.hasSealant}
      hasRestoration={s?.hasRestoration}
      caries={s?.caries}
      isErupting={s?.isErupting}
      highlight={highlightFdi === fdi}
      onClick={onClick ? () => onClick(fdi) : undefined}
    />
  );
}
