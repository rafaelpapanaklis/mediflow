"use client";

import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text-1)",
} as const;

const PLAN_COLORS: Record<string, string> = {
  BASIC: "#64748b",
  PRO: "#2563eb",
  CLINIC: "#7c3aed",
};

export function PlanDonut({ data }: { data: { plan: string; count: number; mrr: number }[] }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="plan"
            innerRadius={55}
            outerRadius={92}
            paddingAngle={2}
            stroke="var(--bg-elev)"
          >
            {data.map((d) => (
              <Cell key={d.plan} fill={PLAN_COLORS[d.plan] || "#7c3aed"} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number, n: string) => [`${v} clínica(s)`, n]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ActivityBars({ data }: { data: { name: string; pacientes: number; citas: number }[] }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="name"
            stroke="var(--text-4)"
            tick={{ fontSize: 10, fill: "var(--text-4)" }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            stroke="var(--text-4)"
            tick={{ fontSize: 10, fill: "var(--text-4)" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={36}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(124,58,237,0.06)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="pacientes" name="Pacientes" fill="#7c3aed" radius={[4, 4, 0, 0]} />
          <Bar dataKey="citas" name="Citas" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
