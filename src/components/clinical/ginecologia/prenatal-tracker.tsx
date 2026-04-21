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
} from "recharts";
import { Baby, Calendar, CheckCircle2, Circle } from "lucide-react";

interface PrenatalProps {
  fum: string | Date;
  currentWeight?: number;
  fundalHeight?: number;
  fetalHeartRate?: number;
  measurements?: { weeks: number; fundal: number }[];
}

interface Milestone {
  weekStart: number;
  weekEnd: number;
  label: string;
  trimester: 1 | 2 | 3;
}

const MILESTONES: Milestone[] = [
  { weekStart: 6, weekEnd: 10, label: "Primera consulta prenatal", trimester: 1 },
  { weekStart: 8, weekEnd: 12, label: "US fetal temprano", trimester: 1 },
  { weekStart: 10, weekEnd: 13, label: "Laboratorios iniciales (hemograma, grupo Rh, VIH, VDRL)", trimester: 1 },
  { weekStart: 11, weekEnd: 13, label: "Translucencia nucal", trimester: 1 },
  { weekStart: 18, weekEnd: 22, label: "US morfológico", trimester: 2 },
  { weekStart: 24, weekEnd: 28, label: "Test tolerancia glucosa (CTOG)", trimester: 2 },
  { weekStart: 28, weekEnd: 28, label: "Inmunoglobulina anti-D (si Rh-)", trimester: 3 },
  { weekStart: 32, weekEnd: 34, label: "US crecimiento fetal", trimester: 3 },
  { weekStart: 35, weekEnd: 37, label: "Cultivo estreptococo grupo B", trimester: 3 },
  { weekStart: 36, weekEnd: 40, label: "Monitoreo semanal", trimester: 3 },
];

function parseDate(d: string | Date): Date {
  return d instanceof Date ? d : new Date(d);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export function PrenatalTracker({
  fum,
  currentWeight,
  fundalHeight,
  fetalHeartRate,
  measurements = [],
}: PrenatalProps) {
  const fumDate = useMemo(() => parseDate(fum), [fum]);
  const fpp = useMemo(() => addDays(fumDate, 280), [fumDate]);
  const currentWeeks = useMemo(() => {
    const diffMs = Date.now() - fumDate.getTime();
    const weeks = diffMs / (1000 * 60 * 60 * 24 * 7);
    return Math.max(0, Math.min(42, Math.round(weeks * 10) / 10));
  }, [fumDate]);

  const trimester: 1 | 2 | 3 = currentWeeks < 14 ? 1 : currentWeeks < 28 ? 2 : 3;
  const progressPct = Math.min(100, (currentWeeks / 40) * 100);

  const chartData = useMemo(() => {
    const data: { weeks: number; teorico: number; paciente?: number }[] = [];
    for (let w = 12; w <= 40; w++) {
      const teorico = w;
      const match = measurements.find((m) => Math.abs(m.weeks - w) < 0.5);
      data.push({ weeks: w, teorico, paciente: match?.fundal });
    }
    if (fundalHeight !== undefined && currentWeeks >= 12) {
      const idx = data.findIndex((d) => Math.abs(d.weeks - currentWeeks) < 1);
      if (idx >= 0) data[idx] = { ...data[idx], paciente: fundalHeight };
    }
    return data;
  }, [measurements, currentWeeks, fundalHeight]);

  function milestoneStatus(m: Milestone): "done" | "active" | "pending" {
    if (currentWeeks > m.weekEnd) return "done";
    if (currentWeeks >= m.weekStart && currentWeeks <= m.weekEnd) return "active";
    return "pending";
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Baby size={20} color="var(--brand)" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
              Tracker prenatal
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              Trimestre {trimester} · {currentWeeks} semanas
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
            <Calendar size={12} />
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase" }}>FUM</div>
              <div style={{ color: "var(--text-1)", fontWeight: 600 }}>{formatDate(fumDate)}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
            <Calendar size={12} color="#fbbf24" />
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase" }}>FPP</div>
              <div style={{ color: "#fbbf24", fontWeight: 600 }}>{formatDate(fpp)}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--text-2)",
            marginBottom: 6,
          }}
        >
          <span>0 sem</span>
          <span>13 sem (T1)</span>
          <span>27 sem (T2)</span>
          <span>40 sem (T3)</span>
        </div>
        <div
          style={{
            position: "relative",
            height: 14,
            background: "rgba(255,255,255,0.05)",
            borderRadius: 7,
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "32.5%",
              background: "rgba(52,211,153,0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "32.5%",
              height: "100%",
              width: "35%",
              background: "rgba(56,189,248,0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "67.5%",
              height: "100%",
              width: "32.5%",
              background: "rgba(251,191,36,0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
              opacity: 0.8,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: -3,
              left: `calc(${progressPct}% - 8px)`,
              width: 16,
              height: 20,
              background: "var(--brand)",
              borderRadius: 4,
              boxShadow: "0 0 6px var(--brand)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {Math.round(currentWeeks)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {currentWeight !== undefined && (
          <div
            style={{
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase" }}>Peso actual</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>{currentWeight} kg</div>
          </div>
        )}
        {fundalHeight !== undefined && (
          <div
            style={{
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase" }}>Altura uterina</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>{fundalHeight} cm</div>
          </div>
        )}
        {fetalHeartRate !== undefined && (
          <div
            style={{
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase" }}>FCF</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#34d399" }}>{fetalHeartRate} lpm</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-1)",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Hitos del embarazo
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {MILESTONES.map((m, i) => {
            const status = milestoneStatus(m);
            const color =
              status === "done" ? "#34d399" : status === "active" ? "#fbbf24" : "var(--text-2)";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background:
                    status === "active"
                      ? "rgba(251,191,36,0.1)"
                      : status === "done"
                      ? "rgba(52,211,153,0.05)"
                      : "transparent",
                  border: `1px solid ${
                    status === "active"
                      ? "rgba(251,191,36,0.3)"
                      : status === "done"
                      ? "rgba(52,211,153,0.2)"
                      : "var(--border)"
                  }`,
                  fontSize: 12,
                }}
              >
                {status === "done" ? (
                  <CheckCircle2 size={14} color={color} />
                ) : (
                  <Circle size={14} color={color} />
                )}
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 10,
                    color,
                    minWidth: 68,
                  }}
                >
                  Sem {m.weekStart}
                  {m.weekEnd !== m.weekStart ? `-${m.weekEnd}` : ""}
                </span>
                <span style={{ color: status === "pending" ? "var(--text-2)" : "var(--text-1)" }}>
                  {m.label}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9,
                    textTransform: "uppercase",
                    color,
                    fontWeight: 600,
                  }}
                >
                  {status === "done" ? "Completado" : status === "active" ? "En curso" : "Pendiente"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-1)",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Altura uterina vs. edad gestacional
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="weeks"
              tick={{ fontSize: 10, fill: "var(--text-2)" }}
              label={{ value: "Semanas", position: "insideBottom", offset: -5, fontSize: 11, fill: "var(--text-2)" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-2)" }}
              label={{ value: "Altura (cm)", angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--text-2)" }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 11,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="teorico"
              stroke="#a78bfa"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              name="Teórico"
            />
            <Line
              type="monotone"
              dataKey="paciente"
              stroke="#7c3aed"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#7c3aed", stroke: "#fff", strokeWidth: 1 }}
              connectNulls
              name="Paciente"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
