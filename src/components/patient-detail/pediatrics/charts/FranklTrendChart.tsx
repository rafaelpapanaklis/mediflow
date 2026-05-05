"use client";
// Pediatrics — tendencia conductual (Frankl/Venham). Recharts. Spec: §1.11, §4.A.6

import { memo, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotProps,
} from "recharts";

export type BehaviorScale = "frankl" | "venham";

export interface FranklTrendDatum {
  index: number;
  date: Date;
  value: number;
  notes?: string | null;
}

export interface FranklTrendChartProps {
  scale: BehaviorScale;
  data: FranklTrendDatum[];
  height?: number;
}

export const FranklTrendChart = memo(function FranklTrendChart(props: FranklTrendChartProps) {
  const { scale, data, height = 220 } = props;

  const yDomain: [number, number] = scale === "frankl" ? [1, 4] : [0, 5];
  const ticks = scale === "frankl" ? [1, 2, 3, 4] : [0, 1, 2, 3, 4, 5];

  const series = useMemo(
    () => data.map((d) => ({ index: d.index, value: d.value, date: d.date.toISOString(), notes: d.notes })),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className="ped-frankl-chart ped-frankl-chart--empty" style={{ height }}>
        <p>Sin datos de conducta todavía. Captura el primer Frankl en la pestaña.</p>
      </div>
    );
  }

  return (
    <div className="ped-frankl-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 12, right: 18, left: 0, bottom: 12 }}>
          <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="index"
            tickFormatter={(v) => `V${v}`}
            stroke="var(--text-2)"
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            ticks={ticks}
            stroke="var(--text-2)"
            fontSize={11}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-1)",
            }}
            formatter={(value: number | string) => [`${value}`, scale === "frankl" ? "Frankl" : "Venham"]}
            labelFormatter={(label, payload) => {
              const p = (payload as Array<{ payload?: { date?: string } }> | undefined)?.[0]?.payload;
              if (p?.date) {
                return new Date(p.date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
              }
              return `Visita ${label}`;
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--brand)"
            strokeWidth={2}
            dot={(p: DotProps & { payload?: { value: number } }) =>
              p.cx != null && p.cy != null ? (
                <circle
                  key={`${p.cx}-${p.cy}`}
                  cx={p.cx}
                  cy={p.cy}
                  r={5}
                  fill={dotColorForScale(scale, p.payload?.value)}
                  stroke="var(--bg-elev)"
                  strokeWidth={2}
                />
              ) : <circle cx={0} cy={0} r={0} />
            }
            activeDot={{ r: 7 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

function dotColorForScale(scale: BehaviorScale, value: number | undefined): string {
  if (value == null) return "var(--text-2)";
  if (scale === "frankl") {
    if (value === 1) return "var(--danger)";
    if (value === 2) return "var(--warning)";
    if (value === 3) return "var(--info)";
    if (value === 4) return "var(--success)";
  }
  if (value <= 1) return "var(--success)";
  if (value <= 2) return "var(--info)";
  if (value <= 3) return "var(--warning)";
  return "var(--danger)";
}
