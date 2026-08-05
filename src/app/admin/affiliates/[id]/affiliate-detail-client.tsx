"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowLeft, DollarSign, Clock, Wallet, TrendingUp, Download, Award,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { AffiliateAccountManagerBlock } from "@/components/admin/affiliate-account-manager-block";
import type { AccountManagerDTO } from "@/lib/account-manager/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
// payout-core es la mitad PURA del motor (sin Prisma): importable desde el
// cliente. `@/lib/affiliates/payout` es server-only y aquí rompería el bundle.
import {
  PAYOUT_MODE_LABELS,
  commissionKindLabel,
  type PayoutMode,
} from "@/lib/affiliates/payout-core";
// Type-only: se borra al compilar, así que importar del route handler NO
// arrastra Prisma al cliente (mismo patrón que AdminAffiliateMetricsResponse).
import type { AdminAffiliateDetailResponse } from "@/app/api/admin/affiliates/[id]/detail/route";

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

/** Lo mínimo que la página server ya conoce: pinta el header sin esperar al fetch. */
export type AffiliateDetailInitial = {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: string;
  referralCode: string;
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "neutral",
};

// Etiquetas de nivel. Duplicadas a propósito: @/lib/affiliate-levels importa
// Prisma y no puede cruzar al cliente.
const LEVEL_LABELS: Record<string, string> = {
  bronze: "Bronce",
  silver: "Plata",
  gold: "Oro",
};

const SUB_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: "Pagando", tone: "success" },
  trialing: { label: "En prueba", tone: "info" },
  past_due: { label: "Pago vencido", tone: "warning" },
  unpaid: { label: "Sin pago", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "danger" },
  canceled: { label: "Cancelada", tone: "danger" },
};

function subStatusOf(status: string | null): { label: string; tone: BadgeTone } {
  if (!status) return { label: "Sin suscripción", tone: "neutral" };
  return SUB_STATUS[status] ?? { label: status, tone: "neutral" };
}

const COMMISSION_FILTERS: { key: "ALL" | "pending" | "paid"; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "pending", label: "Pendientes" },
  { key: "paid", label: "Pagadas" },
];

const PAYOUT_MODE_OPTIONS: PayoutMode[] = ["recurring", "onetime"];

/** Escapa un campo CSV: todo entre comillas y las comillas internas duplicadas. */
function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

const noteStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-3)",
  lineHeight: 1.5,
  margin: "10px 0 0",
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  letterSpacing: "0.02em",
  marginBottom: 3,
};

export function AffiliateDetailClient({
  initial,
  accountManager = null,
}: {
  initial: AffiliateDetailInitial;
  /** Manager de cuenta ya resuelto en el server (null = sin asignar). */
  accountManager?: AccountManagerDTO | null;
}) {
  // DECISIÓN: la página server solo resuelve el encabezado (nombre/slug/estado)
  // y TODO lo pesado se pide aquí a GET /api/admin/affiliates/[id]/detail. Así
  // el cálculo de la ficha vive en UN solo lugar (el endpoint), el botón
  // "Guardar modalidad" puede refrescar sin recargar la página y el patrón es
  // el mismo `loadMetrics` que ya usa affiliates-client.tsx.
  const [data, setData] = useState<AdminAffiliateDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [mode, setMode] = useState<PayoutMode>("recurring");
  const [savingMode, setSavingMode] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "pending" | "paid">("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/affiliates/${initial.id}/detail`);
      if (!res.ok) throw new Error();
      const json: AdminAffiliateDetailResponse = await res.json();
      setData(json);
      setMode(json.affiliate.payoutMode === "onetime" ? "onetime" : "recurring");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [initial.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePayoutMode() {
    setSavingMode(true);
    try {
      const res = await fetch(`/api/admin/affiliates/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutMode: mode }),
      });
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(payload?.error ?? "No se pudo guardar la modalidad");
      setData((prev) =>
        prev ? { ...prev, affiliate: { ...prev.affiliate, payoutMode: mode } } : prev
      );
      toast.success(`Modalidad guardada: ${PAYOUT_MODE_LABELS[mode]}`);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar la modalidad");
    } finally {
      setSavingMode(false);
    }
  }

  const commissions = data?.commissions ?? [];

  const visibleCommissions = useMemo(() => {
    if (filter === "ALL") return commissions;
    return commissions.filter((c) => c.status === filter);
  }, [commissions, filter]);

  // CSV generado 100% en el cliente a partir de las filas ya cargadas (respeta
  // el filtro activo). Lleva BOM para que Excel no destroce los acentos.
  function exportCsv() {
    if (visibleCommissions.length === 0) {
      toast.error("No hay comisiones para exportar");
      return;
    }
    const header = [
      "Factura",
      "Fecha",
      "Clínica",
      "Tipo",
      "Meses cubiertos",
      "Monto factura MXN",
      "Comisión MXN",
      "Estado",
      "Pagada el",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const c of visibleCommissions) {
      lines.push(
        [
          c.stripeInvoiceId,
          c.createdAt.slice(0, 10),
          c.clinicName,
          commissionKindLabel(c.kind),
          c.monthsCovered,
          c.amountMxn,
          c.commissionMxn,
          c.status === "paid" ? "Pagada" : "Pendiente",
          c.paidAt ? c.paidAt.slice(0, 10) : "",
        ].map(csvCell).join(",")
      );
    }
    // BOM al frente: sin él Excel abre el CSV en ANSI y destroza los acentos.
    // Se construye con fromCharCode para no dejar un carácter invisible en el
    // código fuente.
    const bom = String.fromCharCode(0xfeff);
    const blob = new Blob([bom + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dalecontrol-afiliado-${data?.affiliate.slug ?? initial.slug}-comisiones.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const affiliate = data?.affiliate ?? null;
  const name = affiliate?.name ?? initial.name;
  const slug = affiliate?.slug ?? initial.slug;
  const email = affiliate?.email ?? initial.email;
  const status = affiliate?.status ?? initial.status;
  const referralCode = affiliate?.referralCode ?? initial.referralCode;

  // Nota del KPI de proyección: jamás un % genérico cuando el motor paga fijos.
  const projectionNote = !data
    ? ""
    : data.projectionIsLegacy
      ? data.program.engineEnabled
        ? `el programa paga % del nivel: MRR referido × ${data.level.pct}%`
        : `motor de comisiones inactivo: MRR referido × ${data.level.pct}%`
      : "según la modalidad congelada de cada clínica";

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* 1 · Header */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/admin/affiliates"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: "var(--text-3)",
            textDecoration: "none",
            marginBottom: 10,
          }}
        >
          <ArrowLeft size={14} />
          Volver a afiliados
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1
                style={{
                  fontSize: 22,
                  letterSpacing: "-0.02em",
                  color: "var(--text-1)",
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                {name}
              </h1>
              <BadgeNew tone={STATUS_TONE[status] ?? "neutral"} dot>
                {STATUS_LABELS[status] ?? status}
              </BadgeNew>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 5,
                fontSize: 12.5,
                color: "var(--text-3)",
              }}
            >
              <span className="mono">/socio/{slug}</span>
              <span>·</span>
              <span>{email}</span>
              <span>·</span>
              <span>
                Código{" "}
                <span className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>
                  {referralCode}
                </span>
              </span>
            </div>
          </div>

          <ButtonNew size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? "Cargando…" : "Actualizar"}
          </ButtonNew>
        </div>
      </div>

      {/* 1b · Manager de cuenta.
          Va FUERA del bloque que depende de `data`: la asignación se resuelve en
          el server y no necesita el endpoint /detail, así que sigue funcionando
          aunque la ficha pesada falle o esté cargando. */}
      <div style={{ marginBottom: 18 }}>
        <AffiliateAccountManagerBlock affiliateId={initial.id} initialManager={accountManager} />
      </div>

      {error && !data ? (
        <CardNew>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text-3)" }}>
              No se pudo cargar la ficha del afiliado.
            </span>
            <ButtonNew size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
              Reintentar
            </ButtonNew>
          </div>
        </CardNew>
      ) : !data ? (
        <CardNew>
          <div style={{ fontSize: 13, color: "var(--text-3)", padding: "4px 0" }}>
            Cargando ficha del afiliado…
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* 2 · Dinero */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
              gap: 14,
            }}
          >
            <KpiCard
              label="Comisión generada"
              value={formatCurrency(data.money.generatedMxn)}
              icon={DollarSign}
              hero
            />
            <KpiCard
              label="Pendiente de pago"
              value={formatCurrency(data.money.pendingMxn)}
              icon={Clock}
              tone={data.money.pendingMxn > 0 ? "warning" : undefined}
            />
            <KpiCard label="Pagado" value={formatCurrency(data.money.paidMxn)} icon={Wallet} />
            <KpiCard
              label="Proyección mensual"
              value={formatCurrency(data.money.projectedMonthlyMxn)}
              icon={TrendingUp}
              delta={{ value: projectionNote, direction: "up" }}
            />
          </div>

          {/* 3-5 · Modalidad, datos de pago y nivel */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
              gap: 14,
            }}
          >
            {/* 3 · Modalidad */}
            <CardNew title="Modalidad de pago" sub="Con qué esquema se le paga a este afiliado.">
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Modalidad actual</div>
                <BadgeNew tone={data.affiliate.payoutMode === "onetime" ? "info" : "brand"}>
                  {PAYOUT_MODE_LABELS[data.affiliate.payoutMode]}
                </BadgeNew>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div className="field-new" style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <label className="field-new__label" htmlFor="payout-mode">
                    Cambiar modalidad
                  </label>
                  <select
                    id="payout-mode"
                    className="input-new"
                    value={mode}
                    disabled={savingMode}
                    onChange={(e) => setMode(e.target.value === "onetime" ? "onetime" : "recurring")}
                  >
                    {PAYOUT_MODE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {PAYOUT_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <ButtonNew
                  variant="primary"
                  disabled={savingMode || mode === data.affiliate.payoutMode}
                  onClick={() => void savePayoutMode()}
                >
                  {savingMode ? "Guardando…" : "Guardar modalidad"}
                </ButtonNew>
              </div>

              <p style={noteStyle}>
                Solo aplica a las clínicas que refiera de ahora en adelante; las ya referidas
                conservan la modalidad con la que se dieron de alta.
              </p>

              {!data.program.allowAffiliateChoice && (
                <p style={noteStyle}>
                  El afiliado no puede cambiarla desde su panel: la elección está desactivada en la
                  configuración del programa.
                </p>
              )}

              {!data.program.engineEnabled && (
                <p style={{ ...noteStyle, color: "var(--warning)" }}>
                  El motor de montos fijos está inactivo (corre{" "}
                  <span className="mono">sql/afiliados-comisiones.sql</span> en Supabase): hoy se
                  paga el % del nivel.
                </p>
              )}

              {!data.payoutModeAvailable && (
                <p style={{ ...noteStyle, color: "var(--warning)" }}>
                  La columna <span className="mono">affiliates.payout_mode</span> aún no existe en la
                  base: guardar la modalidad fallará hasta aplicar el SQL.
                </p>
              )}
            </CardNew>

            {/* 4 · Datos de pago */}
            <CardNew title="Datos de pago" sub="A dónde se le depositan las comisiones.">
              {data.affiliate.payoutMethod || data.affiliate.payoutDetails ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <div style={labelStyle}>Método</div>
                    <div style={{ fontSize: 13, color: "var(--text-1)" }}>
                      {data.affiliate.payoutMethod ?? "Sin método"}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Detalles</div>
                    <div
                      className="mono"
                      style={{ fontSize: 12.5, color: "var(--text-1)", wordBreak: "break-all" }}
                    >
                      {data.affiliate.payoutDetails ?? "—"}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>
                  Sin datos. El afiliado todavía no registró método ni cuenta de pago.
                </div>
              )}

              <p style={noteStyle}>
                Alta: {formatDate(data.affiliate.createdAt)}
                {data.affiliate.approvedAt
                  ? ` · Aprobado: ${formatDate(data.affiliate.approvedAt)}`
                  : ""}
              </p>
            </CardNew>

            {/* 5 · Nivel */}
            <CardNew title="Nivel del programa" sub="Bronce, Plata y Oro por clínicas activas.">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--brand-soft)",
                    border: "1px solid var(--border-brand)",
                    color: "var(--violet-400)",
                  }}
                >
                  <Award size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
                    {data.level.legacy
                      ? "Sin niveles"
                      : (LEVEL_LABELS[data.level.level] ?? data.level.level)}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {data.level.pct}% vigente
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Clínicas activas</span>
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-1)" }}>
                    {data.level.activeCount}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Siguiente nivel</span>
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-1)" }}>
                    {data.level.nextLevel
                      ? `${LEVEL_LABELS[data.level.nextLevel] ?? data.level.nextLevel} · ${data.level.nextPct}%`
                      : "—"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Le faltan</span>
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-1)" }}>
                    {data.level.missing === null
                      ? "—"
                      : data.level.missing === 1
                        ? "1 clínica"
                        : `${data.level.missing} clínicas`}
                  </span>
                </div>
              </div>

              {data.level.legacy && (
                <p style={noteStyle}>
                  Los niveles están inactivos (corre{" "}
                  <span className="mono">sql/afiliados-ventas.sql</span>): se usa el % base del
                  afiliado.
                </p>
              )}
            </CardNew>
          </div>

          {/* 6 · Clínicas referidas */}
          <CardNew
            noPad
            title={`Clínicas referidas (${data.clinics.length})`}
            sub="Modalidad congelada al alta y comisión que ha generado cada una."
          >
            {data.clinics.length === 0 ? (
              <div
                style={{
                  padding: "40px 18px",
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 13,
                }}
              >
                Este afiliado aún no tiene clínicas referidas.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Clínica</th>
                      <th>Plan</th>
                      <th>Suscripción</th>
                      <th>Alta</th>
                      <th>Cobro</th>
                      <th>Modalidad</th>
                      <th>Comisión generada</th>
                      <th>Pago único</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clinics.map((c) => {
                      const sub = subStatusOf(c.subscriptionStatus);
                      return (
                        <tr key={c.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{c.name}</div>
                          </td>
                          <td style={{ fontSize: 12.5, color: "var(--text-2)" }}>{c.planLabel}</td>
                          <td>
                            <BadgeNew tone={sub.tone} dot>
                              {sub.label}
                            </BadgeNew>
                          </td>
                          <td className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                            {formatRelativeDate(c.createdAt)}
                          </td>
                          <td
                            className="mono"
                            style={{ fontSize: 12, color: "var(--text-2)" }}
                            title={`${c.invoiceCount} factura(s) de suscripción pagada(s)`}
                          >
                            {c.invoiceCount === 0 ? "Sin cobros" : `#${c.invoiceCount}`}
                          </td>
                          <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                            {c.payoutMode ? (
                              PAYOUT_MODE_LABELS[c.payoutMode]
                            ) : (
                              <span style={{ color: "var(--text-3)" }}>Sin congelar</span>
                            )}
                          </td>
                          <td
                            className="mono"
                            style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}
                          >
                            {formatCurrency(c.commissionMxn)}
                          </td>
                          <td>
                            {c.oneTimePaidAt ? (
                              <BadgeNew tone="success">
                                Único pagado · {formatDate(c.oneTimePaidAt)}
                              </BadgeNew>
                            ) : (
                              <span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardNew>

          {/* 7 · Historial de comisiones */}
          <CardNew
            noPad
            title={`Historial de comisiones (${visibleCommissions.length})`}
            sub="Una fila por factura pagada de una clínica referida."
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {COMMISSION_FILTERS.map((f) => {
                  const n =
                    f.key === "ALL"
                      ? commissions.length
                      : commissions.filter((c) => c.status === f.key).length;
                  return (
                    <ButtonNew
                      key={f.key}
                      size="sm"
                      variant={filter === f.key ? "primary" : "ghost"}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                      <span style={{ marginLeft: 6, opacity: 0.65 }}>{n}</span>
                    </ButtonNew>
                  );
                })}
              </div>
              <ButtonNew
                size="sm"
                variant="secondary"
                icon={<Download size={13} />}
                disabled={visibleCommissions.length === 0}
                onClick={exportCsv}
              >
                Exportar CSV
              </ButtonNew>
            </div>

            {visibleCommissions.length === 0 ? (
              <div
                style={{
                  padding: "40px 18px",
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 13,
                }}
              >
                {commissions.length === 0
                  ? "Este afiliado aún no ha generado comisiones."
                  : "No hay comisiones con este estado."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Factura</th>
                      <th>Fecha</th>
                      <th>Clínica</th>
                      <th>Tipo</th>
                      <th>Meses</th>
                      <th>Monto factura</th>
                      <th>Comisión</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCommissions.map((c) => (
                      <tr key={c.id}>
                        <td
                          className="mono"
                          style={{ fontSize: 11.5, color: "var(--text-2)" }}
                          title={c.stripeInvoiceId}
                        >
                          {c.stripeInvoiceId.length > 18
                            ? `${c.stripeInvoiceId.slice(0, 18)}…`
                            : c.stripeInvoiceId}
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                          {formatDate(c.createdAt)}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--text-1)" }}>{c.clinicName}</td>
                        <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {commissionKindLabel(c.kind)}
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {c.monthsCovered}
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {formatCurrency(c.amountMxn)}
                        </td>
                        <td
                          className="mono"
                          style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}
                        >
                          {formatCurrency(c.commissionMxn)}
                        </td>
                        <td>
                          <BadgeNew tone={c.status === "paid" ? "success" : "warning"}>
                            {c.status === "paid" ? "Pagada" : "Pendiente"}
                          </BadgeNew>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardNew>

          {/* 8 · Vendedores */}
          <CardNew
            noPad
            title={`Equipo de vendedores (${data.sellers.length})`}
            sub="Vendedores que refieren clínicas bajo este afiliado."
          >
            {data.sellers.length === 0 ? (
              <div
                style={{
                  padding: "32px 18px",
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 13,
                }}
              >
                Este afiliado aún no tiene vendedores en su equipo.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Email</th>
                      <th>Comisión</th>
                      <th>Clínicas</th>
                      <th>Pendiente</th>
                      <th>Pagado</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sellers.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{s.name}</td>
                        <td style={{ fontSize: 12.5, color: "var(--text-2)" }}>{s.email}</td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {s.commissionPct}%
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {s.clinics}
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--warning)" }}>
                          {formatCurrency(s.pendingMxn)}
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {formatCurrency(s.paidMxn)}
                        </td>
                        <td>
                          <BadgeNew tone={s.isActive ? "success" : "neutral"} dot>
                            {s.isActive ? "Activo" : "Inactivo"}
                          </BadgeNew>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardNew>
        </div>
      )}
    </div>
  );
}
