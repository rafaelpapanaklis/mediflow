"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
interface Props { data: { day: string; amount: number }[] }
export function RevenueChart({ data }: Props) {
  const max = Math.max(...data.map(d => d.amount), 1);
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={28} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => v === 0 ? "" : `$${(v/1000).toFixed(0)}k`} />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, fontWeight: 600 }} formatter={(v: number) => [`$${v.toLocaleString("es-MX")}`, "Ingresos"]} cursor={{ fill: "#f1f5f9" }} />
          <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
            {data.map((entry, i) => <Cell key={i} fill={entry.amount === max ? "#2563eb" : "#bfdbfe"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
