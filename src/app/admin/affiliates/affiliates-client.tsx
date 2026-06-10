"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Clock, CheckCircle2, XCircle, Ban,
  MousePointerClick, Wallet, DollarSign, TrendingUp,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { formatRelativeDate } from "@/lib/format";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
// Type-only: se borra al compilar (mismo patrón que SearchablePatient).
import type { AdminAffiliateMetricsResponse } from "@/app/api/admin/affiliates/metrics/route";

type AffiliateStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
type AssignableStatus = "APPROVED" | "REJECTED" | "SUSPENDED";
type FilterKey = "ALL" | AffiliateStatus;

type AffiliateRow = {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: AffiliateStatus;
  referralCode: string;
  commissionPct: number;
  payoutMethod: string | null;
  createdAt: string | Date;
  approvedAt: string | Date | null;
  _count?: { clinics: number };
};

const STATUS_LABELS: Record<AffiliateStatus, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

const STATUS_TONE: Record<AffiliateStatus, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "neutral",
};

// Orden de revisión: lo accionable (PENDING) primero, lo resuelto al final.
const STATUS_ORDER: Record<AffiliateStatus, number> = {
  PENDING: 0,
  APPROVED: 1,
  SUSPENDED: 2,
  REJECTED: 3,
};

// Transiciones ofrecidas desde cada estado.
const ACTIONS: Record<AffiliateStatus, AssignableStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED"],
  REJECTED: ["APPROVED"],
  SUSPENDED: ["APPROVED"],
};

const ACTION_CONFIG: Record<
  AssignableStatus,
  {
    label: string;
    btn: "primary" | "secondary" | "danger";
    confirmVariant: "default" | "warning" | "danger";
    title: string;
    description: string;
  }
> = {
  APPROVED: {
    label: "Aprobar",
    btn: "primary",
    confirmVariant: "default",
    title: "¿Aprobar afiliado?",
    description:
      "Podrá compartir su enlace de referido y ganará comisión recurrente por cada clínica que se suscriba.",
  },
  REJECTED: {
    label: "Rechazar",
    btn: "danger",
    confirmVariant: "danger",
    title: "¿Rechazar afiliado?",
    description: "No tendrá acceso al panel de afiliados. Puedes reactivarlo después con Aprobar.",
  },
  SUSPENDED: {
    label: "Suspender",
    btn: "secondary",
    confirmVariant: "warning",
    title: "¿Suspender afiliado?",
    description: "Perderá el acceso al panel temporalmente. Podrás reactivarlo después con Aprobar.",
  },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "PENDING", label: "En revisión" },
  { key: "APPROVED", label: "Aprobados" },
  { key: "SUSPENDED", label: "Suspendidos" },
  { key: "REJECTED", label: "Rechazados" },
];

export function AffiliatesClient({ initial }: { initial: AffiliateRow[] }) {
  const askConfirm = useConfirm();
  const [list, setList] = useState<AffiliateRow[]>(initial);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Métricas del programa (A7)
  const [metrics, setMetrics] = useState<AdminAffiliateMetricsResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState(false);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(false);
    try {
      const res = await fetch("/api/admin/affiliates/metrics");
      if (!res.ok) throw new Error();
      setMetrics(await res.json());
    } catch {
      setMetricsError(true);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const counts = useMemo(() => {
    const c: Record<AffiliateStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
    for (const a of list) c[a.status]++;
    return c;
  }, [list]);

  const visible = useMemo(() => {
    const rows = filter === "ALL" ? list : list.filter((a) => a.status === filter);
    return [...rows].sort((a, b) => {
      if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [list, filter]);

  async function applyStatus(affiliate: AffiliateRow, target: AssignableStatus) {
    const cfg = ACTION_CONFIG[target];
    const ok = await askConfirm({
      title: cfg.title,
      description: cfg.description,
      variant: cfg.confirmVariant,
      confirmText: cfg.label,
    });
    if (!ok) return;

    setBusyId(affiliate.id);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo actualizar");
      }
      const updated = await res.json();
      // El PATCH no devuelve _count; conservamos el de la fila previa.
      setList((prev) =>
        prev.map((x) => (x.id === affiliate.id ? { ...x, ...updated, _count: x._count } : x))
      );
      toast.success(`Afiliado ${STATUS_LABELS[target].toLowerCase()}`);
      // El estado afecta aprobados/inactivos de la sección de métricas.
      void loadMetrics();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar");
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(affiliate: AffiliateRow) {
    const ok = await askConfirm({
      title: "¿Marcar comisiones como pagadas?",
      description: `Todas las comisiones pendientes de ${affiliate.name} se marcarán como pagadas y se notificará al afiliado por email.`,
      variant: "warning",
      confirmText: "Marcar pagadas",
    });
    if (!ok) return;

    setBusyId(affiliate.id);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliate.id}/payouts`, { method: "POST" });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error ?? "No se pudo registrar el pago");
      const paid: number = data?.paid ?? 0;
      if (paid === 0) {
        toast.success("Sin comisiones pendientes");
      } else {
        const monto = formatCurrency(data?.totalMxn ?? 0);
        toast.success(
          paid === 1
            ? `Se liquidó 1 comisión por ${monto}`
            : `Se liquidaron ${paid} comisiones por ${monto}`
        );
      }
      void loadMetrics();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo registrar el pago");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Afiliados
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Revisa las solicitudes del programa de referidos y aprueba, rechaza o suspende cada afiliado.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard
          label="En revisión"
          value={String(counts.PENDING)}
          icon={Clock}
          delta={{ value: `${list.length} en total`, direction: counts.PENDING > 0 ? "up" : "down" }}
        />
        <KpiCard
          label="Aprobados"
          value={String(counts.APPROVED)}
          icon={CheckCircle2}
          delta={{ value: "Activos en el programa", direction: "up" }}
        />
        <KpiCard
          label="Suspendidos"
          value={String(counts.SUSPENDED)}
          icon={Ban}
          delta={{ value: "Sin acceso temporal", direction: "down" }}
        />
        <KpiCard
          label="Rechazados"
          value={String(counts.REJECTED)}
          icon={XCircle}
          delta={{ value: "No aprobados", direction: "down" }}
        />
      </div>

      {/* Métricas del programa */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0, letterSpacing: "-0.01em" }}>
            Métricas del programa
          </h2>
          <p style={{ color: "var(--text-3)", fontSize: 12.5, margin: "3px 0 0" }}>
            Funnel global, comisiones y actividad reciente de los afiliados.
          </p>
        </div>

        {metricsError && !metrics ? (
          <CardNew>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>No se pudieron cargar las métricas.</span>
              <ButtonNew size="sm" variant="secondary" disabled={metricsLoading} onClick={() => void loadMetrics()}>
                Reintentar
              </ButtonNew>
            </div>
          </CardNew>
        ) : !metrics ? (
          <CardNew>
            <div style={{ fontSize: 13, color: "var(--text-3)", padding: "4px 0" }}>Cargando métricas…</div>
          </CardNew>
        ) : (
          <>
            {/* KPIs del programa */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 14 }}>
              <KpiCard
                label="Clicks (30 días)"
                value={String(metrics.program.clicks30d)}
                icon={MousePointerClick}
              />
              <div className="kpi">
                <div className="kpi__top">
                  <span className="kpi__label">Funnel global</span>
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={`${metrics.program.funnel.clicks} clicks → ${metrics.program.funnel.signups} registros → ${metrics.program.funnel.active} activas → ${metrics.program.funnel.paying} pagando`}
                >
                  {metrics.program.funnel.clicks} → {metrics.program.funnel.signups} → {metrics.program.funnel.active} → {metrics.program.funnel.paying}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
                  clicks → registros → activas → pagando
                </div>
              </div>
              <KpiCard
                label="Comisiones pendientes"
                value={formatCurrency(metrics.program.commissionsPendingMxn)}
                icon={Wallet}
              />
              <KpiCard
                label="Comisiones pagadas"
                value={formatCurrency(metrics.program.commissionsPaidMxn)}
                icon={CheckCircle2}
              />
              <KpiCard
                label="Revenue traído"
                value={formatCurrency(metrics.program.revenueBroughtMxn)}
                icon={DollarSign}
              />
              <KpiCard
                label="MRR referido"
                value={formatCurrency(metrics.program.mrrReferredMxn)}
                icon={TrendingUp}
              />
            </div>

            {/* Top afiliados + inactivos */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 430px), 1fr))", gap: 14 }}>
              <CardNew noPad title="Top afiliados" sub="Por clínicas pagando y conversión">
                {metrics.top.length === 0 ? (
                  <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    Aún no hay actividad de afiliados.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>Afiliado</th>
                          <th>Clicks</th>
                          <th>Registros</th>
                          <th>Pagando</th>
                          <th>Conversión</th>
                          <th>Pendiente</th>
                          <th>Pagado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.top.map((r) => (
                          <tr key={r.affiliateId}>
                            <td>
                              <div style={{ fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap" }}>{r.name}</div>
                              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>/socio/{r.slug}</div>
                            </td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>{r.clicks}</td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>{r.signups}</td>
                            <td className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>{r.paying}</td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>
                              {r.convPct === null ? "—" : `${r.convPct}%`}
                            </td>
                            <td className="mono" style={{ color: "var(--warning)" }}>{formatCurrency(r.pendingMxn)}</td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>{formatCurrency(r.paidMxn)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardNew>

              <CardNew title="Inactivos (sin clicks en 30 días)">
                {metrics.inactive.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>
                    Todos los afiliados aprobados tuvieron actividad reciente. 🎉
                  </div>
                ) : (
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {metrics.inactive.map((r) => (
                      <div key={r.affiliateId} className="list-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.email}
                          </div>
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                          último click: {r.lastClickAt ? formatDate(r.lastClickAt) : "nunca"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardNew>
            </div>
          </>
        )}
      </div>

      {/* Filtros por estado */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === "ALL" ? list.length : counts[f.key];
          return (
            <ButtonNew key={f.key} size="sm" variant={active ? "primary" : "ghost"} onClick={() => setFilter(f.key)}>
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.65 }}>{n}</span>
            </ButtonNew>
          );
        })}
      </div>

      {/* Tabla */}
      <CardNew noPad title={`Afiliados (${visible.length})`}>
        {visible.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {filter === "ALL" ? "Aún no hay afiliados registrados." : "No hay afiliados con este estado."}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Afiliado</th>
                <th>Contacto</th>
                <th>Código</th>
                <th>Comisión</th>
                <th>Clínicas</th>
                <th>Registrado</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const busy = busyId === a.id;
                const referred = a._count?.clinics ?? 0;
                return (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{a.name}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>/socio/{a.slug}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: "var(--text-2)" }}>{a.email}</div>
                      {a.payoutMethod && (
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>Pago: {a.payoutMethod}</div>
                      )}
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>
                        {a.referralCode}
                      </span>
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{a.commissionPct}%</td>
                    <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{referred}</td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>
                      {formatRelativeDate(a.createdAt)}
                    </td>
                    <td>
                      <BadgeNew tone={STATUS_TONE[a.status]} dot>
                        {STATUS_LABELS[a.status]}
                      </BadgeNew>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {ACTIONS[a.status].map((target) => {
                          const cfg = ACTION_CONFIG[target];
                          return (
                            <ButtonNew
                              key={target}
                              size="sm"
                              variant={cfg.btn}
                              disabled={busy}
                              onClick={() => applyStatus(a, target)}
                            >
                              {cfg.label}
                            </ButtonNew>
                          );
                        })}
                        <ButtonNew size="sm" variant="ghost" disabled={busy} onClick={() => markPaid(a)}>
                          Marcar pagadas
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardNew>
    </div>
  );
}
