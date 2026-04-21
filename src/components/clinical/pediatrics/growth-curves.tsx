"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Scatter,
  ComposedChart,
} from "recharts";
import { TrendingUp } from "lucide-react";

interface GrowthCurvesProps {
  metric: "weight-age" | "height-age" | "bmi-age";
  gender: "M" | "F";
  ageMonths: number;
  value: number;
  history?: { ageMonths: number; value: number }[];
}

type P50Table = Record<number, number>;

const P50_WEIGHT_M: P50Table = {
  0: 3.3, 12: 9.6, 24: 12.2, 36: 14.3, 48: 16.3, 60: 18.3,
  72: 20.5, 84: 22.9, 96: 25.4, 108: 28.1, 120: 31,
  132: 34.4, 144: 38.8, 156: 44.2, 168: 50, 180: 57,
  192: 62, 204: 65, 216: 67, 228: 68,
};

const P50_HEIGHT_M: P50Table = {
  0: 49.9, 12: 75.7, 24: 87.1, 36: 96, 48: 103, 60: 110,
  72: 116, 84: 122, 96: 128, 108: 133, 120: 138,
  132: 143, 144: 149, 156: 156, 168: 163, 180: 170,
  192: 173, 204: 175, 216: 176, 228: 176,
};

const P50_BMI_M: P50Table = {
  0: 13.4, 12: 17.2, 24: 16.4, 36: 15.7, 48: 15.3, 60: 15.2,
  72: 15.3, 84: 15.5, 96: 15.8, 108: 16.2, 120: 16.6,
  132: 17.1, 144: 17.8, 156: 18.5, 168: 19.2, 180: 20,
  192: 20.8, 204: 21.5, 216: 22.1, 228: 22.5,
};

function applyFemale(v: number, metric: GrowthCurvesProps["metric"]): number {
  if (metric === "weight-age") return v * 0.95;
  if (metric === "height-age") return v * 0.97;
  return v * 0.98;
}

function getP50Table(metric: GrowthCurvesProps["metric"], gender: "M" | "F"): P50Table {
  const base = metric === "weight-age" ? P50_WEIGHT_M : metric === "height-age" ? P50_HEIGHT_M : P50_BMI_M;
  if (gender === "M") return base;
  const out: P50Table = {};
  for (const k of Object.keys(base)) {
    const age = Number(k);
    out[age] = applyFemale(base[age], metric);
  }
  return out;
}

function interpolate(table: P50Table, ageMonths: number): number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (ageMonths <= keys[0]) return table[keys[0]];
  if (ageMonths >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (ageMonths >= a && ageMonths <= b) {
      const t = (ageMonths - a) / (b - a);
      return table[a] + (table[b] - table[a]) * t;
    }
  }
  return table[keys[keys.length - 1]];
}

const P_FACTORS: Record<string, number> = {
  P3: 0.82,
  P10: 0.88,
  P25: 0.94,
  P50: 1.0,
  P75: 1.06,
  P90: 1.12,
  P97: 1.18,
};

function calculatePercentile(p50Value: number, patientValue: number): string {
  const ratio = patientValue / p50Value;
  const entries = Object.entries(P_FACTORS);
  let closest = entries[0];
  let minDiff = Math.abs(ratio - entries[0][1]);
  for (const e of entries) {
    const d = Math.abs(ratio - e[1]);
    if (d < minDiff) {
      minDiff = d;
      closest = e;
    }
  }
  if (ratio < 0.82) return "<P3";
  if (ratio > 1.18) return ">P97";
  return closest[0];
}

export function GrowthCurves({
  metric,
  gender,
  ageMonths,
  value,
  history = [],
}: GrowthCurvesProps) {
  const metricLabels: Record<GrowthCurvesProps["metric"], { title: string; unit: string; yLabel: string }> = {
    "weight-age": { title: "Peso / Edad", unit: "kg", yLabel: "Peso (kg)" },
    "height-age": { title: "Talla / Edad", unit: "cm", yLabel: "Talla (cm)" },
    "bmi-age": { title: "IMC / Edad", unit: "kg/m²", yLabel: "IMC (kg/m²)" },
  };

  const { data, patientPercentile } = useMemo(() => {
    const table = getP50Table(metric, gender);
    const ages: number[] = [];
    for (let a = 0; a <= 228; a += 6) ages.push(a);

    const data = ages.map((age) => {
      const p50 = interpolate(table, age);
      return {
        age,
        P3: +(p50 * P_FACTORS.P3).toFixed(2),
        P10: +(p50 * P_FACTORS.P10).toFixed(2),
        P25: +(p50 * P_FACTORS.P25).toFixed(2),
        P50: +p50.toFixed(2),
        P75: +(p50 * P_FACTORS.P75).toFixed(2),
        P90: +(p50 * P_FACTORS.P90).toFixed(2),
        P97: +(p50 * P_FACTORS.P97).toFixed(2),
      };
    });

    const p50Now = interpolate(table, ageMonths);
    const patientPercentile = calculatePercentile(p50Now, value);

    return { data, patientPercentile };
  }, [metric, gender, ageMonths, value]);

  const patientPoints = useMemo(() => {
    const pts = [...history.map((h) => ({ age: h.ageMonths, patient: h.value })), { age: ageMonths, patient: value }];
    return pts.sort((a, b) => a.age - b.age);
  }, [history, ageMonths, value]);

  const mergedData = useMemo(() => {
    return data.map((d) => {
      const pt = patientPoints.find((p) => Math.abs(p.age - d.age) < 3);
      return pt ? { ...d, patient: pt.patient } : d;
    });
  }, [data, patientPoints]);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TrendingUp size={18} color="var(--brand)" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
              {metricLabels[metric].title} · {gender === "M" ? "Masculino" : "Femenino"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              {ageMonths} meses · {value} {metricLabels[metric].unit}
            </div>
          </div>
        </div>
        <div
          style={{
            padding: "6px 12px",
            background: "rgba(124,58,237,0.15)",
            border: "1px solid rgba(124,58,237,0.3)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--text-1)",
            fontWeight: 600,
          }}
        >
          Percentil: {patientPercentile}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={mergedData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 10, fill: "var(--text-2)" }}
            label={{ value: "Edad (meses)", position: "insideBottom", offset: -5, fontSize: 11, fill: "var(--text-2)" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--text-2)" }}
            label={{ value: metricLabels[metric].yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--text-2)" }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="P3" stroke="#ef4444" strokeWidth={1} dot={false} />
          <Line type="monotone" dataKey="P10" stroke="#94a3b8" strokeWidth={0.8} dot={false} strokeDasharray="3 3" />
          <Line type="monotone" dataKey="P25" stroke="#94a3b8" strokeWidth={0.8} dot={false} strokeDasharray="3 3" />
          <Line type="monotone" dataKey="P50" stroke="#34d399" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="P75" stroke="#94a3b8" strokeWidth={0.8} dot={false} strokeDasharray="3 3" />
          <Line type="monotone" dataKey="P90" stroke="#94a3b8" strokeWidth={0.8} dot={false} strokeDasharray="3 3" />
          <Line type="monotone" dataKey="P97" stroke="#ef4444" strokeWidth={1} dot={false} />
          <Line
            type="monotone"
            dataKey="patient"
            stroke="#7c3aed"
            strokeWidth={3}
            dot={{ r: 5, fill: "#7c3aed", stroke: "#fff", strokeWidth: 1 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
