"use client";

import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";
import { AnalyticsHeatmap } from "@/components/dashboard/analytics/analytics-heatmap";
import { useT } from "@/i18n/i18n-provider";

interface HourStat { hour: number; avgMin: number; count: number; longWaits: number }
interface LongWait {
  appointmentId: string;
  waitedMin: number;
  type: string;
  patient: string;
  doctor: string;
}
interface ApiResponse {
  threshold: number;
  overallAvg: number;
  overallMedian: number;
  sampleSize: number;
  hours: number[];
  byHour: HourStat[];
  heatmap: Array<Array<{ value: number; count: number }>>;
  longWaits: LongWait[];
}

export function WaitingRoomClient() {
  const t = useT();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/analytics/waiting-room")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return;
          if (d) setData(d as ApiResponse);
          setLoading(false);
        })
        .catch(() => { if (!cancelled) setLoading(false); });
    }
    load();
    // Refresh longWaits cada 60s — alertas en tiempo real.
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <AnalyticsLayout
      title={t("analytics.waitingRoom.title")}
      subtitle={t("analytics.waitingRoom.subtitle")}
    >
      {loading ? (
        <Box>{t("common.loading")}</Box>
      ) : !data || data.sampleSize === 0 ? (
        <Box>
          <strong style={{ color: "var(--text-2)" }}>{t("analytics.waitingRoom.emptyTitle")}</strong>
          <div style={{ marginTop: 6, color: "var(--text-3)", fontSize: 13 }}>
            {t("analytics.waitingRoom.emptyHint")}
          </div>
        </Box>
      ) : (
        <>
          {/* Alertas en tiempo real arriba */}
          {data.longWaits.length > 0 && (
            <div
              style={{
                marginBottom: 14,
                background: "rgba(220, 38, 38, 0.08)",
                border: "1px solid rgba(220, 38, 38, 0.30)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#dc2626", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} aria-hidden />
                {t("analytics.waitingRoom.alertBanner", { count: data.longWaits.length, threshold: data.threshold })}
              </div>
              {data.longWaits.map((w) => (
                <div key={w.appointmentId} style={{
                  borderTop: "1px solid rgba(220, 38, 38, 0.20)",
                  padding: "10px 14px",
                  display: "grid",
                  gridTemplateColumns: "60px 1fr",
                  gap: 12,
                  alignItems: "center",
                }}>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#dc2626",
                    fontFamily: "var(--font-mono, monospace)",
                  }}>
                    {w.waitedMin}m
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{w.patient}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {w.type} · {t("analytics.waitingRoom.doctorPrefix")} {w.doctor}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 14 }}>
            <AnalyticsCard
              label={t("analytics.waitingRoom.kpiAvgLabel")}
              value={`${data.overallAvg} min`}
              hint={t("analytics.waitingRoom.kpiAvgHint", { count: data.sampleSize })}
              icon={<Clock size={14} aria-hidden />}
              tone={data.overallAvg > data.threshold ? "warning" : "neutral"}
            />
            <AnalyticsCard
              label={t("analytics.waitingRoom.kpiMedianLabel")}
              value={`${data.overallMedian} min`}
              hint={t("analytics.waitingRoom.kpiMedianHint")}
              icon={<Clock size={14} aria-hidden />}
            />
            <AnalyticsCard
              label={t("analytics.waitingRoom.kpiAlertsLabel")}
              value={String(data.longWaits.length)}
              hint={t("analytics.waitingRoom.kpiAlertsHint", { threshold: data.threshold })}
              icon={<AlertTriangle size={14} aria-hidden />}
              tone={data.longWaits.length > 0 ? "danger" : "success"}
            />
          </div>

          {/* Heatmap día × hora */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              {t("analytics.waitingRoom.heatmapTitle")}
            </div>
            <AnalyticsHeatmap
              data={data.heatmap.map((row) =>
                row.map(({ value, count }) => ({
                  // Normaliza a 0-100 escala usando threshold como "rojo".
                  // value es minutos. > threshold = rojo.
                  value: Math.round((value / Math.max(1, data.threshold)) * 70),
                  count,
                  label: `${value} min`,
                })),
              )}
              hours={data.hours}
            />
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
              {t("analytics.waitingRoom.heatmapCaption", { threshold: data.threshold })}
            </div>
          </div>

          {/* Por hora — tabla simple */}
          <div style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
            <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "var(--text-2)", background: "var(--bg-elev-2)" }}>
              {t("analytics.waitingRoom.tableTitle")}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <Th>{t("analytics.waitingRoom.colHour")}</Th>
                  <Th align="right">{t("analytics.waitingRoom.colAvg")}</Th>
                  <Th align="right">{t("analytics.waitingRoom.colAppts")}</Th>
                  <Th align="right">{t("analytics.waitingRoom.colLongWaits")}</Th>
                </tr>
              </thead>
              <tbody>
                {data.byHour.map((h) => (
                  <tr key={h.hour} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <Td mono>{h.hour}:00</Td>
                    <Td align="right" mono color={h.avgMin > data.threshold ? "#dc2626" : "var(--text-1)"}>
                      <strong>{h.avgMin} min</strong>
                    </Td>
                    <Td align="right" mono color="var(--text-3)">{h.count}</Td>
                    <Td align="right" mono color={h.longWaits > 0 ? "#d97706" : "var(--text-3)"}>
                      {h.longWaits}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AnalyticsLayout>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{
      padding: "10px 14px",
      textAlign: align,
      fontSize: 10,
      fontWeight: 700,
      color: "var(--text-3)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    }}>{children}</th>
  );
}

function Td({ children, align = "left", mono, color }: {
  children: React.ReactNode; align?: "left" | "right"; mono?: boolean; color?: string;
}) {
  return (
    <td style={{
      padding: "10px 14px",
      textAlign: align,
      color: color ?? "var(--text-1)",
      fontFamily: mono ? "var(--font-mono, monospace)" : "inherit",
      fontVariantNumeric: mono ? "tabular-nums" : "normal",
    }}>{children}</td>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--bg-elev)",
      border: "1px solid var(--border-soft)",
      borderRadius: 14,
      padding: 40,
      textAlign: "center",
      color: "var(--text-2)",
      fontSize: 13,
    }}>{children}</div>
  );
}
