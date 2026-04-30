"use client";
// Pediatrics — timeline horizontal de hábitos orales. SVG custom. Spec: §1.10, §4.A.6

import { memo, useMemo } from "react";
import { Hand, Baby, MoonStar, Wind, Activity, Fingerprint, Droplets, type LucideIcon } from "lucide-react";
import type { OralHabitRow } from "@/types/pediatrics";

export interface HabitsTimelineProps {
  patientDob: Date;
  habits: OralHabitRow[];
  refDate?: Date;
  onHabitClick?: (id: string) => void;
}

const HABIT_META: Record<string, { label: string; Icon: LucideIcon }> = {
  succion_digital:    { label: "Succión digital",     Icon: Hand },
  chupon:             { label: "Chupón",              Icon: Baby },
  biberon_nocturno:   { label: "Biberón nocturno",    Icon: MoonStar },
  respiracion_bucal:  { label: "Respiración bucal",   Icon: Wind },
  bruxismo_nocturno:  { label: "Bruxismo nocturno",   Icon: Activity },
  onicofagia:         { label: "Onicofagia",          Icon: Fingerprint },
  deglucion_atipica:  { label: "Deglución atípica",   Icon: Droplets },
};

const ROW_HEIGHT = 56;
const HEADER_H = 28;
const LABEL_W = 200;
const PAD_X = 12;
const TOTAL_YEARS = 14;

export const HabitsTimeline = memo(function HabitsTimeline(props: HabitsTimelineProps) {
  const { patientDob, habits, refDate = new Date(), onHabitClick } = props;
  const visible = habits.filter((h) => !h.deletedAt);

  const totalH = HEADER_H + (visible.length === 0 ? 60 : visible.length * ROW_HEIGHT) + 12;
  const chartW = 880;
  const innerW = chartW - LABEL_W - PAD_X * 2;

  const dobMs = patientDob.getTime();
  const refMs = refDate.getTime();
  const yearsLived = (refMs - dobMs) / (1000 * 60 * 60 * 24 * 365.25);

  const xForYears = (y: number) => LABEL_W + PAD_X + (Math.max(0, Math.min(y, TOTAL_YEARS)) / TOTAL_YEARS) * innerW;
  const ageX = xForYears(yearsLived);

  const computed = useMemo(() => {
    return visible.map((h) => {
      const startYears = Math.max(0, (h.startedAt.getTime() - dobMs) / (1000 * 60 * 60 * 24 * 365.25));
      const endYears = h.endedAt
        ? Math.max(startYears, (h.endedAt.getTime() - dobMs) / (1000 * 60 * 60 * 24 * 365.25))
        : yearsLived;
      const active = h.endedAt == null;
      const meta = HABIT_META[h.habitType] ?? { label: h.habitType, Icon: Hand };
      return { habit: h, startYears, endYears, active, meta };
    });
  }, [visible, dobMs, yearsLived]);

  return (
    <div className="ped-habits-timeline" role="img" aria-label="Línea de tiempo de hábitos orales">
      <svg width="100%" viewBox={`0 0 ${chartW} ${totalH}`} preserveAspectRatio="xMidYMid meet">
        {/* Eje X */}
        {Array.from({ length: TOTAL_YEARS + 1 }, (_, i) => {
          const x = xForYears(i);
          return (
            <g key={i} aria-hidden>
              <line x1={x} y1={HEADER_H - 8} x2={x} y2={totalH - 8} stroke="var(--border-soft)" strokeWidth={i % 2 === 0 ? 1 : 0.4} />
              {i % 2 === 0 ? (
                <text x={x} y={HEADER_H - 12} textAnchor="middle" fontSize={10} fill="var(--text-2)">
                  {i}a
                </text>
              ) : null}
            </g>
          );
        })}

        <line x1={ageX} y1={HEADER_H} x2={ageX} y2={totalH - 8} className="eruption-needle" aria-label="Edad actual" />

        {visible.length === 0 ? (
          <text x={chartW / 2} y={HEADER_H + 30} textAnchor="middle" fontSize={12} fill="var(--text-2)">
            Sin hábitos registrados.
          </text>
        ) : computed.map((c, idx) => {
          const y = HEADER_H + idx * ROW_HEIGHT;
          const x1 = xForYears(c.startYears);
          const x2 = xForYears(c.endYears);
          const fill = c.active ? "var(--warning-soft)" : "var(--success-soft)";
          const stroke = c.active ? "var(--warning)" : "var(--success)";

          return (
            <g
              key={c.habit.id}
              onClick={() => onHabitClick?.(c.habit.id)}
              style={{ cursor: onHabitClick ? "pointer" : "default" }}
              role={onHabitClick ? "button" : undefined}
            >
              <foreignObject x={0} y={y + 8} width={LABEL_W - 4} height={ROW_HEIGHT - 16}>
                <div className="ped-habits-timeline__label">
                  <c.meta.Icon size={14} aria-hidden />
                  <div>
                    <div className="ped-habits-timeline__label-name">{c.meta.label}</div>
                    <div className="ped-habits-timeline__label-status">
                      {c.active ? "Activa" : "Resuelta"} · {c.habit.frequency}
                    </div>
                  </div>
                </div>
              </foreignObject>
              <rect
                x={LABEL_W + PAD_X} y={y + 18}
                width={innerW} height={ROW_HEIGHT - 36}
                rx={4}
                fill="var(--bg-elev-2)"
              />
              <rect
                x={x1} y={y + 16}
                width={Math.max(2, x2 - x1)} height={ROW_HEIGHT - 32}
                rx={4}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5}
              >
                <title>{`${c.meta.label} · ${c.habit.frequency} · ${c.active ? "activa" : "resuelta"}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
