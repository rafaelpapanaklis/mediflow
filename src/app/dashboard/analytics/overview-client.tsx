"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, AlertCircle, Clock, Database } from "lucide-react";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";
import { EfficiencyGauge } from "@/components/dashboard/analytics/efficiency-gauge";
import { useT } from "@/i18n/i18n-provider";

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
  const t = useT();
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
      title={t("analytics.overview.title")}
      subtitle={t("analytics.overview.subtitle")}
    >
      {data.insufficientData && (
        <DataCollectingBanner progress={data.dataProgress} count={data.totalAppts} />
      )}

      {/* Top row: Gauge + 3 KPIs.
          Envoltorio con container-type: inline-size para que el layout
          responda al ancho REAL del contenido (dentro de AnalyticsLayout,
          que reparte 220px al tab-sidebar), no al viewport. Sin
          descendientes position:fixed aquí (gauge y AnalyticsCard son
          estáticos), así que es un sitio limpio para el contenedor. */}
      <div style={{ containerType: "inline-size" }}>
        <style>{`
          @container (max-width: 820px) {
            .ov-top-row { grid-template-columns: 1fr; }
            .ov-kpi-trio {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 14px;
            }
          }
          @container (max-width: 480px) {
            .ov-kpi-trio { grid-template-columns: 1fr; }
          }
        `}</style>
        <div
          className="ov-top-row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 260px) repeat(3, minmax(0, 1fr))",
            gap: 14,
            marginBottom: 14,
          }}
        >
        {scoreLoading ? (
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-1)",
              padding: 20,
              minHeight: 240,
              display: "grid",
              placeItems: "center",
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            {t("analytics.overview.calculating")}
          </div>
        ) : (
          <EfficiencyGauge score={score?.today ?? 0} monthAverage={score?.monthAverage ?? 0} />
        )}

        {/* display: contents por defecto: a 1440px (y en general mientras
            .ov-top-row siga en 4 columnas) este wrapper es invisible para el
            grid — las 3 tarjetas quedan como items directos, igual que hoy.
            Solo cuando @container activa .ov-kpi-trio (arriba) este div pasa
            a ser su propia rejilla de 3 columnas, ya sin competir por ancho
            con la columna fija del gauge. */}
        <div className="ov-kpi-trio" style={{ display: "contents" }}>
          <AnalyticsCard
            className="kpi--hero"
            label={t("analytics.overview.apptsThisMonth")}
            value={data.monthAppts.toLocaleString("es-MX")}
            delta={data.apptsDeltaPct !== 0 ? { pct: data.apptsDeltaPct } : null}
            hint={t("analytics.overview.vsPrevMonth")}
            icon={<Calendar size={16} strokeWidth={1.75} aria-hidden />}
            tone="brand"
          />
          <AnalyticsCard
            label={t("analytics.overview.completed")}
            value={data.completedMonth.toLocaleString("es-MX")}
            delta={data.completedDeltaPct !== 0 ? { pct: data.completedDeltaPct } : null}
            hint={t("analytics.overview.vsPrevMonth")}
            icon={<CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />}
            tone="success"
          />
          <AnalyticsCard
            label={t("analytics.overview.noShows")}
            value={`${data.noShowRate.toFixed(1)}%`}
            delta={
              data.noShowDeltaPct !== 0
                ? { pct: data.noShowDeltaPct, absolute: t("analytics.overview.apptsCount", { count: data.noShowMonth }) }
                : null
            }
            hint={t("analytics.overview.ofMonthTotal")}
            icon={<AlertCircle size={16} strokeWidth={1.75} aria-hidden />}
            tone={data.noShowRate > 10 ? "danger" : data.noShowRate > 5 ? "warning" : "neutral"}
          />
        </div>
        </div>
      </div>

      {/* Second row: tiempos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 14 }}>
        <AnalyticsCard
          label={t("analytics.overview.avgWaitTime")}
          value={
            data.avgWaitMin != null
              ? t("analytics.overview.minutesValue", { count: Math.round(data.avgWaitMin) })
              : "—"
          }
          hint={data.avgWaitMin == null ? t("analytics.overview.notEnoughDataWait") : t("analytics.overview.monthAverage")}
          icon={<Clock size={16} strokeWidth={1.75} aria-hidden />}
          tone={data.avgWaitMin != null && data.avgWaitMin > 20 ? "warning" : "neutral"}
        />
        <AnalyticsCard
          label={t("analytics.overview.apptsToday")}
          value={data.todayCount.toLocaleString("es-MX")}
          hint={t("analytics.overview.scheduledNotCancelled")}
          icon={<Calendar size={16} strokeWidth={1.75} aria-hidden />}
          tone="brand"
        />
      </div>
    </AnalyticsLayout>
  );
}

function DataCollectingBanner({ progress, count }: { progress: number; count: number }) {
  const t = useT();
  return (
    <div
      style={{
        background: "var(--warning-soft)",
        border: "1px solid var(--warning-border-strong)",
        borderRadius: "var(--radius-lg)",
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
          background: "var(--warning-soft-strong)",
          display: "grid",
          placeItems: "center",
          color: "var(--warning)",
          flexShrink: 0,
        }}
      >
        <Database size={16} strokeWidth={1.75} aria-hidden />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--warning-strong)", marginBottom: 4 }}>
          {t("analytics.overview.collectingData")}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
          {t("analytics.overview.collectingDataDesc", { count })}
        </div>
        <div
          style={{
            height: 6,
            background: "var(--warning-soft-strong)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "var(--warning)",
              transition: "width 0.4s",
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {t("analytics.overview.percentOfMinimum", { progress })}
        </div>
      </div>
    </div>
  );
}
