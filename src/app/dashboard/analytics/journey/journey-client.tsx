"use client";

import { useEffect, useState } from "react";
import { ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";

interface FunnelStep { id: string; label: string; count: number }
interface Stage {
  id: string;
  label: string;
  from: string;
  to: string;
  avgMin: number;
  sample: number;
}
interface ApiResponse {
  totalAppts: number;
  funnel: FunnelStep[];
  dropOffs: { cancelled: number; noShow: number };
  stages: Stage[];
  bottleneck: Stage | null;
}

const PRESETS = [
  { id: "30d", label: "30 días", days: 30 },
  { id: "90d", label: "90 días", days: 90 },
];

/**
 * Visualización: funnel de cajas + flechas en CSS puro (no librería).
 * Cada caja tiene altura proporcional al count vs total. Drop-offs
 * (CANCELLED, NO_SHOW) se muestran como ramas laterales con el count.
 *
 * Bajo el funnel, una grilla de "etapas con tiempo promedio" — cuello
 * de botella se highlightea en ámbar/rojo.
 */
export function JourneyClient() {
  const [preset, setPreset] = useState("30d");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - days * 86400000).toISOString();
    fetch(`/api/analytics/journey?from=${from}&to=${to}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d as ApiResponse); setLoading(false); })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, [preset]);

  return (
    <AnalyticsLayout
      title="Patient Journey"
      subtitle="Flujo de citas etapa por etapa, drop-offs y cuello de botella"
      rightActions={
        <div style={{ display: "flex", gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: preset === p.id ? "var(--brand)" : "var(--bg-elev)",
                color: preset === p.id ? "#fff" : "var(--text-2)",
                border: `1px solid ${preset === p.id ? "var(--brand)" : "var(--border-soft)"}`,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <Box>Cargando flujo…</Box>
      ) : !data || data.totalAppts === 0 ? (
        <Box>Sin citas en el rango seleccionado.</Box>
      ) : (
        <>
          {data.bottleneck && data.bottleneck.sample > 0 && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                background: data.bottleneck.avgMin > 30
                  ? "rgba(220, 38, 38, 0.08)"
                  : "rgba(217, 119, 6, 0.08)",
                border: `1px solid ${data.bottleneck.avgMin > 30 ? "rgba(220, 38, 38, 0.30)" : "rgba(217, 119, 6, 0.30)"}`,
                borderRadius: 12,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                fontSize: 13,
                color: "var(--text-2)",
              }}
            >
              <div style={{ color: data.bottleneck.avgMin > 30 ? "#dc2626" : "#d97706", flexShrink: 0, marginTop: 2 }}>
                <AlertTriangle size={16} aria-hidden />
              </div>
              <div>
                <strong style={{ color: "var(--text-1)" }}>Cuello de botella: {data.bottleneck.label}</strong>
                {" — "}{data.bottleneck.avgMin} min promedio
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  Medido entre &quot;{data.bottleneck.from}&quot; → &quot;{data.bottleneck.to}&quot; en {data.bottleneck.sample} citas.
                </div>
              </div>
            </div>
          )}

          {/* Funnel visual */}
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              padding: 24,
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
              Funnel de citas
            </div>
            <FunnelView funnel={data.funnel} dropOffs={data.dropOffs} totalAppts={data.totalAppts} />
          </div>

          {/* Stages timing */}
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "var(--text-2)", background: "var(--bg-elev-2)", borderBottom: "1px solid var(--border-soft)" }}>
              Tiempo promedio por etapa
            </div>
            {data.stages.map((s) => (
              <div
                key={s.id}
                style={{
                  borderTop: "1px solid var(--border-soft)",
                  padding: "12px 16px",
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 16,
                  alignItems: "center",
                  background: data.bottleneck?.id === s.id ? "rgba(217, 119, 6, 0.04)" : undefined,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{s.from} → {s.to}</div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                  n={s.sample}
                </div>
                <div style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: s.sample === 0
                    ? "var(--text-4)"
                    : s.avgMin > 30 ? "#dc2626"
                    : s.avgMin > 15 ? "#d97706"
                    : "#10b981",
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontVariantNumeric: "tabular-nums",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  <Clock size={13} aria-hidden />
                  {s.sample > 0 ? `${s.avgMin} min` : "—"}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
            Los tiempos se calculan de AppointmentTimeline (timestamps capturados en cada
            transición de status). Etapas con sample=0 indican que esa transición no se
            está registrando en las citas del rango — confirma que el flujo CHECKED_IN →
            IN_CHAIR → IN_PROGRESS → COMPLETED → CHECKED_OUT se use en el día a día.
          </div>
        </>
      )}
    </AnalyticsLayout>
  );
}

function FunnelView({
  funnel,
  dropOffs,
  totalAppts,
}: {
  funnel: FunnelStep[];
  dropOffs: { cancelled: number; noShow: number };
  totalAppts: number;
}) {
  // Cada step se renderiza con altura proporcional al count vs el primer
  // step. Drop-offs (cancelled, noShow) se renderean como pequeñas
  // ramas laterales saliendo entre los steps relevantes.
  const max = totalAppts || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {funnel.map((step, idx) => {
        const pct = Math.round((step.count / max) * 100);
        const widthPct = Math.max(10, (step.count / max) * 100);
        const isFirst = idx === 0;
        const isLast = idx === funnel.length - 1;
        const drop =
          isFirst && dropOffs.cancelled > 0 ? { label: "Canceladas", count: dropOffs.cancelled, color: "#94a3b8" } :
          step.id === "scheduled" || step.id === "arrived" ? null :
          null;

        // Drop-off por NO_SHOW se renderea entre "scheduled" y "arrived".
        const noShowDrop = idx === 0 && dropOffs.noShow > 0
          ? { label: "No-show", count: dropOffs.noShow, color: "#dc2626" }
          : null;

        return (
          <div key={step.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Bar */}
              <div
                style={{
                  flex: 1,
                  background: "linear-gradient(90deg, var(--brand) 0%, var(--brand-soft) 100%)",
                  width: `${widthPct}%`,
                  height: 36,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 14,
                  paddingRight: 14,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  transition: "width 0.4s",
                }}
              >
                {step.label}
              </div>
              {/* Count */}
              <div style={{ minWidth: 100, textAlign: "right" }}>
                <div style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--text-1)",
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {step.count.toLocaleString("es-MX")}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  {pct}% del total
                </div>
              </div>
            </div>

            {/* Drop-offs entre steps (solo después del primer step) */}
            {!isLast && (drop || noShowDrop) && (
              <div style={{ display: "flex", paddingLeft: 24, alignItems: "center", gap: 8, marginTop: 2 }}>
                {drop && (
                  <DropPill label={drop.label} count={drop.count} color={drop.color} pct={Math.round((drop.count / max) * 100)} />
                )}
                {noShowDrop && (
                  <DropPill label={noShowDrop.label} count={noShowDrop.count} color={noShowDrop.color} pct={Math.round((noShowDrop.count / max) * 100)} />
                )}
              </div>
            )}

            {/* Arrow entre steps */}
            {!isLast && (
              <div style={{ paddingLeft: "calc(50% - 6px)", color: "var(--text-4)" }}>
                <ArrowRight size={14} aria-hidden style={{ transform: "rotate(90deg)" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DropPill({ label, count, color, pct }: { label: string; count: number; color: string; pct: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        background: `${color}15`,
        border: `1px solid ${color}40`,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      ↳ {label}: {count} ({pct}%)
    </span>
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
