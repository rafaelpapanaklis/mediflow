"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Clock, CheckCircle2, XCircle, Ban } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { formatRelativeDate } from "@/lib/format";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar");
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
