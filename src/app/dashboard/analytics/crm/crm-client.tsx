"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Users,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  MessageCircle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";

/* ─── Tipos ─── */
interface ValueRow {
  id: string;
  name: string;
  patientNumber: string;
  phone: string | null;
  invoiced: number;
  paid: number;
  balance: number;
  visits: number;
  lastVisit: string | null;
  nextAppointment: string | null;
}
interface ValueResp {
  totals: { invoiced: number; paid: number; balance: number; patients: number; payingPatients: number; avgLtv: number };
  top: ValueRow[];
}
interface ChurnRow {
  id: string;
  name: string;
  phone: string | null;
  lastVisit: string | null;
  balance: number;
  noShows: number;
  reasons: string[];
}
interface ChurnResp { recallMonths: number; count: number; patients: ChurnRow[] }
interface CohortRow {
  month: string;
  signups: number;
  retention: Array<{ month: number; eligible: number; retained: number; pct: number | null }>;
}
interface CohortResp { cohorts: CohortRow[]; milestones: number[] }

type SortKey = "paid" | "invoiced" | "balance" | "visits";

/* ─── Helpers ─── */
function money(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n || 0);
}
function dateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

const MILESTONE_COLORS: Record<number, string> = { 1: "#7c3aed", 3: "#2563eb", 6: "#059669", 12: "#d97706" };

/* ─── Componente ─── */
export function CrmClient() {
  const [value, setValue] = useState<ValueResp | null>(null);
  const [churn, setChurn] = useState<ChurnResp | null>(null);
  const [cohorts, setCohorts] = useState<CohortResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("paid");

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetch("/api/analytics/patients-value", { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/analytics/churn-risk", { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/analytics/cohorts", { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([v, c, co]) => {
        setValue(v as ValueResp | null);
        setChurn(c as ChurnResp | null);
        setCohorts(co as CohortResp | null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const topSorted = useMemo(() => {
    if (!value) return [];
    return [...value.top].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [value, sortKey]);

  const chartData = useMemo(() => {
    if (!cohorts) return [];
    return cohorts.cohorts.map((c) => {
      const row: Record<string, number | string | null> = { month: c.month, signups: c.signups };
      c.retention.forEach((r) => { row[`m${r.month}`] = r.pct; });
      return row;
    });
  }, [cohorts]);

  const milestones = cohorts?.milestones ?? [1, 3, 6, 12];

  return (
    <AnalyticsLayout
      title="CRM"
      subtitle="Valor de pacientes, riesgo de abandono y retención por cohorte"
    >
      {loading ? (
        <Box>Cargando…</Box>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
            <AnalyticsCard
              label="LTV promedio"
              value={money(value?.totals.avgLtv ?? 0)}
              hint="cobrado por paciente"
              icon={<TrendingUp size={14} aria-hidden />}
            />
            <AnalyticsCard
              label="Ingresos cobrados"
              value={money(value?.totals.paid ?? 0)}
              hint={`${value?.totals.payingPatients ?? 0} pacientes con pagos`}
              icon={<DollarSign size={14} aria-hidden />}
              tone="success"
            />
            <AnalyticsCard
              label="Saldo por cobrar"
              value={money(value?.totals.balance ?? 0)}
              hint={`${value?.totals.patients ?? 0} pacientes`}
              icon={<DollarSign size={14} aria-hidden />}
              tone={value && value.totals.balance > 0 ? "warning" : "neutral"}
            />
            <AnalyticsCard
              label="En riesgo de abandono"
              value={String(churn?.count ?? 0)}
              hint="requieren contacto"
              icon={<AlertTriangle size={14} aria-hidden />}
              tone={churn && churn.count > 0 ? "danger" : "success"}
            />
          </div>

          {/* Retención por cohorte */}
          <Panel title="Retención por cohorte (mes de alta)">
            {chartData.length === 0 ? (
              <Empty>Aún no hay suficientes datos de cohortes.</Empty>
            ) : (
              <div style={{ width: "100%", height: 280, padding: "12px 8px 4px" }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" stroke="var(--text-4)" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                    <YAxis stroke="var(--text-4)" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 12, color: "var(--text-1)" }}
                      formatter={(v: any, name: any) => [v == null ? "—" : `${v}%`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {milestones.map((m) => (
                      <Line
                        key={m}
                        type="monotone"
                        dataKey={`m${m}`}
                        name={`${m} ${m === 1 ? "mes" : "meses"}`}
                        stroke={MILESTONE_COLORS[m] ?? "#7c3aed"}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          {/* Dos columnas: Top pacientes + Riesgo */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14, marginTop: 14, alignItems: "start" }}>
            {/* Top pacientes por valor */}
            <Panel
              title="Top pacientes por valor"
              right={
                <div style={{ display: "flex", gap: 4 }}>
                  {([
                    { k: "paid" as SortKey, l: "Pagado" },
                    { k: "invoiced" as SortKey, l: "Facturado" },
                    { k: "balance" as SortKey, l: "Saldo" },
                    { k: "visits" as SortKey, l: "Visitas" },
                  ]).map((opt) => (
                    <button
                      key={opt.k}
                      type="button"
                      onClick={() => setSortKey(opt.k)}
                      style={{
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        border: "1px solid var(--border-strong)",
                        background: sortKey === opt.k ? "var(--brand-softer)" : "var(--bg-elev)",
                        color: sortKey === opt.k ? "var(--brand)" : "var(--text-3)",
                      }}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              }
            >
              {topSorted.length === 0 ? (
                <Empty>Sin pacientes con facturación todavía.</Empty>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--text-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        <th style={thStyle}>Paciente</th>
                        <th style={thStyleRight}>Facturado</th>
                        <th style={thStyleRight}>Pagado</th>
                        <th style={thStyleRight}>Saldo</th>
                        <th style={thStyleRight}>Visitas</th>
                        <th style={thStyleRight}>Última</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSorted.slice(0, 25).map((p) => (
                        <tr key={p.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-4)" }}>{p.patientNumber}</div>
                          </td>
                          <td style={tdStyleRightMono}>{money(p.invoiced)}</td>
                          <td style={{ ...tdStyleRightMono, color: "#059669", fontWeight: 600 }}>{money(p.paid)}</td>
                          <td style={{ ...tdStyleRightMono, color: p.balance > 0 ? "#dc2626" : "var(--text-4)" }}>{p.balance > 0 ? money(p.balance) : "—"}</td>
                          <td style={tdStyleRightMono}>{p.visits}</td>
                          <td style={{ ...tdStyleRight, color: "var(--text-3)" }}>{dateShort(p.lastVisit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {/* Riesgo de abandono */}
            <Panel title={`Riesgo de abandono${churn ? ` (${churn.count})` : ""}`}>
              {!churn || churn.patients.length === 0 ? (
                <Empty>Ningún paciente en riesgo. 🎉</Empty>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {churn.patients.slice(0, 20).map((p) => {
                    const wa = waLink(p.phone);
                    return (
                      <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", borderTop: "1px solid var(--border-soft)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {p.reasons.map((r, i) => (
                              <span key={i} style={{ background: "rgba(220,38,38,0.10)", color: "#dc2626", borderRadius: 6, padding: "1px 6px" }}>{r}</span>
                            ))}
                          </div>
                        </div>
                        {wa ? (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px", fontSize: 11, fontWeight: 600, borderRadius: 7, textDecoration: "none", background: "rgba(16,185,129,0.12)", color: "#059669", border: "1px solid rgba(16,185,129,0.25)" }}
                            title="Contactar por WhatsApp"
                          >
                            <MessageCircle size={12} aria-hidden /> Contactar
                          </a>
                        ) : (
                          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-4)" }}>Sin teléfono</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </AnalyticsLayout>
  );
}

/* ─── Sub-componentes ─── */
const thStyle: React.CSSProperties = { padding: "8px 10px", fontWeight: 600 };
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "9px 10px", verticalAlign: "top" };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: "right" };
const tdStyleRightMono: React.CSSProperties = { ...tdStyleRight, fontVariantNumeric: "tabular-nums", color: "var(--text-2)" };

function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--border-soft)", background: "var(--bg-elev-2)" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>{children}</div>;
}

function Box({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14, padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}
