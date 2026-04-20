"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface Point { label: string; value: number }

export function RevenueAreaChart({ data }: { data: Point[] }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="mfRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#7c3aed" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" stroke="var(--text-4)" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
          <YAxis stroke="var(--text-4)" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} width={50}
            tickFormatter={(v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`} />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-1)",
            }}
            cursor={{ stroke: "rgba(124,58,237,0.35)" }}
            formatter={(v: number) => [`$${Number(v).toLocaleString("es-MX")}`, "Ingresos"]}
          />
          <Area type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2} fill="url(#mfRevenueFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
