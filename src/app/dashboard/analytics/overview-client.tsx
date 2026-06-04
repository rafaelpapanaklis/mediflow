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
            {t("analytics.overview.calculating")}
          </div>
        ) : (
          <EfficiencyGauge score={score?.today ?? 0} monthAverage={score?.monthAverage ?? 0} />
        )}

        <AnalyticsCard
          label={t("analytics.overview.apptsThisMonth")}
          value={data.monthAppts.toLocaleString("es-MX")}
          delta={data.apptsDeltaPct !== 0 ? { pct: data.apptsDeltaPct } : null}
          hint={t("analytics.overview.vsPrevMonth")}
          icon={<Calendar size={14} aria-hidden />}
          tone="brand"
        />
        <AnalyticsCard
          label={t("analytics.overview.completed")}
          value={data.completedMonth.toLocaleString("es-MX")}
          delta={data.completedDeltaPct !== 0 ? { pct: data.completedDeltaPct } : null}
          hint={t("analytics.overview.vsPrevMonth")}
          icon={<CheckCircle2 size={14} aria-hidden />}
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
          icon={<AlertCircle size={14} aria-hidden />}
          tone={data.noShowRate > 10 ? "danger" : data.noShowRate > 5 ? "warning" : "neutral"}
        />
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
          icon={<Clock size={14} aria-hidden />}
          tone={data.avgWaitMin != null && data.avgWaitMin > 20 ? "warning" : "neutral"}
        />
        <AnalyticsCard
          label={t("analytics.overview.apptsToday")}
          value={data.todayCount.toLocaleString("es-MX")}
          hint={t("analytics.overview.scheduledNotCancelled")}
          icon={<Calendar size={14} aria-hidden />}
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
          {t("analytics.overview.collectingData")}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
          {t("analytics.overview.collectingDataDesc", { count })}
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
          {t("analytics.overview.percentOfMinimum", { progress })}
        </div>
      </div>
    </div>
  );
}
