"use client";

import { useEffect, useState } from "react";
import { Star, FileDown, Stethoscope } from "lucide-react";
import toast from "react-hot-toast";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { useT } from "@/i18n/i18n-provider";

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
  { id: "month",   labelKey: "analytics.doctors.presetMonth",   compute: () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now };
  }},
  { id: "last30",  labelKey: "analytics.doctors.preset30d",     compute: () => {
    const to = new Date();
    return { from: new Date(to.getTime() - 30 * 86400000), to };
  }},
  { id: "quarter", labelKey: "analytics.doctors.preset90d",     compute: () => {
    const to = new Date();
    return { from: new Date(to.getTime() - 90 * 86400000), to };
  }},
];

export function DoctorsClient() {
  const t = useT();
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
      toast.success(t("analytics.doctors.payrollPdfGenerated"));
    } catch {
      toast.error(t("analytics.doctors.payrollPdfError"));
    } finally {
      setGeneratingPayroll(false);
    }
  }

  return (
    <AnalyticsLayout
      title={t("analytics.doctors.title")}
      subtitle={t("analytics.doctors.subtitle")}
      rightActions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="segment-new">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                aria-pressed={preset === p.id}
                className={`segment-new__btn${preset === p.id ? " segment-new__btn--active" : ""}`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={generatePayroll}
            disabled={!data || data.doctors.length === 0 || generatingPayroll}
            className="btn-new btn-new--secondary btn-new--sm"
            style={{ cursor: generatingPayroll ? "wait" : undefined }}
          >
            <FileDown size={16} strokeWidth={1.75} aria-hidden />
            {generatingPayroll ? t("analytics.doctors.generating") : t("analytics.doctors.exportPayroll")}
          </button>
        </div>
      }
    >
      {loading ? (
        <Box>{t("common.loading")}</Box>
      ) : !data || data.doctors.length === 0 ? (
        <Box>
          <div aria-hidden style={{ color: "var(--text-4)", marginBottom: 8 }}>
            <Stethoscope size={20} strokeWidth={1.75} />
          </div>
          <strong style={{ color: "var(--text-2)" }}>{t("analytics.doctors.noDataTitle")}</strong>
          <div style={{ marginTop: 6, color: "var(--text-3)", fontSize: 13 }}>
            {t("analytics.doctors.noDataDesc")}
          </div>
        </Box>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <Th>{t("analytics.doctors.colDoctor")}</Th>
                <Th align="right">{t("analytics.doctors.colAppts")}</Th>
                <Th align="right">{t("analytics.doctors.colCompleted")}</Th>
                <Th align="right">{t("analytics.doctors.colPerDay")}</Th>
                <Th align="right">{t("analytics.doctors.colNoShows")}</Th>
                <Th align="right">{t("analytics.doctors.colAvgTime")}</Th>
                <Th align="right">{t("analytics.doctors.colSatisfaction")}</Th>
                <Th align="right">{t("analytics.doctors.colRevenue")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.doctors.map((d) => (
                <tr key={d.id}>
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
                  <Td align="right" mono color={d.noShowRate > 10 ? "var(--danger)" : "var(--text-3)"}>
                    {d.apptsNoShow} <span style={{ fontSize: 10 }}>({d.noShowRate}%)</span>
                  </Td>
                  <Td align="right" mono color="var(--text-2)">
                    {d.avgConsultMin != null ? t("analytics.doctors.minutes", { count: d.avgConsultMin }) : "—"}
                  </Td>
                  <Td align="right">
                    {d.avgSatisfaction != null ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--warning-strong)", fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
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
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
        {t("analytics.doctors.footerNote")}
      </div>
    </AnalyticsLayout>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th scope="col" style={{ textAlign: align }}>{children}</th>;
}

function Td({ children, align = "left", mono, color }: {
  children: React.ReactNode; align?: "left" | "right"; mono?: boolean; color?: string;
}) {
  return (
    <td style={{
      textAlign: align,
      ...(color ? { color } : null),
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
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-1)",
      padding: 40,
      textAlign: "center",
      color: "var(--text-2)",
      fontSize: 13,
    }}>{children}</div>
  );
}
