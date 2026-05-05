"use client";
// Endodontics — chart de tasa de éxito personal del doctor. Spec §6.15, §11.3

import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";
import type { CategoryBreakdown } from "@/lib/helpers/successRateCalculator";

const CATEGORY_LABEL: Record<string, string> = {
  anterior: "Anterior",
  premolar: "Premolar",
  molar: "Molar",
};

export interface SuccessRateChartProps {
  data: CategoryBreakdown[];
  height?: number;
}

export function SuccessRateChart({ data, height = 280 }: SuccessRateChartProps) {
  const series = data.map((d) => ({
    category: CATEGORY_LABEL[d.category] ?? d.category,
    "12 meses": d.successRate12m,
    "24 meses": d.successRate24m,
    treatments: d.treatments,
  }));

  if (data.length === 0 || data.every((d) => d.treatments === 0)) {
    return (
      <div className="endo-section">
        <p className="endo-section__placeholder">
          Sin tratamientos completados aún. Cuando completes TC y cierres
          controles, este dashboard mostrará tu tasa de éxito.
        </p>
      </div>
    );
  }

  return (
    <div className="endo-section endo-success-chart" style={{ height }}>
      <header className="endo-success-chart__header">
        <p className="endo-section__eyebrow">Dashboard</p>
        <h2 className="endo-section__title">Tasa de éxito por categoría de diente</h2>
      </header>
      <ResponsiveContainer width="100%" height="80%">
        <BarChart data={series} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
          <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="category" stroke="var(--text-2)" fontSize={11} tickLine={false} />
          <YAxis stroke="var(--text-2)" fontSize={11} tickLine={false} unit="%" domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-1)",
            }}
            formatter={(value: number, key: string, item) => {
              if (key === "treatments") return [`${value}`, "tratamientos"];
              return [`${value}%`, key];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="12 meses" fill="var(--success)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="24 meses" fill="var(--info)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
