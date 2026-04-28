"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, AlertCircle, Clock, Database } from "lucide-react";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";
import { EfficiencyGauge } from "@/components/dashboard/analytics/efficiency-gauge";

interface OverviewData {
  monthAppts: number;
  prevAppts: number;
  apptsDeltaPct: number;
  completedMonth: number;
  prevCompletedMonth: number;
  completedDeltaPct: number;
  noShowMonth: number;
  noShowRate: number;
  noShowDeltaPct: number;
  avgWaitMin: number | null;
  todayCount: number;
  insufficientData: boolean;
  dataProgress: number;
  totalAppts: number;
}

interface Props {
  data: OverviewData;
}

export function OverviewClient({ data }: Props) {
  // Efficiency score se calcula client-side via API porque depende del
  // día actual (real-time) y de joins con users + agenda config. El
  // server-component KPI ya tiene el resto; solo este número parpadea
  // un instante mientras carga.
  const [score, setScore] = useState<{ today: number; monthAverage: number } | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/analytics/efficiency-score", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setScore({ today: d.today ?? 0, monthAverage: d.monthAverage ?? 0 });
        setScoreLoading(false);
      })
      .catch(() => setScoreLoading(false));
    return () => ctrl.abort();
  }, []);

  return (
    <AnalyticsLayout
      title="Resumen"
      subtitle="Métricas clave de tu clínica este mes"
    >
      {data.insufficientData && (
        <DataCollectingBanner progress={data.dataProgress} count={data.totalAppts} />
      )}

      {/* Top row: Gauge + 3 KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px repeat(3, 1fr)",
          gap: 14,
          marginBottom: 14,
        }}
      >
        {scoreLoading ? (
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              padding: 20,
              minHeight: 240,
              display: "grid",
              placeItems: "center",
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            Calculando…
          </div>
        ) : (
          <EfficiencyGauge score={score?.today ?? 0} monthAverage={score?.monthAverage ?? 0} />
        )}

        <AnalyticsCard
          label="Citas del mes"
          value={data.monthAppts.toLocaleString("es-MX")}
          delta={data.apptsDeltaPct !== 0 ? { pct: data.apptsDeltaPct } : null}
          hint="vs mes anterior"
          icon={<Calendar size={14} aria-hidden />}
          tone="brand"
        />
        <AnalyticsCard
          label="Completadas"
          value={data.completedMonth.toLocaleString("es-MX")}
          delta={data.completedDeltaPct !== 0 ? { pct: data.completedDeltaPct } : null}
          hint="vs mes anterior"
          icon={<CheckCircle2 size={14} aria-hidden />}
          tone="success"
        />
        <AnalyticsCard
          label="No-shows"
          value={`${data.noShowRate.toFixed(1)}%`}
          delta={
            data.noShowDeltaPct !== 0
              ? { pct: data.noShowDeltaPct, absolute: `${data.noShowMonth} citas` }
              : null
          }
          hint="del total del mes"
          icon={<AlertCircle size={14} aria-hidden />}
          tone={data.noShowRate > 10 ? "danger" : data.noShowRate > 5 ? "warning" : "neutral"}
        />
      </div>

      {/* Second row: tiempos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 14 }}>
        <AnalyticsCard
          label="Tiempo promedio de espera"
          value={
            data.avgWaitMin != null
              ? `${Math.round(data.avgWaitMin)} min`
              : "—"
          }
          hint={data.avgWaitMin == null ? "Sin datos suficientes (CHECKED_IN → IN_CHAIR)" : "promedio del mes"}
          icon={<Clock size={14} aria-hidden />}
          tone={data.avgWaitMin != null && data.avgWaitMin > 20 ? "warning" : "neutral"}
        />
        <AnalyticsCard
          label="Citas hoy"
          value={data.todayCount.toLocaleString("es-MX")}
          hint="agendadas (no canceladas)"
          icon={<Calendar size={14} aria-hidden />}
          tone="brand"
        />
      </div>
    </AnalyticsLayout>
  );
}

function DataCollectingBanner({ progress, count }: { progress: number; count: number }) {
  return (
    <div
      style={{
        background: "rgba(217, 119, 6, 0.08)",
        border: "1px solid rgba(217, 119, 6, 0.25)",
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 14,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "rgba(217, 119, 6, 0.15)",
          display: "grid",
          placeItems: "center",
          color: "#d97706",
          flexShrink: 0,
        }}
      >
        <Database size={16} aria-hidden />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>
          Recolectando datos para insights
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
          Llevas {count} citas registradas. Necesitamos al menos 30 para que las métricas
          comparativas sean confiables.
        </div>
        <div
          style={{
            height: 6,
            background: "rgba(217, 119, 6, 0.15)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "#d97706",
              transition: "width 0.4s",
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {progress}% del mínimo necesario
        </div>
      </div>
    </div>
  );
}
