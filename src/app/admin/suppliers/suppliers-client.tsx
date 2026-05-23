"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Clock, CheckCircle2, XCircle, Ban } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { formatRelativeDate } from "@/lib/format";
import { useConfirm, useConfirmWithReason } from "@/components/ui/confirm-dialog";
import {
  type SupplierDTO,
  type SupplierStatus,
  SUPPLIER_STATUS_LABELS,
} from "@/lib/suppliers/types";

type AssignableStatus = "APPROVED" | "REJECTED" | "SUSPENDED";
type FilterKey = "ALL" | SupplierStatus;

const STATUS_TONE: Record<SupplierStatus, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "neutral",
};

// Orden de revisión: lo accionable (PENDING) primero, lo resuelto al final.
const STATUS_ORDER: Record<SupplierStatus, number> = {
  PENDING: 0,
  APPROVED: 1,
  SUSPENDED: 2,
  REJECTED: 3,
};

// Transiciones ofrecidas desde cada estado.
const ACTIONS: Record<SupplierStatus, AssignableStatus[]> = {
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
    withReason: boolean;
    title: string;
    description: string;
  }
> = {
  APPROVED: {
    label: "Aprobar",
    btn: "primary",
    confirmVariant: "default",
    withReason: false,
    title: "¿Aprobar proveedor?",
    description:
      "Podrá publicar productos y vender a las clínicas del marketplace de inmediato.",
  },
  REJECTED: {
    label: "Rechazar",
    btn: "danger",
    confirmVariant: "danger",
    withReason: true,
    title: "¿Rechazar proveedor?",
    description:
      "No aparecerá en el marketplace. Puedes anotar un motivo para tu registro.",
  },
  SUSPENDED: {
    label: "Suspender",
    btn: "secondary",
    confirmVariant: "warning",
    withReason: false,
    title: "¿Suspender proveedor?",
    description:
      "Se ocultará del marketplace temporalmente. Podrás reactivarlo después con Aprobar.",
  },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "PENDING", label: "En revisión" },
  { key: "APPROVED", label: "Aprobados" },
  { key: "SUSPENDED", label: "Suspendidos" },
  { key: "REJECTED", label: "Rechazados" },
];

export function SuppliersClient({ initial }: { initial: SupplierDTO[] }) {
  const askConfirm = useConfirm();
  const askConfirmWithReason = useConfirmWithReason();
  const [list, setList] = useState<SupplierDTO[]>(initial);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<SupplierStatus, number> = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      SUSPENDED: 0,
    };
    for (const s of list) c[s.status]++;
    return c;
  }, [list]);

  // Filtra por estado y ordena con los PENDING primero (luego por más reciente).
  const visible = useMemo(() => {
    const rows = filter === "ALL" ? list : list.filter((s) => s.status === filter);
    return [...rows].sort((a, b) => {
      if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [list, filter]);

  async function applyStatus(supplier: SupplierDTO, target: AssignableStatus) {
    const cfg = ACTION_CONFIG[target];

    let reason: string | undefined;
    if (cfg.withReason) {
      const r = await askConfirmWithReason({
        title: cfg.title,
        description: cfg.description,
        variant: cfg.confirmVariant,
        confirmText: cfg.label,
        reasonLabel: "Motivo (opcional)",
        reasonPlaceholder: "Ej. documentación incompleta, RFC inválido…",
      });
      if (!r.confirmed) return;
      reason = r.reason;
    } else {
      const ok = await askConfirm({
        title: cfg.title,
        description: cfg.description,
        variant: cfg.confirmVariant,
        confirmText: cfg.label,
      });
      if (!ok) return;
    }

    setBusyId(supplier.id);
    try {
      const res = await fetch(`/api/admin/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, rejectedReason: reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo actualizar");
      }
      const updated: SupplierDTO = await res.json();
      setList((prev) => prev.map((x) => (x.id === supplier.id ? updated : x)));
      toast.success(`Proveedor ${SUPPLIER_STATUS_LABELS[target].toLowerCase()}`);
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
          Proveedores
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Revisa las solicitudes del marketplace y aprueba, rechaza o suspende cada proveedor.
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
          delta={{ value: "Activos en el marketplace", direction: "up" }}
        />
        <KpiCard
          label="Suspendidos"
          value={String(counts.SUSPENDED)}
          icon={Ban}
          delta={{ value: "Ocultos temporalmente", direction: "down" }}
        />
        <KpiCard
          label="Rechazados"
          value={String(counts.REJECTED)}
          icon={XCircle}
          delta={{ value: "No publicados", direction: "down" }}
        />
      </div>

      {/* Filtros por estado */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === "ALL" ? list.length : counts[f.key];
          return (
            <ButtonNew
              key={f.key}
              size="sm"
              variant={active ? "primary" : "ghost"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.65 }}>{n}</span>
            </ButtonNew>
          );
        })}
      </div>

      {/* Tabla */}
      <CardNew noPad title={`Proveedores (${visible.length})`}>
        {visible.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {filter === "ALL" ? "Aún no hay proveedores registrados." : "No hay proveedores con este estado."}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Negocio</th>
                <th>Contacto</th>
                <th>Categorías</th>
                <th>Ubicación</th>
                <th>Registrado</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const cats = s.categories ?? [];
                const catLabel =
                  cats.length === 0
                    ? "—"
                    : cats.slice(0, 2).join(", ") + (cats.length > 2 ? ` +${cats.length - 2}` : "");
                const location = [s.city, s.state].filter(Boolean).join(", ") || "—";
                const busy = busyId === s.id;
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{s.businessName}</div>
                      {s.rfc && (
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{s.rfc}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: "var(--text-2)" }}>{s.email}</div>
                      {s.phone && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{s.phone}</div>}
                    </td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>{catLabel}</td>
                    <td style={{ color: "var(--text-3)", fontSize: 12 }}>{location}</td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>
                      {formatRelativeDate(s.createdAt)}
                    </td>
                    <td>
                      <BadgeNew tone={STATUS_TONE[s.status]} dot>
                        {SUPPLIER_STATUS_LABELS[s.status]}
                      </BadgeNew>
                      {s.status === "REJECTED" && s.rejectedReason && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, maxWidth: 220 }}>
                          {s.rejectedReason}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {ACTIONS[s.status].map((target) => {
                          const cfg = ACTION_CONFIG[target];
                          return (
                            <ButtonNew
                              key={target}
                              size="sm"
                              variant={cfg.btn}
                              disabled={busy}
                              onClick={() => applyStatus(s, target)}
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
