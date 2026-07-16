"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, PiggyBank, Receipt, CalendarCheck, Banknote,
  Plus, Trash2, X, RefreshCw, ArrowRight, Wallet, AlertTriangle, BarChart3,
  type LucideIcon,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN, fmtMXNdec } from "@/lib/format";

// ── Contrato de datos (no renombrar claves) ────────────────────────
interface SeriePoint { fecha: string; ingresos: number; gastos: number }
interface DoctorRow  { doctorId: string; doctor: string; ingresos: number }
interface FinanzasResumen {
  ingresos: number;
  gastos:   number;
  utilidad: number;
  ventas:   number;
  citas:    number;
  efectivo: number;
  serie:     SeriePoint[];
  porDoctor: DoctorRow[];
  saldos:    { porCobrar: number; vencido: number };
}
interface Gasto { id: string; date: string; category: string; amount: number; note: string | null }

type PeriodKey = "hoy" | "mes" | "mes_anterior" | "custom";
type TabKey    = "resumen" | "gastos" | "doctores" | "saldos";

const PERIOD_PILLS: { key: PeriodKey; label: string }[] = [
  { key: "hoy",          label: "Hoy" },
  { key: "mes",          label: "Este mes" },
  { key: "mes_anterior", label: "Mes anterior" },
  { key: "custom",       label: "Personalizado" },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: "resumen",  label: "Resumen" },
  { key: "gastos",   label: "Gastos" },
  { key: "doctores", label: "Por doctor" },
  { key: "saldos",   label: "Saldos" },
];

const CATEGORIAS = ["Renta", "Insumos", "Nómina", "Servicios", "Marketing", "Otro"];

// ── Helpers de formato ─────────────────────────────────────────────
// Utilidad puede ser negativa: "−$1,200" en vez de "$-1,200".
const fmtMXNSigned = (n: number) => (n < 0 ? "−" : "") + fmtMXN(Math.abs(n ?? 0));

// Fechas YYYY-MM-DD / ISO parseadas a mediodía local para evitar el
// corrimiento de un día por zona horaria (México).
const asLocalDay  = (s: string) => new Date(s.slice(0, 10) + "T12:00:00");
const fmtDayShort = (s: string) => asLocalDay(s).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
const fmtDayLong  = (s: string) => asLocalDay(s).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
const shortMoney  = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);

function todayLocalISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ── Tarjeta KPI (estilo .kpi del design system, ícono con tono) ────
type Tone = "brand" | "success" | "danger";
const TONE_CHIP: Record<Tone, { bg: string; fg: string } | null> = {
  brand:   null, // .kpi__icon ya es violeta (theme-aware) — sin override
  success: { bg: "var(--success-soft)", fg: "var(--success)" },
  danger:  { bg: "var(--danger-soft)",  fg: "var(--danger)" },
};

function Kpi({ label, value, icon: Icon, tone, valueTone, hero, big }: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: Tone;
  valueTone?: Tone;
  hero?: boolean;
  big?: boolean;
}) {
  const chip = TONE_CHIP[tone];
  const ring = tone === "danger" ? "rgba(220,38,38,0.28)" : tone === "success" ? "rgba(5,150,105,0.28)" : "rgba(124,58,237,0.28)";
  return (
    <div className="kpi" style={hero ? { boxShadow: `0 0 0 1px ${ring}, var(--shadow-1)` } : undefined}>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        <div className="kpi__icon" style={chip ? { background: chip.bg, color: chip.fg, borderColor: "transparent" } : undefined}>
          <Icon size={17} strokeWidth={1.75} />
        </div>
      </div>
      <div
        className="kpi__value"
        style={{
          fontSize: big ? "clamp(26px, 3vw, 34px)" : "clamp(22px, 2.2vw, 28px)",
          color: valueTone === "success" ? "var(--success-strong)" : valueTone === "danger" ? "var(--danger-strong)" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Skeleton (silueta de tarjetas + gráfica) ───────────────────────
function Skeletons() {
  return (
    <div className="animate-pulse" aria-hidden style={{ marginTop: 16 }}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="kpi">
            <div style={{ height: 12, width: "45%", borderRadius: 6, background: "var(--bg-elev-2)", marginBottom: 18 }} />
            <div style={{ height: 26, width: "60%", borderRadius: 8, background: "var(--bg-elev-2)" }} />
          </div>
        ))}
      </div>
      <div className="kpi" style={{ marginTop: 16 }}>
        <div style={{ height: 280, borderRadius: 10, background: "var(--bg-elev-2)" }} />
      </div>
    </div>
  );
}

// ── Cliente principal ──────────────────────────────────────────────
export function FinanzasClient() {
  const [tab, setTab]       = useState<TabKey>("resumen");
  const [period, setPeriod] = useState<PeriodKey>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  // query = fuente de verdad del refetch. Cambiar pills / Aplicar la actualiza;
  // reloadKey fuerza recarga (Reintentar, post-guardar/eliminar gasto).
  const [query, setQuery]         = useState("period=mes");
  const [reloadKey, setReloadKey] = useState(0);

  const [data, setData]       = useState<FinanzasResumen | null>(null);
  const [gastos, setGastos]   = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  // Modal "Registrar gasto"
  const [showModal, setShowModal] = useState(false);
  const [mCategoria, setMCategoria] = useState(CATEGORIAS[0]);
  const [mMonto, setMMonto]         = useState("");
  const [mFecha, setMFecha]         = useState(todayLocalISO());
  const [mNota, setMNota]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Deps SOLO query + reloadKey (el estado que setea el efecto NO va en deps
  // para no auto-cancelarse). AbortController limpia el fetch anterior.
  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    setError(false);
    Promise.all([
      fetch(`/api/finanzas?${query}`, { signal: ctrl.signal }).then((r) => {
        if (!r.ok) throw new Error("finanzas");
        return r.json();
      }),
      fetch(`/api/gastos?${query}`, { signal: ctrl.signal }).then((r) => {
        if (!r.ok) throw new Error("gastos");
        return r.json();
      }),
    ])
      .then(([resumen, g]) => {
        if (!alive) return;
        setData(resumen as FinanzasResumen);
        setGastos(Array.isArray(g?.gastos) ? (g.gastos as Gasto[]) : []);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!alive || e?.name === "AbortError") return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; ctrl.abort(); };
  }, [query, reloadKey]);

  const selectPeriod = (p: PeriodKey) => {
    setPeriod(p);
    if (p !== "custom") setQuery(`period=${p}`);
    // Personalizado espera al botón "Aplicar".
  };

  const customValid = !!customFrom && !!customTo && customFrom <= customTo;
  const applyCustom = () => {
    if (!customValid) return;
    setQuery(`period=custom&from=${customFrom}&to=${customTo}`);
  };

  const openModal = () => {
    setMCategoria(CATEGORIAS[0]);
    setMMonto("");
    setMFecha(todayLocalISO());
    setMNota("");
    setShowModal(true);
  };

  const montoNum   = parseFloat(mMonto);
  const montoValid = !Number.isNaN(montoNum) && montoNum > 0;

  async function saveGasto() {
    if (!montoValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: mFecha || undefined,
          category: mCategoria,
          amount: montoNum,
          note: mNota.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setShowModal(false);
      setReloadKey((k) => k + 1); // refresca gastos Y resumen
      toast.success("Gasto registrado");
    } catch {
      toast.error("No se pudo guardar el gasto. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteGasto(id: string) {
    if (!window.confirm("¿Eliminar este gasto?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/gastos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setReloadKey((k) => k + 1);
    } catch {
      toast.error("No se pudo eliminar el gasto.");
    } finally {
      setDeletingId(null);
    }
  }

  const serie = data?.serie ?? [];
  const hasMovs = useMemo(() => serie.some((p) => (p.ingresos || 0) > 0 || (p.gastos || 0) > 0), [serie]);
  const maxDoctor = useMemo(
    () => (data?.porDoctor ?? []).reduce((m, d) => Math.max(m, d.ingresos || 0), 0),
    [data],
  );
  const totalGastos = useMemo(() => gastos.reduce((s, g) => s + (g.amount || 0), 0), [gastos]);
  const utilidadPos = (data?.utilidad ?? 0) >= 0;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", width: "100%", padding: "clamp(4px, 0.6vw, 12px)" }}>
      {/* Header + pills de periodo */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: "clamp(20px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 700, margin: 0 }}>
            Finanzas
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>El pulso financiero de tu clínica</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIOD_PILLS.map((p) => {
            const active = period === p.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => selectPeriod(p.key)}
                style={{
                  height: 30,
                  padding: "0 13px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  border: `1px solid ${active ? "rgba(124,58,237,0.35)" : "var(--border-soft)"}`,
                  background: active ? "var(--brand-soft)" : "var(--bg-elev)",
                  color: active ? "var(--brand)" : "var(--text-2)",
                  transition: "all .15s",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rango personalizado */}
      {period === "custom" && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <div className="field-new" style={{ width: 150 }}>
            <label className="field-new__label" htmlFor="fin-from">De</label>
            <input id="fin-from" type="date" className="input-new" value={customFrom} max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div className="field-new" style={{ width: 150 }}>
            <label className="field-new__label" htmlFor="fin-to">Hasta</label>
            <input id="fin-to" type="date" className="input-new" value={customTo} min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)} />
          </div>
          <ButtonNew variant="primary" disabled={!customValid} onClick={applyCustom}>Aplicar</ButtonNew>
        </div>
      )}

      {/* Sub-pestañas */}
      <div className="segment-new" role="tablist" style={{ marginBottom: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`segment-new__btn ${tab === t.key ? "segment-new__btn--active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && !loading && (
        <div style={{
          marginTop: 16, background: "var(--danger-soft)", border: "1px solid var(--danger-border-strong)",
          borderRadius: "var(--radius-lg)", padding: "14px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ color: "var(--text-1)", fontSize: 13 }}>No pudimos cargar tus finanzas.</span>
          <ButtonNew variant="secondary" icon={<RefreshCw size={15} strokeWidth={1.75} />} onClick={() => setReloadKey((k) => k + 1)}>
            Reintentar
          </ButtonNew>
        </div>
      )}

      {/* Loading */}
      {loading && <Skeletons />}

      {/* ── TAB Resumen ── */}
      {!loading && !error && data && tab === "resumen" && (
        <div style={{ marginTop: 16 }}>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            <Kpi label="Ingresos" value={fmtMXN(data.ingresos)} icon={TrendingUp} tone="brand" />
            <Kpi label="Gastos" value={fmtMXN(data.gastos)} icon={TrendingDown} tone="danger" />
            <Kpi
              label="Utilidad"
              value={fmtMXNSigned(data.utilidad)}
              icon={PiggyBank}
              tone={utilidadPos ? "success" : "danger"}
              valueTone={utilidadPos ? "success" : "danger"}
              hero
            />
            <Kpi label="Ventas" value={(data.ventas ?? 0).toLocaleString("es-MX")} icon={Receipt} tone="brand" />
            <Kpi label="Citas" value={(data.citas ?? 0).toLocaleString("es-MX")} icon={CalendarCheck} tone="brand" />
            <Kpi label="Efectivo recibido" value={fmtMXN(data.efectivo)} icon={Banknote} tone="success" />
          </div>

          <div style={{ marginTop: 16 }}>
            <CardNew
              title="Ingresos vs Gastos"
              action={
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "#7c3aed" }} /> Ingresos
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "#f43f5e" }} /> Gastos
                  </span>
                </div>
              }
            >
              {!hasMovs ? (
                <div style={{ height: 280, display: "grid", placeItems: "center" }}>
                  <div style={{ textAlign: "center", color: "var(--text-3)" }}>
                    <BarChart3 size={28} strokeWidth={1.5} style={{ marginBottom: 8 }} aria-hidden />
                    <div style={{ fontSize: 13 }}>Sin movimientos en este periodo</div>
                  </div>
                </div>
              ) : (
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <AreaChart data={serie} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="finIngresosFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="finGastosFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.18} />
                          <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.10)" vertical={false} />
                      <XAxis
                        dataKey="fecha"
                        stroke="var(--text-4)"
                        tick={{ fontSize: 10, fill: "var(--text-4)" }}
                        tickFormatter={(v: string) => fmtDayShort(String(v))}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={28}
                      />
                      <YAxis
                        stroke="var(--text-4)"
                        tick={{ fontSize: 10, fill: "var(--text-4)" }}
                        axisLine={false}
                        tickLine={false}
                        width={46}
                        tickFormatter={(v: number) => shortMoney(v)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-elev)",
                          border: "1px solid var(--border-strong)",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "var(--text-1)",
                        }}
                        cursor={{ stroke: "rgba(124,58,237,0.35)" }}
                        labelFormatter={(l: any) => fmtDayLong(String(l))}
                        formatter={(v: any, name: any) => [fmtMXN(Number(v) || 0), name === "ingresos" ? "Ingresos" : "Gastos"]}
                      />
                      <Area type="monotone" dataKey="ingresos" name="ingresos" stroke="#7c3aed" strokeWidth={2} fill="url(#finIngresosFill)" />
                      <Area type="monotone" dataKey="gastos" name="gastos" stroke="#f43f5e" strokeWidth={2} fill="url(#finGastosFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardNew>
          </div>
        </div>
      )}

      {/* ── TAB Gastos ── */}
      {!loading && !error && tab === "gastos" && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ color: "var(--text-3)", fontSize: 12.5 }}>
              {gastos.length > 0
                ? `${gastos.length} ${gastos.length === 1 ? "gasto" : "gastos"} · ${fmtMXN(totalGastos)}`
                : " "}
            </span>
            <ButtonNew variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openModal}>
              Registrar gasto
            </ButtonNew>
          </div>

          {gastos.length === 0 ? (
            <CardNew>
              <div style={{ textAlign: "center", padding: "36px 20px", color: "var(--text-3)" }}>
                <Wallet size={28} strokeWidth={1.5} style={{ marginBottom: 10 }} aria-hidden />
                <p style={{ fontSize: 13, margin: 0 }}>
                  Aún no registras gastos este mes — agrégalos para ver tu utilidad real.
                </p>
              </div>
            </CardNew>
          ) : (
            <CardNew noPad>
              <div>
                {gastos.map((g, i) => (
                  <div
                    key={g.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
                      borderBottom: i === gastos.length - 1 ? "none" : "1px solid var(--border-soft)",
                    }}
                  >
                    <span style={{ color: "var(--text-3)", fontSize: 12, minWidth: 52, flexShrink: 0 }}>
                      {fmtDayShort(g.date)}
                    </span>
                    <span style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 500, padding: "2px 9px", borderRadius: 999,
                      background: "var(--brand-softer)", border: "1px solid var(--border-soft)", color: "var(--text-2)",
                    }}>
                      {g.category}
                    </span>
                    <span style={{
                      flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: "var(--text-3)", fontSize: 12.5,
                    }}>
                      {g.note || ""}
                    </span>
                    <span style={{
                      flexShrink: 0, fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 13.5,
                      color: "var(--danger)", textAlign: "right",
                    }}>
                      {fmtMXNdec(g.amount)}
                    </span>
                    <button
                      type="button"
                      className="btn-new btn-new--ghost btn-new--sm"
                      aria-label="Eliminar gasto"
                      disabled={deletingId === g.id}
                      onClick={() => deleteGasto(g.id)}
                      style={{ color: "var(--text-3)", flexShrink: 0 }}
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
            </CardNew>
          )}
        </div>
      )}

      {/* ── TAB Por doctor ── */}
      {!loading && !error && data && tab === "doctores" && (
        <div style={{ marginTop: 16 }}>
          {(data.porDoctor ?? []).length === 0 ? (
            <CardNew>
              <div style={{ textAlign: "center", padding: "36px 20px", color: "var(--text-3)", fontSize: 13 }}>
                Sin facturas con doctor asignado en este periodo
              </div>
            </CardNew>
          ) : (
            <CardNew noPad>
              <div style={{
                display: "flex", justifyContent: "space-between", padding: "10px 16px",
                borderBottom: "1px solid var(--border-soft)",
                fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                <span>Doctor</span>
                <span>Ingresos generados</span>
              </div>
              {data.porDoctor.map((d, i) => (
                <div
                  key={d.doctorId}
                  style={{
                    padding: "12px 16px",
                    borderBottom: i === data.porDoctor.length - 1 ? "none" : "1px solid var(--border-soft)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ color: "var(--text-1)", fontSize: 13.5, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.doctor}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 13.5, color: "var(--text-1)", flexShrink: 0 }}>
                      {fmtMXN(d.ingresos)}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: "var(--brand-softer)", overflow: "hidden" }} aria-hidden>
                    <div style={{
                      height: "100%", borderRadius: 999, background: "var(--brand)",
                      width: `${maxDoctor > 0 ? Math.max(2, Math.round(((d.ingresos || 0) / maxDoctor) * 100)) : 0}%`,
                      transition: "width .3s",
                    }} />
                  </div>
                </div>
              ))}
            </CardNew>
          )}
        </div>
      )}

      {/* ── TAB Saldos ── */}
      {!loading && !error && data && tab === "saldos" && (
        <div style={{ marginTop: 16 }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <Kpi label="Por cobrar" value={fmtMXN(data.saldos?.porCobrar ?? 0)} icon={Wallet} tone="brand" big />
            <Kpi label="Vencido" value={fmtMXN(data.saldos?.vencido ?? 0)} icon={AlertTriangle} tone="danger" big />
          </div>
          <div style={{ marginTop: 14 }}>
            <Link
              href="/dashboard/caja?tab=facturas"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--brand)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              Ver facturas en Caja <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </Link>
            <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 6 }}>
              Saldos totales de la clínica — no dependen del periodo.
            </p>
          </div>
        </div>
      )}

      {/* ── Modal: Registrar gasto ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Registrar gasto</div>
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
                onClick={() => setShowModal(false)}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); saveGasto(); }}>
              <div className="modal__body">
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label" htmlFor="gasto-cat">Categoría <span className="req">*</span></label>
                  <select id="gasto-cat" className="input-new" value={mCategoria} onChange={(e) => setMCategoria(e.target.value)}>
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label" htmlFor="gasto-monto">Monto <span className="req">*</span></label>
                  <input
                    id="gasto-monto"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="input-new"
                    placeholder="0.00"
                    autoFocus
                    value={mMonto}
                    onChange={(e) => setMMonto(e.target.value)}
                  />
                </div>
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label" htmlFor="gasto-fecha">Fecha</label>
                  <input id="gasto-fecha" type="date" className="input-new" value={mFecha} onChange={(e) => setMFecha(e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="gasto-nota">Nota (opcional)</label>
                  <input
                    id="gasto-nota"
                    className="input-new"
                    placeholder="Ej. compra de guantes"
                    value={mNota}
                    onChange={(e) => setMNota(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowModal(false)}>Cancelar</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={!montoValid || saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
