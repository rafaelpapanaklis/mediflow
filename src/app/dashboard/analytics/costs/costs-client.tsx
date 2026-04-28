"use client";

import { useEffect, useState } from "react";
import { Pencil, Sparkles, X, Save, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import toast from "react-hot-toast";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";

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
      toast.error("Error al cargar datos");
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
      toast.error("No se pudo generar insight IA");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <AnalyticsLayout
      title="Costos & Margen"
      subtitle="Renta + operativos vs ingresos generados, por sillón"
      rightActions={
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              background: "var(--bg-elev)",
              color: "var(--text-1)",
              border: "1px solid var(--border-soft)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
          {data && data.resources.length > 0 && (
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
          )}
        </div>
      }
    >
      {loading ? (
        <Box>Cargando…</Box>
      ) : !data || data.resources.length === 0 ? (
        <Box>Sin sillones activos en la clínica.</Box>
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

          {/* Totales */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 14 }}>
            <TotalCard label="Ingresos" value={fmtMXN(data.totals.revenue)} tone="brand" icon={<DollarSign size={14} aria-hidden />} />
            <TotalCard label="Costos" value={fmtMXN(data.totals.cost)} tone="warning" icon={<TrendingDown size={14} aria-hidden />} />
            <TotalCard
              label="Margen"
              value={fmtMXN(data.totals.margin)}
              tone={data.totals.margin >= 0 ? "success" : "danger"}
              icon={<TrendingUp size={14} aria-hidden />}
            />
          </div>

          {/* Tabla */}
          <div style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-elev-2)" }}>
                  <Th>Sillón</Th>
                  <Th align="right">Renta</Th>
                  <Th align="right">Operativos</Th>
                  <Th align="right">Costo total</Th>
                  <Th align="right">Ingresos</Th>
                  <Th align="right">Margen</Th>
                  <Th align="right">Margen %</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.resources.map((r) => (
                  <tr
                    key={r.resourceId}
                    style={{
                      borderTop: "1px solid var(--border-soft)",
                      background: r.margin < 0 ? "rgba(220, 38, 38, 0.04)" : undefined,
                    }}
                  >
                    <Td>
                      <strong style={{ color: "var(--text-1)" }}>{r.name}</strong>
                      {!r.configured && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-4)", fontStyle: "italic" }}>
                          sin costos
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
                      color={r.margin >= 0 ? "#10b981" : "#dc2626"}
                    >
                      <strong>{fmtMXN(r.margin)}</strong>
                    </Td>
                    <Td
                      align="right"
                      mono
                      color={
                        r.marginPct == null ? "var(--text-4)" :
                        r.marginPct >= 30 ? "#10b981" :
                        r.marginPct >= 0 ? "#d97706" : "#dc2626"
                      }
                    >
                      {r.marginPct != null ? `${r.marginPct}%` : "—"}
                    </Td>
                    <Td align="right">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        title="Editar costos"
                        aria-label={`Editar costos de ${r.name}`}
                        style={{
                          width: 28, height: 28, display: "grid", placeItems: "center",
                          background: "transparent", border: "1px solid var(--border-soft)",
                          borderRadius: 7, color: "var(--text-3)", cursor: "pointer",
                        }}
                      >
                        <Pencil size={12} aria-hidden />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
            Ingresos = SUM(invoice.paid) donde invoice.appointment.resourceId coincide y appointment.startsAt
            cae en el mes. Margen rojo = pérdida ese mes; considera subir precios, reasignar pacientes
            o renegociar renta.
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
      toast.success("Costos guardados");
      onSaved();
    } catch {
      toast.error("Error al guardar");
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 5, 10, 0.72)",
        WebkitBackdropFilter: "blur(6px)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 460,
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 id="cost-modal-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
            Costos de {resource.name}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{
            width: 28, height: 28, display: "grid", placeItems: "center",
            background: "transparent", border: "1px solid var(--border-soft)",
            borderRadius: 7, color: "var(--text-3)", cursor: "pointer",
          }}>
            <X size={13} aria-hidden />
          </button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Renta mensual (MXN)">
            <input type="number" min={0} step={0.01} value={rent} onChange={(e) => setRent(e.target.value)} className="input-new mono" placeholder="0.00" />
          </Field>
          <Field label="Operativos mensuales (MXN)" hint="luz, mantenimiento, insumos básicos del sillón">
            <input type="number" min={0} step={0.01} value={ops} onChange={(e) => setOps(e.target.value)} className="input-new mono" placeholder="0.00" />
          </Field>
          <Field label="Notas (opcional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              className="input-new"
              style={{ minHeight: 64, resize: "vertical" }}
              placeholder="Ej. Renta compartida con otra clínica, contrato vence en oct…"
            />
          </Field>
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-soft)", background: "var(--bg-elev-2)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={{
            padding: "8px 14px", fontSize: 13, fontWeight: 600,
            background: "transparent", color: "var(--text-2)",
            border: "1px solid var(--border-strong)", borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 700,
            background: "var(--brand)", color: "#fff",
            border: "1px solid var(--brand)", borderRadius: 8,
            cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <Save size={13} aria-hidden />
            {saving ? "Guardando…" : "Guardar"}
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
    brand:   { bg: "var(--brand-softer)",       border: "rgba(124, 58, 237, 0.20)", fg: "var(--brand)" },
    success: { bg: "rgba(16, 185, 129, 0.10)",  border: "rgba(16, 185, 129, 0.25)", fg: "#059669" },
    warning: { bg: "rgba(217, 119, 6, 0.10)",   border: "rgba(217, 119, 6, 0.25)",  fg: "#d97706" },
    danger:  { bg: "rgba(220, 38, 38, 0.10)",   border: "rgba(220, 38, 38, 0.25)",  fg: "#dc2626" },
  }[tone];
  return (
    <div style={{
      background: "var(--bg-elev)",
      border: "1px solid var(--border-soft)",
      borderRadius: 14,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      fontFamily: "var(--font-sora, 'Sora', sans-serif)",
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
      color: "var(--text-3)",
      fontSize: 13,
    }}>{children}</div>
  );
}
