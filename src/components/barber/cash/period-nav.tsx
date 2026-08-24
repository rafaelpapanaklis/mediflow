"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtPeriod, shiftPeriodClient } from "./money";

/** Navegador de mes (periodKey "YYYY-MM") para comisiones y productos. */
export function PeriodNav({
  period,
  onChange,
  locale,
  prevLabel,
  nextLabel,
  maxPeriod,
}: {
  period: string;
  onChange: (next: string) => void;
  locale?: string;
  prevLabel: string;
  nextLabel: string;
  /** Último periodo navegable (normalmente el actual). */
  maxPeriod?: string;
}) {
  const next = shiftPeriodClient(period, 1);
  const nextDisabled = Boolean(maxPeriod && next > maxPeriod);
  return (
    <div className="bcaja-period">
      <button type="button" className="icon-btn-new" onClick={() => onChange(shiftPeriodClient(period, -1))} aria-label={prevLabel} title={prevLabel}>
        <ChevronLeft size={14} />
      </button>
      <span className="bcaja-period__label">{fmtPeriod(period, locale)}</span>
      <button type="button" className="icon-btn-new" onClick={() => onChange(next)} aria-label={nextLabel} title={nextLabel} disabled={nextDisabled}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
