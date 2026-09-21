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
  // Las cifras del tooltip alinean como las de las tablas.
  fontVariantNumeric: "tabular-nums",
} as const;

/**
 * Color de cada plan. Son TOKENS, no hexes: `fill` de SVG entiende `var(…)`,
 * así que la gráfica cambia sola entre claro y oscuro igual que el resto del
 * panel. Antes eran tres hexes copiados a mano que en oscuro se veían planos.
 * Un plan que no esté en la tabla se pinta con el color de marca.
 */
const PLAN_COLORS: Record<string, string> = {
  BASIC: "var(--text-3)",
  PRO: "var(--brand-blue)",
  CLINIC: "var(--brand)",
};
const COLOR_PLAN_DESCONOCIDO = "var(--brand)";

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
              <Cell key={d.plan} fill={PLAN_COLORS[d.plan] || COLOR_PLAN_DESCONOCIDO} />
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
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
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--brand-softer)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="pacientes" name="Pacientes" fill="var(--brand)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="citas" name="Citas" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
