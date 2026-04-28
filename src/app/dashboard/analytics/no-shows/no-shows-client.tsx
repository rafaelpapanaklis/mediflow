"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";

interface DayStat { dayIdx: number; count: number; total: number; rate: number }
interface HourStat { hour: number; count: number; total: number; rate: number }
interface PatientStat { id: string; name: string; count: number }
interface UpcomingRisk {
  appointmentId: string;
  probability: number;
  factors: Array<{ label: string; weight: number; reason: string }>;
  startsAt: string;
  type: string;
  patient: string;
  doctor: string;
}
interface ApiResponse {
  total: number;
  noShowCount: number;
  rate: number;
  byDayOfWeek: DayStat[];
  byHour: HourStat[];
  topPatients: PatientStat[];
  upcomingHighRisk: UpcomingRisk[];
}

const DAYS_ES = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

export function NoShowsClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshingPredId, setRefreshingPredId] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/analytics/no-shows", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d as ApiResponse); setLoading(false); })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  async function requestAiInsight() {
    if (!data) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/analytics/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextData: {
            totalAppts: data.total,
            noShowCount: data.noShowCount,
            rate: data.rate,
            worstDay: [...data.byDayOfWeek].sort((a, b) => b.rate - a.rate)[0],
            worstHour: [...data.byHour].sort((a, b) => b.rate - a.rate)[0],
            topPatients: data.topPatients.slice(0, 3),
          },
          question: "Identifica el patrón de no-shows más anómalo y sugiere 1-2 acciones (ej. recordatorios extra, deposit, cambio de slots).",
        }),
      });
      if (!res.ok) throw new Error();
      const j = await res.json();
      setAiInsight(j.insight ?? "");
    } catch {
      toast.error("No se pudo generar el insight IA");
    } finally {
      setAiLoading(false);
    }
  }

  async function refreshPrediction(appointmentId: string) {
    setRefreshingPredId(appointmentId);
    try {
      const res = await fetch("/api/analytics/no-shows/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Predicción actualizada");
      // Refetch list
      const list = await fetch("/api/analytics/no-shows");
      if (list.ok) setData(await list.json());
    } catch {
      toast.error("Error al actualizar predicción");
    } finally {
      setRefreshingPredId(null);
    }
  }

  return (
    <AnalyticsLayout
      title="No-shows"
      subtitle="Análisis histórico + predicción IA para citas futuras"
      rightActions={
        data && data.total > 0 ? (
          <button
            type="button"
            onClick={requestAiInsight}
            disabled={aiLoading}
            style={{
              padding: "7px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
              color: "#fff",
              border: "1px solid var(--brand)",
              borderRadius: 8,
              cursor: aiLoading ? "wait" : "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 4px 14px -4px rgba(124, 58, 237, 0.45)",
            }}
          >
            <Sparkles size={13} aria-hidden />
            {aiLoading ? "Analizando…" : "Analizar con IA"}
          </button>
        ) : null
      }
    >
      {loading ? (
        <Box>Cargando…</Box>
      ) : !data || data.total === 0 ? (
        <Box>Sin citas en el rango.</Box>
      ) : (
        <>
          {aiInsight && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                background: "var(--brand-softer)",
                border: "1px solid var(--brand-soft)",
                borderRadius: 10,
                fontSize: 13,
                color: "var(--text-1)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <Sparkles size={16} style={{ color: "var(--brand)", flexShrink: 0, marginTop: 2 }} aria-hidden />
              <div>{aiInsight}</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 14 }}>
            <AnalyticsCard
              label="Tasa de no-shows"
              value={`${data.rate}%`}
              hint={`${data.noShowCount} de ${data.total}`}
              icon={<AlertCircle size={14} aria-hidden />}
              tone={data.rate > 10 ? "danger" : data.rate > 5 ? "warning" : "success"}
            />
            <AnalyticsCard
              label="Día más problemático"
              value={(() => {
                const worst = [...data.byDayOfWeek].sort((a, b) => b.rate - a.rate)[0];
                return worst && worst.total > 0 ? DAYS_ES[worst.dayIdx]! : "—";
              })()}
              hint={(() => {
                const worst = [...data.byDayOfWeek].sort((a, b) => b.rate - a.rate)[0];
                return worst ? `${worst.rate}% (${worst.count} no-shows)` : "";
              })()}
            />
            <AnalyticsCard
              label="Hora más problemática"
              value={(() => {
                const worst = [...data.byHour].sort((a, b) => b.rate - a.rate)[0];
                return worst && worst.total > 0 ? `${worst.hour}:00` : "—";
              })()}
              hint={(() => {
                const worst = [...data.byHour].sort((a, b) => b.rate - a.rate)[0];
                return worst ? `${worst.rate}% (${worst.count} no-shows)` : "";
              })()}
            />
          </div>

          {/* Próximas citas con alto riesgo (predicción IA) */}
          {data.upcomingHighRisk.length > 0 && (
            <div style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              overflow: "hidden",
              marginBottom: 14,
            }}>
              <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-soft)",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--text-2)",
                background: "var(--bg-elev-2)",
              }}>
                Próximas citas con alto riesgo (≥60%)
              </div>
              {data.upcomingHighRisk.map((u) => (
                <div key={u.appointmentId} style={{
                  padding: "12px 16px",
                  borderTop: "1px solid var(--border-soft)",
                  display: "grid",
                  gridTemplateColumns: "60px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: u.probability >= 0.75 ? "#dc2626" : "#d97706",
                    fontFamily: "var(--font-jetbrains-mono, monospace)",
                  }}>
                    {Math.round(u.probability * 100)}%
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{u.patient}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {new Date(u.startsAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })} · {u.type} · Dr/a. {u.doctor}
                    </div>
                    {u.factors.slice(0, 2).map((f, i) => (
                      <div key={i} style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
                        • {f.reason}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshPrediction(u.appointmentId)}
                    disabled={refreshingPredId === u.appointmentId}
                    style={{
                      padding: "5px 9px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "var(--bg-elev)",
                      color: "var(--text-2)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="Recalcular con IA"
                  >
                    <RefreshCw size={11} aria-hidden style={{ animation: refreshingPredId === u.appointmentId ? "spin 0.8s linear infinite" : undefined }} />
                    {refreshingPredId === u.appointmentId ? "…" : "Refresh"}
                  </button>
                </div>
              ))}
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Top patients */}
          {data.topPatients.length > 0 && (
            <div style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "var(--text-2)", background: "var(--bg-elev-2)", borderBottom: "1px solid var(--border-soft)" }}>
                Pacientes con más no-shows en el rango
              </div>
              {data.topPatients.map((p) => (
                <div key={p.id} style={{
                  padding: "10px 16px",
                  borderTop: "1px solid var(--border-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}>
                  <span style={{ color: "var(--text-1)" }}>{p.name}</span>
                  <span style={{ color: "#dc2626", fontWeight: 600, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                    {p.count} no-show{p.count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AnalyticsLayout>
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
      color: "var(--text-3)",
      fontSize: 13,
    }}>{children}</div>
  );
}
