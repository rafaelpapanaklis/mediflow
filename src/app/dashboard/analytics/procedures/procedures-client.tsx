"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";

interface ProcedureRow {
  type: string;
  count: number;
  avgConsultMin: number;
  benchmark: number | null;
  variance: number | null;
  fastest: { name: string; avgMin: number; count: number } | null;
  slowest: { name: string; avgMin: number; count: number } | null;
}

interface ApiResponse {
  insufficientData: boolean;
  sampleSize: number;
  procedures: ProcedureRow[];
}

export function ProceduresClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/analytics/procedures", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d as ApiResponse);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  async function requestAiInsight() {
    if (!data || data.procedures.length === 0) return;
    setAiLoading(true);
    try {
      const top5 = data.procedures.slice(0, 5).map((p) => ({
        type: p.type, avgMin: p.avgConsultMin, benchmark: p.benchmark, count: p.count,
      }));
      const res = await fetch("/api/analytics/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextData: { procedures: top5 },
          question: "Analiza los tiempos promedio de procedimientos vs benchmark. Detecta el más fuera de rango y sugiere 1-2 acciones concretas.",
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

  return (
    <AnalyticsLayout
      title="Procedimientos"
      subtitle="Tiempos promedio, benchmark y comparativa entre doctores"
      rightActions={
        data && !data.insufficientData ? (
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
      ) : !data || data.insufficientData ? (
        <Box>
          <strong style={{ color: "var(--text-2)" }}>Recolectando datos</strong>
          <div style={{ marginTop: 6, color: "var(--text-3)", fontSize: 13 }}>
            Llevas {data?.sampleSize ?? 0} citas con tiempo de consulta registrado. Necesitamos
            al menos 5 citas con check-in y completed (que disparen el AppointmentTimeline)
            para mostrar tiempos promedio.
          </div>
        </Box>
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

          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-elev-2)" }}>
                  <Th>Procedimiento</Th>
                  <Th align="right">Realizadas</Th>
                  <Th align="right">Tiempo prom.</Th>
                  <Th align="right">Benchmark</Th>
                  <Th align="right">Variance</Th>
                  <Th>Más rápido</Th>
                  <Th>Más lento</Th>
                </tr>
              </thead>
              <tbody>
                {data.procedures.map((p) => (
                  <tr key={p.type} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <Td><strong style={{ color: "var(--text-1)" }}>{p.type}</strong></Td>
                    <Td align="right" mono>{p.count}</Td>
                    <Td align="right" mono><strong>{p.avgConsultMin} min</strong></Td>
                    <Td align="right" mono color="var(--text-3)">
                      {p.benchmark != null ? `${p.benchmark} min` : "—"}
                    </Td>
                    <Td align="right">
                      <VarianceCell variance={p.variance} />
                    </Td>
                    <Td>
                      {p.fastest ? (
                        <span style={{ color: "var(--text-2)" }}>
                          {p.fastest.name} <span style={{ color: "#10b981", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{p.fastest.avgMin}min</span>
                        </span>
                      ) : <span style={{ color: "var(--text-4)" }}>—</span>}
                    </Td>
                    <Td>
                      {p.slowest ? (
                        <span style={{ color: "var(--text-2)" }}>
                          {p.slowest.name} <span style={{ color: "#dc2626", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{p.slowest.avgMin}min</span>
                        </span>
                      ) : <span style={{ color: "var(--text-4)" }}>—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)" }}>
            Calculado sobre {data.sampleSize} citas con timeline completo (CHECKED_IN → IN_PROGRESS → COMPLETED).
          </div>
        </>
      )}
    </AnalyticsLayout>
  );
}

function VarianceCell({ variance }: { variance: number | null }) {
  if (variance == null) return <span style={{ color: "var(--text-4)" }}>—</span>;
  const Icon = variance === 0 ? Minus : variance > 0 ? TrendingUp : TrendingDown;
  const color = variance === 0 ? "var(--text-3)" : variance > 0 ? "#dc2626" : "#10b981";
  const sign = variance > 0 ? "+" : "";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color, fontWeight: 600, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
      <Icon size={12} aria-hidden />
      {sign}{variance} min
    </span>
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
      fontFamily: mono ? "var(--font-jetbrains-mono, monospace)" : "inherit",
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
