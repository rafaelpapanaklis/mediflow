"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, Gauge, TrendingUp, AlertTriangle, RefreshCw, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { formatCurrency } from "@/lib/utils";
import { fmtMXNdec } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";

// ---- Tipos del GET /api/admin/ai-billing ----
type Pricing = {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  cacheWriteUsdPerMtok: number;
  cacheReadUsdPerMtok: number;
  usdToMxnRate: number;
  feePct: number;
};
type Margin = { incomeMxn: number; realCostMxn: number; marginMxn: number; marginPct: number | null };
/** prepaid = monedero WhatsApp · included = IA clínica que absorbe el plan. */
type UsageKind = "prepaid" | "included" | "mixed" | "none";
type ClinicRow = {
  clinicId: string;
  name: string;
  slug: string | null;
  /** null = la clínica no tiene monedero prepago (no es saldo 0, es "no aplica"). */
  balanceCents: number | null;
  hasWallet: boolean;
  status: string | null;
  autoRecharge: boolean;
  consumoMxn: number;
  prepaidCostUsd: number;
  absorbedCostUsd: number;
  realCostUsd: number;
  eventCount: number;
  prepaidEventCount: number;
  absorbedEventCount: number;
  usageKind: UsageKind;
  costSharePct: number;
  lowBalance: boolean;
};
type CostBlock = {
  prepaidUsd: number;
  absorbedUsd: number;
  totalUsd: number;
  prepaidMxn: number;
  absorbedMxn: number;
  totalMxn: number;
};
type Dashboard = {
  pricing: Pricing;
  anthropic: {
    rechargedUsd: number;
    consumedUsd: number;
    balanceUsd: number;
    runwayDays: number | null;
    avgDailyBurnUsd: number;
    burnWindowDays: number;
  };
  /** SOLO prepago (WhatsApp). El consumo incluido en los planes no entra aquí. */
  margin: { allTime: Margin; month: Margin };
  absorbed: {
    allTime: { costUsd: number; costMxn: number };
    month: { costUsd: number; costMxn: number; clinicCount: number; eventCount: number };
  };
  cost: { month: CostBlock; allTime: CostBlock };
  totals: {
    clinicCount: number;
    walletCount: number;
    includedClinicCount: number;
    lowBalanceCount: number;
    negativeCount: number;
    pausedCount: number;
    shownCount: number;
    capped: boolean;
  };
  clinics: ClinicRow[];
  generatedAt: string;
};
type Topup = {
  id: string;
  clinicId: string;
  amountCents: number;
  method: string;
  status: string;
  proofUrl: string | null;
  gatewayRef: string | null;
  createdAt: string;
  clinicName?: string;
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n ?? 0);

const PRICE_FIELDS: { key: keyof Pricing; label: string; hint?: string; step: number }[] = [
  { key: "inputUsdPerMtok", label: "Input · USD/Mtok", step: 0.01 },
  { key: "outputUsdPerMtok", label: "Output · USD/Mtok", step: 0.01 },
  { key: "cacheWriteUsdPerMtok", label: "Cache write · USD/Mtok", step: 0.01 },
  { key: "cacheReadUsdPerMtok", label: "Cache read · USD/Mtok", step: 0.01 },
  { key: "usdToMxnRate", label: "Tipo de cambio USD a MXN", step: 0.1 },
  { key: "feePct", label: "Fee oculto (%)", hint: "La clínica nunca lo ve", step: 0.5 },
];

const labelStyle = { fontSize: 11, color: "var(--text-3)", fontWeight: 600 } as const;

// Espeja MAX_ROWS del endpoint; solo se usa para el texto de "tope alcanzado".
const MAX_ROWS_UI = 500;

export function AiBillingClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [priceForm, setPriceForm] = useState<Pricing | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);

  const [rechargeUsd, setRechargeUsd] = useState("");
  const [rechargeNote, setRechargeNote] = useState("");
  const [savingRecharge, setSavingRecharge] = useState(false);

  const [adjustClinic, setAdjustClinic] = useState<ClinicRow | null>(null);
  const [adjustPesos, setAdjustPesos] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [savingAdjust, setSavingAdjust] = useState(false);

  const [topups, setTopups] = useState<Topup[] | null>(null);
  const [topupsAvailable, setTopupsAvailable] = useState(true);
  const [topupBusy, setTopupBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai-billing", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Error al cargar");
      const json: Dashboard = await res.json();
      setData(json);
      setPriceForm(json.pricing);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Consume el módulo SPEI de T5 (GET /topups). 404 hasta que T5 mergee.
  const fetchTopups = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai-billing/topups?status=PENDING", { cache: "no-store" });
      if (!res.ok) {
        setTopupsAvailable(false);
        return;
      }
      const json = await res.json();
      const list: Topup[] = Array.isArray(json) ? json : json.topups ?? json.items ?? [];
      setTopups(list);
      setTopupsAvailable(true);
    } catch {
      setTopupsAvailable(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchTopups();
  }, [fetchData, fetchTopups]);

  async function savePricing() {
    if (!priceForm) return;
    setSavingPrice(true);
    try {
      const res = await fetch("/api/admin/ai-billing/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(priceForm),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Error");
      toast.success("Precios actualizados");
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setSavingPrice(false);
    }
  }

  async function saveRecharge() {
    const usd = Number(rechargeUsd);
    if (!Number.isFinite(usd) || usd <= 0) {
      toast.error("Monto inválido");
      return;
    }
    setSavingRecharge(true);
    try {
      const res = await fetch("/api/admin/ai-billing/anthropic-recharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd: usd, note: rechargeNote || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Error");
      toast.success("Recarga registrada");
      setRechargeUsd("");
      setRechargeNote("");
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setSavingRecharge(false);
    }
  }

  async function submitAdjust() {
    if (!adjustClinic) return;
    const pesos = Number(adjustPesos);
    if (!Number.isFinite(pesos) || pesos === 0) {
      toast.error("Monto inválido (puede ser negativo)");
      return;
    }
    setSavingAdjust(true);
    try {
      const res = await fetch("/api/admin/ai-billing/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId: adjustClinic.clinicId,
          amountCents: Math.round(pesos * 100),
          note: adjustNote || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Error");
      toast.success("Saldo ajustado");
      setAdjustClinic(null);
      setAdjustPesos("");
      setAdjustNote("");
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setSavingAdjust(false);
    }
  }

  // T5 (topups/[id]) espera { action: "confirm" | "reject" }, no { status }.
  async function resolveTopup(id: string, action: "confirm" | "reject") {
    setTopupBusy(id);
    try {
      const res = await fetch(`/api/admin/ai-billing/topups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Error");
      toast.success(action === "confirm" ? "Recarga confirmada" : "Recarga rechazada");
      await Promise.all([fetchTopups(), fetchData()]);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setTopupBusy(null);
    }
  }

  if (loading && !data) {
    return <div style={{ maxWidth: 1280, margin: "0 auto", padding: 40, color: "var(--text-3)" }}>Cargando tesorería…</div>;
  }
  if (error && !data) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <CardNew>
          <div style={{ padding: 16, color: "var(--danger)", fontSize: 13 }}>Error: {error}</div>
          <ButtonNew
            variant="secondary"
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
          >
            Reintentar
          </ButtonNew>
        </CardNew>
      </div>
    );
  }

  const d = data!;
  const a = d.anthropic;
  const mAll = d.margin.allTime;
  const mMonth = d.margin.month;
  // Defaults defensivos: si el panel queda servido contra un deploy viejo del
  // endpoint (sin los bloques nuevos) muestra ceros en vez de reventar.
  const abs = d.absorbed ?? { allTime: { costUsd: 0, costMxn: 0 }, month: { costUsd: 0, costMxn: 0, clinicCount: 0, eventCount: 0 } };
  const cMonth =
    d.cost?.month ?? { prepaidUsd: 0, absorbedUsd: 0, totalUsd: 0, prepaidMxn: 0, absorbedMxn: 0, totalMxn: 0 };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>Tesorería de IA</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Costo real en USD, margen y saldo de Anthropic. Solo visible para DaleControl.
          </p>
        </div>
        <ButtonNew variant="secondary" icon={<RefreshCw size={14} />} onClick={() => fetchData()}>
          Actualizar
        </ButtonNew>
      </div>

      {/* KPIs principales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard
          label="Saldo Anthropic"
          value={fmtUSD(a.balanceUsd)}
          icon={Wallet}
          delta={{ value: `${fmtUSD(a.consumedUsd)} usado de ${fmtUSD(a.rechargedUsd)}`, direction: a.balanceUsd >= 0 ? "up" : "down" }}
        />
        <KpiCard
          label="Runway"
          value={a.runwayDays == null ? "∞" : `${Math.floor(a.runwayDays)} días`}
          icon={Gauge}
          delta={{ value: `${fmtUSD(a.avgDailyBurnUsd)} por día`, direction: "down" }}
        />
        <KpiCard
          label="Margen prepago del mes"
          value={formatCurrency(mMonth.marginMxn, "MXN")}
          icon={TrendingUp}
          delta={{
            value: mMonth.marginPct == null ? "sin consumo prepago" : `${mMonth.marginPct.toFixed(1)}% sobre lo facturado`,
            direction: "up",
          }}
        />
        <KpiCard
          label="Clínicas saldo bajo"
          value={String(d.totals.lowBalanceCount)}
          icon={AlertTriangle}
          delta={{ value: `${d.totals.negativeCount} en negativo`, direction: d.totals.negativeCount > 0 ? "down" : "up" }}
        />
      </div>

      {/* Costo del mes: las dos bolsas por separado + el cheque real */}
      <SectionLabel
        title="Este mes"
        hint="El prepago del bot factura y deja margen. La IA clínica cuesta pero no factura aquí: la paga la mensualidad de la clínica."
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <StatTile
          label="Costo total del mes"
          value={fmtUSD(cMonth.totalUsd)}
          sub={`${formatCurrency(cMonth.totalMxn, "MXN")} · prepago + absorbido = el cheque a Anthropic`}
        />
        <StatTile
          label="Prepago · bot de WhatsApp"
          value={fmtUSD(cMonth.prepaidUsd)}
          sub={`${formatCurrency(mMonth.incomeMxn, "MXN")} facturado · margen ${
            mMonth.marginPct == null ? "—" : `${mMonth.marginPct.toFixed(1)}%`
          }`}
        />
        <StatTile
          label="Costo absorbido (incluido en planes)"
          value={fmtUSD(abs.month.costUsd)}
          sub={`${formatCurrency(abs.month.costMxn, "MXN")} · La clínica no paga extra; sale de su mensualidad.`}
          warn={abs.month.costUsd > 0}
        />
      </div>
      {abs.month.eventCount > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: -12, marginBottom: 20 }}>
          {abs.month.eventCount.toLocaleString("es-MX")} análisis de IA clínica en{" "}
          {abs.month.clinicCount} {abs.month.clinicCount === 1 ? "clínica" : "clínicas"} este mes, sin cobro
          extra. No entra en el margen porque su ingreso es la mensualidad, no el monedero.
        </div>
      )}

      {/* Stats secundarios — histórico */}
      <SectionLabel title="Histórico" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <StatTile
          label="Consumo total (Anthropic)"
          value={fmtUSD(a.consumedUsd)}
          sub={`${fmtUSD(a.rechargedUsd)} cargado · ${fmtUSD(abs.allTime.costUsd)} absorbido`}
        />
        <StatTile label="Ingreso prepago" value={formatCurrency(mAll.incomeMxn, "MXN")} sub="facturado, fee incluido" />
        <StatTile label="Costo real prepago" value={formatCurrency(mAll.realCostMxn, "MXN")} sub="Anthropic a MXN (fx histórico)" />
        <StatTile
          label="Margen prepago"
          value={formatCurrency(mAll.marginMxn, "MXN")}
          sub={mAll.marginPct == null ? "—" : `${mAll.marginPct.toFixed(1)}% margen`}
          accent
        />
      </div>

      {/* Editor de precios + recarga Anthropic */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 20 }}>
        <CardNew title="Precios y tipo de cambio" sub="Solo DaleControl · la clínica nunca ve USD ni el fee">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
            {PRICE_FIELDS.map((f) => (
              <label key={f.key} style={{ display: "block" }}>
                <span style={labelStyle}>{f.label}</span>
                <input
                  className="input-new"
                  type="number"
                  step={f.step}
                  min={0}
                  value={priceForm ? priceForm[f.key] : ""}
                  onChange={(e) =>
                    setPriceForm((p) => (p ? { ...p, [f.key]: e.target.value === "" ? 0 : Number(e.target.value) } : p))
                  }
                  style={{ marginTop: 4 }}
                />
                {f.hint && <span style={{ fontSize: 10, color: "var(--text-3)" }}>{f.hint}</span>}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <ButtonNew variant="primary" onClick={savePricing} disabled={savingPrice}>
              {savingPrice ? "Guardando…" : "Guardar precios"}
            </ButtonNew>
          </div>
        </CardNew>

        <CardNew title="Registrar recarga Anthropic" sub="Cuando cargas saldo en Anthropic">
          <label style={{ display: "block" }}>
            <span style={labelStyle}>Monto (USD)</span>
            <input
              className="input-new"
              type="number"
              step={0.01}
              min={0}
              value={rechargeUsd}
              onChange={(e) => setRechargeUsd(e.target.value)}
              placeholder="100.00"
              style={{ marginTop: 4 }}
            />
          </label>
          <label style={{ display: "block", marginTop: 10 }}>
            <span style={labelStyle}>Nota (opcional)</span>
            <input
              className="input-new"
              value={rechargeNote}
              onChange={(e) => setRechargeNote(e.target.value)}
              placeholder="Tarjeta terminación 1234"
              style={{ marginTop: 4 }}
            />
          </label>
          <div style={{ marginTop: 14 }}>
            <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={saveRecharge} disabled={savingRecharge} style={{ width: "100%" }}>
              {savingRecharge ? "Registrando…" : "Registrar recarga"}
            </ButtonNew>
          </div>
        </CardNew>
      </div>

      {/* Tabla por-clínica */}
      <CardNew
        noPad
        title="Saldo y consumo por clínica"
        sub={
          d.totals.capped
            ? `Mostrando ${d.totals.shownCount} de ${d.totals.clinicCount} clínicas (tope ${MAX_ROWS_UI})`
            : `${d.totals.walletCount} con monedero prepago · ${d.totals.includedClinicCount} con IA incluida en su plan`
        }
        action={
          <ButtonNew size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => fetchData()}>
            Actualizar
          </ButtonNew>
        }
      >
        <table className="table-new">
          <thead>
            <tr>
              <th>Clínica</th>
              <th>Tipo de consumo</th>
              <th>Saldo (MXN)</th>
              <th>Consumo prepago (MXN)</th>
              <th>Costo real (USD)</th>
              <th>Participación</th>
              <th>Estado</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {d.clinics.map((c) => {
              const bal = c.balanceCents;
              const balColor = bal == null ? "var(--text-3)" : bal < 0 ? "var(--danger)" : c.lowBalance ? "var(--warning)" : "var(--text-1)";
              return (
                <tr key={c.clinicId}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AvatarNew name={c.name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "var(--text-1)", fontWeight: 500 }}>{c.name}</div>
                        {c.slug && (
                          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {c.slug}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <UsageKindChip kind={c.usageKind} />
                  </td>
                  {/* Sin monedero va "—", no $0.00: un cero se lee como deuda. */}
                  <td className="mono" style={{ fontWeight: 500, color: balColor }} title={bal == null ? "La clínica no tiene monedero prepago" : undefined}>
                    {bal == null ? "—" : fmtMXNdec(bal / 100)}
                  </td>
                  <td className="mono" style={{ color: "var(--text-2)" }}>
                    {c.prepaidEventCount > 0 ? formatCurrency(c.consumoMxn, "MXN") : "—"}
                  </td>
                  <td className="mono" style={{ color: "var(--text-3)" }}>
                    {fmtUSD(c.realCostUsd)}
                    {c.absorbedCostUsd > 0 && c.prepaidCostUsd > 0 && (
                      <div style={{ fontSize: 10 }}>{fmtUSD(c.absorbedCostUsd)} absorbido</div>
                    )}
                  </td>
                  <td className="mono" style={{ color: "var(--text-3)" }} title="Sobre el costo total en Anthropic">
                    {c.costSharePct.toFixed(1)}%
                  </td>
                  <td>
                    {!c.hasWallet ? (
                      <BadgeNew tone="neutral">Sin monedero</BadgeNew>
                    ) : c.status === "PAUSED" ? (
                      <BadgeNew tone="danger" dot>
                        Pausado
                      </BadgeNew>
                    ) : (bal ?? 0) < 0 ? (
                      <BadgeNew tone="danger" dot>
                        Negativo
                      </BadgeNew>
                    ) : c.lowBalance ? (
                      <BadgeNew tone="warning" dot>
                        Saldo bajo
                      </BadgeNew>
                    ) : (
                      <BadgeNew tone="success" dot>
                        Activo
                      </BadgeNew>
                    )}
                    {c.autoRecharge && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>auto-recarga</div>}
                  </td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <ButtonNew
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setAdjustClinic(c);
                          setAdjustPesos("");
                          setAdjustNote("");
                        }}
                      >
                        Ajustar saldo
                      </ButtonNew>
                    </div>
                  </td>
                </tr>
              );
            })}
            {d.clinics.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                  Sin consumo ni monederos todavía
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardNew>

      {/* Recargas SPEI por confirmar (módulo T5) */}
      <div style={{ marginTop: 20 }}>
        <CardNew noPad title="Recargas SPEI por confirmar" sub="Comprobantes que suben las clínicas (módulo T5)">
          {!topupsAvailable ? (
            <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>
              El módulo de recargas SPEI (T5) aún no está disponible. Esta sección se activará cuando se publique.
            </div>
          ) : !topups || topups.length === 0 ? (
            <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>No hay recargas SPEI pendientes.</div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Monto</th>
                  <th>Comprobante</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {topups.map((t) => (
                  <tr key={t.id}>
                    <td>{t.clinicName ?? t.clinicId}</td>
                    <td className="mono">{fmtMXNdec(t.amountCents / 100)}</td>
                    <td>
                      {t.proofUrl ? (
                        <a href={t.proofUrl} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>
                          Ver
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)" }}>
                      {new Date(t.createdAt).toLocaleDateString("es-MX")}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <ButtonNew size="sm" variant="primary" disabled={topupBusy === t.id} onClick={() => resolveTopup(t.id, "confirm")}>
                          Confirmar
                        </ButtonNew>
                        <ButtonNew size="sm" variant="ghost" disabled={topupBusy === t.id} onClick={() => resolveTopup(t.id, "reject")} style={{ color: "var(--danger)" }}>
                          Rechazar
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardNew>
      </div>

      {/* Modal de ajuste de saldo */}
      {adjustClinic && (
        <div
          onClick={() => !savingAdjust && setAdjustClinic(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420 }}>
            <CardNew
              title={`Ajustar saldo · ${adjustClinic.name}`}
              sub={
                adjustClinic.balanceCents == null
                  ? "Sin monedero: el ajuste le crea uno con este saldo"
                  : `Saldo actual: ${fmtMXNdec(adjustClinic.balanceCents / 100)}`
              }
              action={
                <button onClick={() => setAdjustClinic(null)} className="icon-btn-new" aria-label="Cerrar">
                  <X size={14} />
                </button>
              }
            >
              <label style={{ display: "block" }}>
                <span style={labelStyle}>Monto en MXN (negativo para descontar)</span>
                <input
                  className="input-new"
                  type="number"
                  step={0.01}
                  value={adjustPesos}
                  onChange={(e) => setAdjustPesos(e.target.value)}
                  placeholder="100.00 o -50.00"
                  style={{ marginTop: 4 }}
                  autoFocus
                />
              </label>
              <label style={{ display: "block", marginTop: 10 }}>
                <span style={labelStyle}>Motivo</span>
                <input
                  className="input-new"
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="Cortesía, corrección, etc."
                  style={{ marginTop: 4 }}
                />
              </label>
              {adjustPesos !== "" && Number.isFinite(Number(adjustPesos)) && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-3)" }}>
                  Nuevo saldo:{" "}
                  <span className="mono" style={{ color: "var(--text-1)" }}>
                    {fmtMXNdec(((adjustClinic.balanceCents ?? 0) + Math.round(Number(adjustPesos) * 100)) / 100)}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <ButtonNew variant="ghost" onClick={() => setAdjustClinic(null)} disabled={savingAdjust}>
                  Cancelar
                </ButtonNew>
                <ButtonNew variant="primary" onClick={submitAdjust} disabled={savingAdjust}>
                  {savingAdjust ? "Aplicando…" : "Aplicar ajuste"}
                </ButtonNew>
              </div>
            </CardNew>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  /** Costo que sale sin ingreso enfrente: se pinta ámbar, no rojo (no es una pérdida). */
  warn?: boolean;
}) {
  const color = accent ? "var(--success)" : warn ? "var(--warning)" : "var(--text-1)";
  return (
    <CardNew>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </CardNew>
  );
}

function SectionLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** De dónde salió el consumo de esa clínica: del monedero o de su mensualidad. */
function UsageKindChip({ kind }: { kind: UsageKind }) {
  if (kind === "prepaid") return <BadgeNew tone="brand">Prepago</BadgeNew>;
  if (kind === "included") return <BadgeNew tone="info">Incluido en plan</BadgeNew>;
  if (kind === "mixed") return <BadgeNew tone="warning">Prepago + plan</BadgeNew>;
  return <BadgeNew tone="neutral">Sin consumo</BadgeNew>;
}
