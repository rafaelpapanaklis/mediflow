"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

interface EvolutionChartProps {
  data: { date: string; value: number; label?: string }[];
  metric: string;
  color: string;
  targetValue?: number;
  normalRange?: { min: number; max: number };
  unit?: string;
  height?: number;
}

export function EvolutionChart({
  data,
  metric,
  color,
  targetValue,
  normalRange,
  unit,
  height = 220,
}: EvolutionChartProps) {
  const gradientId = useMemo(
    () => `evo-grad-${Math.random().toString(36).slice(2, 9)}`,
    []
  );

  if (!data || data.length < 2) {
    return (
      <div
        className="card"
        style={{
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: height + 80,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>
          Agrega 2+ registros para ver evolución
        </div>
      </div>
    );
  }

  const current = data[data.length - 1].value;
  const first = data[0].value;
  const delta = current - first;
  const deltaPct = first !== 0 ? (delta / Math.abs(first)) * 100 : 0;
  const isPositive = delta >= 0;
  const deltaColor = isPositive ? "#34d399" : "#ef4444";
  const DeltaIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>
            {metric}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              fontFamily: "Sora, sans-serif",
              color: "var(--text-1)",
              lineHeight: 1,
            }}
          >
            {current}
            {unit && (
              <span
                style={{
                  fontSize: 14,
                  color: "var(--text-2)",
                  marginLeft: 4,
                  fontWeight: 400,
                }}
              >
                {unit}
              </span>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: deltaColor,
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          <DeltaIcon size={14} />
          {isPositive ? "+" : ""}
          {delta.toFixed(1)} ({deltaPct.toFixed(1)}%)
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              fill: "var(--text-2)",
            }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              fill: "var(--text-2)",
            }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              padding: 8,
              fontSize: 11,
              borderRadius: 6,
            }}
            labelStyle={{ color: "var(--text-2)" }}
            itemStyle={{ color: "var(--text-1)" }}
          />
          {normalRange && (
            <ReferenceArea
              y1={normalRange.min}
              y2={normalRange.max}
              fill={color}
              fillOpacity={0.06}
            />
          )}
          {targetValue !== undefined && (
            <ReferenceLine
              y={targetValue}
              stroke={color}
              strokeDasharray="3 3"
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 3, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
