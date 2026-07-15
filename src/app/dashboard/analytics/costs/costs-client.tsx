"use client";

import { useEffect, useState } from "react";
import { Pencil, Sparkles, X, Save, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import toast from "react-hot-toast";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { useT } from "@/i18n/i18n-provider";

interface ResourceRow {
  resourceId: string;
  name: string;
  monthlyRent: number;
  monthlyOps: number;
  totalCost: number;
  revenue: number;
  margin: number;
  marginPct: number | null;
  notes: string | null;
  configured: boolean;
}

interface ApiResponse {
  month: string;
  resources: ResourceRow[];
  totals: { revenue: number; cost: number; margin: number };
}

function fmtMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function CostsClient() {
  const t = useT();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function refetch() {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/resource-costs?month=${month}`);
      if (!res.ok) throw new Error();
      const j = await res.json();
      setData(j as ApiResponse);
    } catch {
      toast.error(t("analytics.costs.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function requestAiInsight() {
    if (!data) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/analytics/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextData: {
            month: data.month,
            totals: data.totals,
            resources: data.resources.map((r) => ({
              name: r.name, revenue: r.revenue, totalCost: r.totalCost, margin: r.margin, marginPct: r.marginPct,
            })),
          },
          question: "Identifica el sillón menos rentable y sugiere 1-2 acciones (subir precios, reasignar, reducir horario, renegociar renta).",
        }),
      });
      if (!res.ok) throw new Error();
      const j = await res.json();
      setAiInsight(j.insight ?? "");
    } catch {
      toast.error(t("analytics.costs.aiInsightError"));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <AnalyticsLayout
      title={t("analytics.costs.title")}
      subtitle={t("analytics.costs.subtitle")}
      rightActions={
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="input-new"
            style={{ width: "auto" }}
          />
          {data && data.resources.length > 0 && (
            <button
              type="button"
              onClick={requestAiInsight}
              disabled={aiLoading}
              className="btn-new btn-new--primary btn-new--sm"
              style={{ cursor: aiLoading ? "wait" : undefined }}
            >
              <Sparkles size={16} strokeWidth={1.75} aria-hidden />
              {aiLoading ? t("analytics.costs.analyzing") : t("analytics.costs.analyzeWithAi")}
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <Box>{t("common.loading")}</Box>
      ) : !data || data.resources.length === 0 ? (
        <Box>{t("analytics.costs.noChairs")}</Box>
      ) : (
        <>
          {aiInsight && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                background: "var(--brand-softer)",
                border: "1px solid var(--brand-soft)",
                borderRadius: "var(--radius)",
                fontSize: 13,
                color: "var(--text-1)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--brand)", flexShrink: 0, marginTop: 2 }} aria-hidden />
              <div>{aiInsight}</div>
            </div>
          )}

          {/* Totales */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 14 }}>
            <TotalCard label={t("analytics.costs.revenue")} value={fmtMXN(data.totals.revenue)} tone="brand" icon={<DollarSign size={16} strokeWidth={1.75} aria-hidden />} />
            <TotalCard label={t("analytics.costs.costs")} value={fmtMXN(data.totals.cost)} tone="warning" icon={<TrendingDown size={16} strokeWidth={1.75} aria-hidden />} />
            <TotalCard
              label={t("analytics.costs.margin")}
              value={fmtMXN(data.totals.margin)}
              tone={data.totals.margin >= 0 ? "success" : "danger"}
              icon={<TrendingUp size={16} strokeWidth={1.75} aria-hidden />}
            />
          </div>

          {/* Tabla */}
          <div className="card">
            <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <Th>{t("analytics.costs.colChair")}</Th>
                  <Th align="right">{t("analytics.costs.colRent")}</Th>
                  <Th align="right">{t("analytics.costs.colOps")}</Th>
                  <Th align="right">{t("analytics.costs.colTotalCost")}</Th>
                  <Th align="right">{t("analytics.costs.revenue")}</Th>
                  <Th align="right">{t("analytics.costs.margin")}</Th>
                  <Th align="right">{t("analytics.costs.colMarginPct")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.resources.map((r) => (
                  <tr
                    key={r.resourceId}
                    style={{
                      borderTop: "1px solid var(--border-soft)",
                      background: r.margin < 0 ? "var(--danger-soft)" : undefined,
                    }}
                  >
                    <Td>
                      <strong style={{ color: "var(--text-1)" }}>{r.name}</strong>
                      {!r.configured && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-4)", fontStyle: "italic" }}>
                          {t("analytics.costs.noCosts")}
                        </span>
                      )}
                    </Td>
                    <Td align="right" mono color={r.configured ? "var(--text-1)" : "var(--text-4)"}>
                      {fmtMXN(r.monthlyRent)}
                    </Td>
                    <Td align="right" mono color={r.configured ? "var(--text-1)" : "var(--text-4)"}>
                      {fmtMXN(r.monthlyOps)}
                    </Td>
                    <Td align="right" mono>{fmtMXN(r.totalCost)}</Td>
                    <Td align="right" mono><strong>{fmtMXN(r.revenue)}</strong></Td>
                    <Td
                      align="right"
                      mono
                      color={r.margin >= 0 ? "var(--success-strong)" : "var(--danger)"}
                    >
                      <strong>{fmtMXN(r.margin)}</strong>
                    </Td>
                    <Td
                      align="right"
                      mono
                      color={
                        r.marginPct == null ? "var(--text-4)" :
                        r.marginPct >= 30 ? "var(--success-strong)" :
                        r.marginPct >= 0 ? "var(--warning-strong)" : "var(--danger)"
                      }
                    >
                      {r.marginPct != null ? `${r.marginPct}%` : "—"}
                    </Td>
                    <Td align="right">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        title={t("analytics.costs.editCosts")}
                        aria-label={t("analytics.costs.editCostsOf", { name: r.name })}
                        style={{
                          width: 28, height: 28, display: "grid", placeItems: "center",
                          background: "transparent", border: "1px solid var(--border-soft)",
                          borderRadius: 7, color: "var(--text-3)", cursor: "pointer",
                        }}
                      >
                        <Pencil size={12} strokeWidth={1.75} aria-hidden />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
            {t("analytics.costs.footerNote")}
          </div>
        </>
      )}

      {editing && (
        <EditCostModal
          resource={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </AnalyticsLayout>
  );
}

function EditCostModal({
  resource,
  onClose,
  onSaved,
}: {
  resource: ResourceRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [rent, setRent] = useState(String(resource.monthlyRent || ""));
  const [ops, setOps] = useState(String(resource.monthlyOps || ""));
  const [notes, setNotes] = useState(resource.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/analytics/resource-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: resource.resourceId,
          monthlyRent: Number(rent) || 0,
          monthlyOps: Number(ops) || 0,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("analytics.costs.costsSaved"));
      onSaved();
    } catch {
      toast.error(t("analytics.costs.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="modal-overlay"
    >
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal__header">
          <h3 id="cost-modal-title" className="modal__title" style={{ margin: 0 }}>
            {t("analytics.costs.modalTitle", { name: resource.name })}
          </h3>
          <button type="button" onClick={onClose} aria-label={t("common.close")} style={{
            width: 28, height: 28, display: "grid", placeItems: "center",
            background: "transparent", border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius-sm)", color: "var(--text-3)", cursor: "pointer",
          }}>
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label={t("analytics.costs.fieldRent")}>
            <input type="number" min={0} step={0.01} value={rent} onChange={(e) => setRent(e.target.value)} className="input-new mono" placeholder="0.00" />
          </Field>
          <Field label={t("analytics.costs.fieldOps")} hint={t("analytics.costs.fieldOpsHint")}>
            <input type="number" min={0} step={0.01} value={ops} onChange={(e) => setOps(e.target.value)} className="input-new mono" placeholder="0.00" />
          </Field>
          <Field label={t("analytics.costs.fieldNotes")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              className="input-new"
              style={{ minHeight: 64, resize: "vertical" }}
              placeholder={t("analytics.costs.fieldNotesPlaceholder")}
            />
          </Field>
        </div>
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border-soft)", background: "var(--bg-elev-2)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="btn-new btn-new--secondary btn-new--sm">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={save} disabled={saving} className="btn-new btn-new--primary btn-new--sm" style={{ cursor: saving ? "wait" : undefined }}>
            <Save size={16} strokeWidth={1.75} aria-hidden />
            {saving ? t("analytics.costs.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--text-4)" }}>{hint}</span>}
    </label>
  );
}

function TotalCard({ label, value, tone, icon }: { label: string; value: string; tone: "brand" | "success" | "warning" | "danger"; icon: React.ReactNode }) {
  const colors = {
    brand:   { bg: "var(--brand-soft)",   border: "var(--border-brand)", fg: "var(--brand)" },
    success: { bg: "var(--success-soft)", border: "transparent",         fg: "var(--success-strong)" },
    warning: { bg: "var(--warning-soft)", border: "transparent",         fg: "var(--warning-strong)" },
    danger:  { bg: "var(--danger-soft)",  border: "transparent",         fg: "var(--danger)" },
  }[tone];
  return (
    <div style={{
      background: "var(--bg-elev)",
      border: "1px solid var(--border-soft)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-1)",
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      fontFamily: "var(--font-sans, system-ui, sans-serif)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div aria-hidden style={{
          width: 28, height: 28, borderRadius: 8,
          background: colors.bg, border: `1px solid ${colors.border}`,
          display: "grid", placeItems: "center", color: colors.fg,
        }}>
          {icon}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {label}
        </div>
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700, color: colors.fg,
        letterSpacing: "-0.02em", lineHeight: 1.1,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
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
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-1)",
      padding: 40,
      textAlign: "center",
      color: "var(--text-3)",
      fontSize: 13,
    }}>{children}</div>
  );
}
