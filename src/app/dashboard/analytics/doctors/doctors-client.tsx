"use client";

import { useEffect, useState } from "react";
import { Star, FileDown } from "lucide-react";
import toast from "react-hot-toast";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";

interface DoctorRow {
  id: string;
  name: string;
  color: string;
  role: string;
  apptsTotal: number;
  apptsCompleted: number;
  apptsNoShow: number;
  noShowRate: number;
  apptsPerDay: number;
  revenueGenerated: number;
  avgSatisfaction: number | null;
  satisfactionCount: number;
  avgConsultMin: number | null;
}

interface ApiResponse {
  from: string;
  to: string;
  doctors: DoctorRow[];
}

const PRESETS = [
  { id: "month",   label: "Este mes",      compute: () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now };
  }},
  { id: "last30",  label: "30 días",       compute: () => {
    const to = new Date();
    return { from: new Date(to.getTime() - 30 * 86400000), to };
  }},
  { id: "quarter", label: "90 días",       compute: () => {
    const to = new Date();
    return { from: new Date(to.getTime() - 90 * 86400000), to };
  }},
];

export function DoctorsClient() {
  const [preset, setPreset] = useState("month");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingPayroll, setGeneratingPayroll] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const range = PRESETS.find((p) => p.id === preset)!.compute();
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    fetch(`/api/analytics/doctor-performance?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d as ApiResponse);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, [preset]);

  async function generatePayroll() {
    if (!data) return;
    setGeneratingPayroll(true);
    try {
      // Genera PDF profesional via /api/analytics/payroll-pdf con el
      // mismo rango de fechas activo (no el de la query del cliente
      // sino el server-side recalculado por preset). Para mantener
      // consistencia, pasamos from/to explícitos derivados del preset.
      const range = PRESETS.find((p) => p.id === preset)!.compute();
      const params = new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      });
      const res = await fetch(`/api/analytics/payroll-pdf?${params}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nomina-${range.from.toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF de nómina generado");
    } catch {
      toast.error("Error al generar PDF");
    } finally {
      setGeneratingPayroll(false);
    }
  }

  return (
    <AnalyticsLayout
      title="Doctores"
      subtitle="Performance, ingresos generados y satisfacción de pacientes"
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
          <button
            type="button"
            onClick={generatePayroll}
            disabled={!data || data.doctors.length === 0 || generatingPayroll}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--bg-elev)",
              color: "var(--text-1)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              cursor: generatingPayroll ? "wait" : "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <FileDown size={13} aria-hidden />
            {generatingPayroll ? "Generando…" : "Exportar nómina"}
          </button>
        </div>
      }
    >
      {loading ? (
        <Box>Cargando…</Box>
      ) : !data || data.doctors.length === 0 ? (
        <Box>
          <strong style={{ color: "var(--text-2)" }}>Sin datos en el rango</strong>
          <div style={{ marginTop: 6, color: "var(--text-3)", fontSize: 13 }}>
            No hay doctores activos con citas en este período.
          </div>
        </Box>
      ) : (
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
                <Th>Doctor</Th>
                <Th align="right">Citas</Th>
                <Th align="right">Completadas</Th>
                <Th align="right">/día</Th>
                <Th align="right">No-shows</Th>
                <Th align="right">Tiempo prom.</Th>
                <Th align="right">Satisfacción</Th>
                <Th align="right">Ingresos</Th>
              </tr>
            </thead>
            <tbody>
              {data.doctors.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: d.color,
                          flexShrink: 0,
                        }}
                      />
                      <strong style={{ color: "var(--text-1)" }}>{d.name}</strong>
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>{d.role}</span>
                    </div>
                  </Td>
                  <Td align="right" mono>{d.apptsTotal}</Td>
                  <Td align="right" mono><strong>{d.apptsCompleted}</strong></Td>
                  <Td align="right" mono color="var(--text-3)">{d.apptsPerDay}</Td>
                  <Td align="right" mono color={d.noShowRate > 10 ? "#dc2626" : "var(--text-3)"}>
                    {d.apptsNoShow} <span style={{ fontSize: 10 }}>({d.noShowRate}%)</span>
                  </Td>
                  <Td align="right" mono color="var(--text-2)">
                    {d.avgConsultMin != null ? `${d.avgConsultMin} min` : "—"}
                  </Td>
                  <Td align="right">
                    {d.avgSatisfaction != null ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#d97706", fontWeight: 600, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                        <Star size={11} fill="currentColor" aria-hidden />
                        {d.avgSatisfaction.toFixed(1)}
                        <span style={{ fontSize: 10, color: "var(--text-4)", fontWeight: 500 }}>({d.satisfactionCount})</span>
                      </span>
                    ) : <span style={{ color: "var(--text-4)" }}>—</span>}
                  </Td>
                  <Td align="right" mono>
                    <strong>${d.revenueGenerated.toLocaleString("es-MX", { maximumFractionDigits: 0 })}</strong>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
        Nota: Ingresos = facturas pagadas asociadas a citas del doctor. Satisfacción = promedio de
        PatientSatisfaction (NPS 1-5). Tiempo promedio = AppointmentTimeline.totalConsultMin.
        Nómina exporta CSV con los datos visibles. PDF profesional de nómina llegará en el próximo push.
      </div>
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
