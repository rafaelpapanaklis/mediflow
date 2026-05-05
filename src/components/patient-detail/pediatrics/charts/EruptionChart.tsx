"use client";
// Pediatrics — Cronología de erupción (la vista estrella). SVG custom. Spec: §1.9, §4.A.6

import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ERUPTION_TABLE, type EruptionRange } from "@/lib/pediatrics/eruption-data";
import type { EruptionRecordRow } from "@/types/pediatrics";

export interface EruptionChartProps {
  patientAgeMonths: number;
  records: EruptionRecordRow[];
  onToothClick?: (fdi: number) => void;
}

type SectionKey = "tempUp" | "tempLow" | "permUp" | "permLow";

const SECTION_LABELS: Record<SectionKey, string> = {
  tempUp:  "Temporal superior",
  tempLow: "Temporal inferior",
  permUp:  "Permanente superior",
  permLow: "Permanente inferior",
};

function sectionFor(range: EruptionRange): SectionKey {
  if (range.type === "temporal") return range.arch === "upper" ? "tempUp" : "tempLow";
  return range.arch === "upper" ? "permUp" : "permLow";
}

const X_MAX_MONTHS = 13 * 12;
const ROW_HEIGHT = 28;
const FDI_LABEL_W = 44;
const PADDING_X = 12;
const CHART_W = 920;

export const EruptionChart = memo(function EruptionChart(props: EruptionChartProps) {
  const { patientAgeMonths, records, onToothClick } = props;

  const grouped = useMemo(() => {
    const out: Record<SectionKey, EruptionRange[]> = {
      tempUp: [], tempLow: [], permUp: [], permLow: [],
    };
    for (const r of ERUPTION_TABLE) out[sectionFor(r)].push(r);
    return out;
  }, []);

  const recordByFdi = useMemo(() => {
    const m = new Map<number, EruptionRecordRow>();
    for (const r of records) {
      if (!r.deletedAt) m.set(r.toothFdi, r);
    }
    return m;
  }, [records]);

  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>(() => ({
    tempUp: true, tempLow: false, permUp: false, permLow: false,
  }));

  const innerW = CHART_W - PADDING_X * 2 - FDI_LABEL_W;
  const xForMonths = (m: number) => FDI_LABEL_W + PADDING_X + (m / X_MAX_MONTHS) * innerW;
  const ageX = xForMonths(Math.max(0, Math.min(patientAgeMonths, X_MAX_MONTHS)));

  const totalRows = (Object.keys(grouped) as SectionKey[]).reduce((sum, k) => sum + (expanded[k] ? grouped[k].length : 0), 0);
  const sectionsHeader = 4 * 26;
  const axisH = 30;
  const totalH = axisH + sectionsHeader + totalRows * ROW_HEIGHT + 16;

  return (
    <div className="ped-eruption-chart" role="img" aria-label="Cronología de erupción">
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${totalH}`} preserveAspectRatio="xMidYMid meet">
        {/* Eje X */}
        <g aria-hidden>
          {Array.from({ length: 14 }, (_, year) => {
            const x = xForMonths(year * 12);
            return (
              <g key={year}>
                <line x1={x} y1={0} x2={x} y2={axisH - 4} stroke="var(--border-soft)" strokeWidth={1} />
                <text x={x} y={axisH - 8} textAnchor="middle" fontSize={10} fill="var(--text-2)">
                  {year}a
                </text>
              </g>
            );
          })}
          {Array.from({ length: 26 }, (_, half) => {
            if (half % 2 === 0) return null;
            const x = xForMonths(half * 6);
            return <line key={`h-${half}`} x1={x} y1={axisH - 8} x2={x} y2={axisH - 4} stroke="var(--border-soft)" strokeWidth={0.5} />;
          })}
        </g>

        {/* Línea vertical edad actual */}
        <line
          x1={ageX} y1={axisH} x2={ageX} y2={totalH - 8}
          className="eruption-needle"
          aria-label="Edad actual"
        />

        {(["tempUp", "tempLow", "permUp", "permLow"] as SectionKey[]).map((key, idx) => {
          const ranges = grouped[key];
          const isOpen = expanded[key];
          const erupted = ranges.filter((r) => recordByFdi.has(r.fdi)).length;

          let yOffset = axisH;
          for (let i = 0; i < idx; i++) {
            const k = (["tempUp", "tempLow", "permUp", "permLow"] as SectionKey[])[i]!;
            yOffset += 26 + (expanded[k] ? grouped[k].length * ROW_HEIGHT : 0);
          }

          return (
            <g key={key}>
              <foreignObject x={0} y={yOffset} width={CHART_W} height={26}>
                <button
                  type="button"
                  onClick={() => setExpanded((s) => ({ ...s, [key]: !s[key] }))}
                  className="ped-eruption-chart__section-toggle"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  <span>{SECTION_LABELS[key]}</span>
                  <span className="ped-eruption-chart__counter">
                    {erupted}/{ranges.length}
                  </span>
                </button>
              </foreignObject>

              {isOpen && ranges.map((r, rowIdx) => {
                const rowY = yOffset + 26 + rowIdx * ROW_HEIGHT;
                const x1 = xForMonths(r.minMonths);
                const x2 = xForMonths(r.maxMonths);
                const record = recordByFdi.get(r.fdi);

                return (
                  <g
                    key={r.fdi}
                    className="ped-eruption-chart__row"
                    onClick={() => onToothClick?.(r.fdi)}
                    style={{ cursor: onToothClick ? "pointer" : "default" }}
                    role={onToothClick ? "button" : undefined}
                    tabIndex={onToothClick ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!onToothClick) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToothClick(r.fdi);
                      }
                    }}
                  >
                    <text
                      x={FDI_LABEL_W - 6}
                      y={rowY + ROW_HEIGHT / 2 + 4}
                      textAnchor="end"
                      fontSize={11}
                      fontFamily="var(--font-jetbrains-mono, ui-monospace, monospace)"
                      fill="var(--text-2)"
                    >
                      {r.fdi}
                    </text>
                    <rect
                      x={FDI_LABEL_W + PADDING_X} y={rowY + 8}
                      width={innerW} height={ROW_HEIGHT - 16}
                      rx={4}
                      fill="var(--bg-elev-2)"
                    />
                    <rect
                      x={x1} y={rowY + 8}
                      width={x2 - x1} height={ROW_HEIGHT - 16}
                      rx={4}
                      fill="var(--brand-soft)"
                      opacity={0.6}
                    />
                    {record ? (
                      <circle
                        cx={xForMonths(Number(record.ageAtEruptionDecimal) * 12)}
                        cy={rowY + ROW_HEIGHT / 2}
                        r={5}
                        fill={dotColor(record.deviation)}
                        aria-label={`Erupcionó ${record.observedAt}`}
                      >
                        <title>
                          {`Diente ${r.fdi} · erupcionó a ${Number(record.ageAtEruptionDecimal).toFixed(1)} a · ${labelDeviation(record.deviation)}`}
                        </title>
                      </circle>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="ped-eruption-chart__legend">
        <span className="ped-eruption-chart__legend-item"><span className="ped-eruption-chart__sw" style={{ background: "var(--brand-soft)" }} aria-hidden /> Rango esperado</span>
        <span className="ped-eruption-chart__legend-item"><span className="ped-eruption-chart__sw" style={{ background: "var(--success)" }} aria-hidden /> En rango</span>
        <span className="ped-eruption-chart__legend-item"><span className="ped-eruption-chart__sw" style={{ background: "var(--warning)" }} aria-hidden /> Desviación leve</span>
        <span className="ped-eruption-chart__legend-item"><span className="ped-eruption-chart__sw" style={{ background: "var(--danger)" }} aria-hidden /> Patológica</span>
        <span className="ped-eruption-chart__legend-item"><span className="ped-eruption-chart__sw" style={{ background: "var(--brand)" }} aria-hidden /> Edad actual</span>
      </div>
    </div>
  );
});

function dotColor(dev: string): string {
  if (dev === "within") return "var(--success)";
  if (dev === "mild" || dev === "early") return "var(--warning)";
  if (dev === "pathological") return "var(--danger)";
  return "var(--text-2)";
}

function labelDeviation(dev: string): string {
  if (dev === "within") return "dentro de rango";
  if (dev === "mild") return "desviación leve";
  if (dev === "early") return "erupción temprana";
  if (dev === "pathological") return "patológica";
  return dev;
}
