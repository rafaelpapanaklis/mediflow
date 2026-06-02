"use client";

import { useMemo, useState } from "react";
import { Plus, Search, FlaskConical, Layers, Trash2, Pencil, Eye, EyeOff, Clock, DollarSign, BadgeCheck } from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmtMXN, fmtMXNdec } from "@/lib/format";
import { DENTAL_LAB_SERVICES, type DentalLabServiceDTO } from "@/lib/laboratorios/types";
import { ServicioForm } from "./servicio-form";

type Tab = "todos" | "activos" | "inactivos";

const TABS: { id: Tab; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "activos", label: "Activos" },
  { id: "inactivos", label: "Inactivos" },
];

type FormState =
  | { mode: "create" }
  | { mode: "edit"; service: DentalLabServiceDTO }
  | null;

function serviceLabel(key: string): string {
  return DENTAL_LAB_SERVICES.find((s) => s.key === key)?.short ?? key;
}

function entregaLabel(s: DentalLabServiceDTO): string {
  if (s.daysMin != null && s.daysMax != null) {
    return s.daysMin === s.daysMax ? `${s.daysMin} días` : `${s.daysMin}–${s.daysMax} días`;
  }
  if (s.daysMax != null) return `≤ ${s.daysMax} días`;
  if (s.daysMin != null) return `≥ ${s.daysMin} días`;
  return "—";
}

export function ServiciosClient({ initialServices }: { initialServices: DentalLabServiceDTO[] }) {
  const askConfirm = useConfirm();
  const [services, setServices] = useState<DentalLabServiceDTO[]>(initialServices);
  const [tab, setTab] = useState<Tab>("todos");
  const [search, setSearch] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);

  const kpis = useMemo(() => {
    const activos = services.filter((s) => s.isActive).length;
    const avgPrice = services.length
      ? services.reduce((sum, s) => sum + s.priceFrom, 0) / services.length
      : 0;
    const withMax = services.filter((s) => s.daysMax != null);
    const avgDays = withMax.length
      ? Math.round(withMax.reduce((sum, s) => sum + (s.daysMax ?? 0), 0) / withMax.length)
      : null;
    return { total: services.length, activos, avgPrice, avgDays };
  }, [services]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services
      .filter((s) => tab === "todos" || (tab === "activos" ? s.isActive : !s.isActive))
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          serviceLabel(s.serviceKey).toLowerCase().includes(q),
      );
  }, [services, tab, search]);

  function handleSaved(svc: DentalLabServiceDTO, mode: "create" | "edit") {
    setServices((prev) =>
      mode === "create" ? [svc, ...prev] : prev.map((x) => (x.id === svc.id ? svc : x)),
    );
    setForm(null);
  }

  async function toggleActive(s: DentalLabServiceDTO) {
    setBusyIds((b) => new Set(b).add(s.id));
    try {
      const res = await fetch(`/api/laboratorios/services/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !s.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo actualizar el servicio.");
        return;
      }
      setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: !s.isActive } : x)));
      toast.success(!s.isActive ? "Servicio activado" : "Servicio desactivado");
    } finally {
      setBusyIds((b) => {
        const n = new Set(b);
        n.delete(s.id);
        return n;
      });
    }
  }

  async function remove(s: DentalLabServiceDTO) {
    const ok = await askConfirm({
      title: `¿Eliminar "${s.name}"?`,
      description: "El servicio se eliminará de tu catálogo. Esta acción no se puede deshacer.",
      variant: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;
    setBusyIds((b) => new Set(b).add(s.id));
    try {
      const res = await fetch(`/api/laboratorios/services/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error ?? "No se pudo eliminar el servicio.");
        return;
      }
      setServices((prev) => prev.filter((x) => x.id !== s.id));
      toast.success("Servicio eliminado");
    } finally {
      setBusyIds((b) => {
        const n = new Set(b);
        n.delete(s.id);
        return n;
      });
    }
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto", position: "relative" }}>
      {/* Glow violeta de fondo */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -40,
          left: -20,
          width: 360,
          height: 220,
          pointerEvents: "none",
          background: "radial-gradient(closest-side, rgba(124,58,237,0.16), transparent 70%)",
          filter: "blur(8px)",
          zIndex: 0,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 24,
          flexWrap: "wrap",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
              boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
            }}
          >
            <FlaskConical size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
              Servicios
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4 }}>
              {services.length === 0
                ? "Tu catálogo está vacío"
                : `${services.length} ${services.length === 1 ? "servicio" : "servicios"} en tu catálogo`}
            </p>
          </div>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setForm({ mode: "create" })}>
          Nuevo servicio
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 20,
          position: "relative",
          zIndex: 1,
        }}
      >
        <KpiCard label="Total servicios" value={String(kpis.total)} icon={Layers} />
        <KpiCard label="Activos" value={String(kpis.activos)} icon={BadgeCheck} />
        <KpiCard label="Precio promedio" value={fmtMXN(kpis.avgPrice)} icon={DollarSign} />
        <KpiCard label="Entrega promedio" value={kpis.avgDays != null ? `${kpis.avgDays} días` : "—"} icon={Clock} />
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center", position: "relative", zIndex: 1 }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o tipo de servicio…"
          />
        </div>
        <div className="segment-new">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`segment-new__btn ${tab === t.id ? "segment-new__btn--active" : ""}`}
              style={tab === t.id ? { color: "var(--violet-400)", fontWeight: 600 } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div style={{ position: "relative", zIndex: 1 }}>
      <CardNew noPad>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            zIndex: 1,
          }}
        />
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              <FlaskConical size={26} />
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
              {search
                ? "Sin resultados"
                : tab === "todos"
                  ? "Aún no tienes servicios"
                  : "Nada por aquí todavía"}
            </div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              {search
                ? "Prueba con otro nombre o tipo de servicio para encontrar lo que buscas."
                : tab === "todos"
                  ? "Crea tu primer servicio para empezar a recibir órdenes en tu catálogo."
                  : "No hay servicios en este estado por ahora."}
            </p>
            {services.length === 0 && (
              <div style={{ marginTop: 4 }}>
                <ButtonNew variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setForm({ mode: "create" })}>
                  Agregar primer servicio
                </ButtonNew>
              </div>
            )}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Precio desde</th>
                <th>Entrega</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const busy = busyIds.has(s.id);
                const hovered = hoverId === s.id;
                return (
                  <tr
                    key={s.id}
                    onMouseEnter={() => setHoverId(s.id)}
                    onMouseLeave={() => setHoverId((id) => (id === s.id ? null : id))}
                    style={{
                      background: hovered ? "var(--brand-soft)" : undefined,
                      boxShadow: hovered ? "inset 3px 0 0 var(--violet-400)" : "inset 3px 0 0 transparent",
                      transition: "background .14s ease, box-shadow .14s ease",
                    }}
                  >
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            background: "var(--brand-soft)",
                            border: "1px solid var(--border-brand)",
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          <FlaskConical size={16} style={{ color: "var(--violet-400)" }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <button
                            type="button"
                            onClick={() => setForm({ mode: "edit", service: s })}
                            style={{
                              fontWeight: 500,
                              color: "var(--text-1)",
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              textAlign: "left",
                              fontFamily: "inherit",
                              fontSize: 12,
                            }}
                            title="Editar servicio"
                          >
                            {s.name}
                          </button>
                          {s.description && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-3)",
                                maxWidth: 320,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {s.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 9px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--violet-400)",
                          background: "var(--brand-soft)",
                          border: "1px solid var(--border-brand)",
                        }}
                      >
                        <Layers size={11} />
                        {serviceLabel(s.serviceKey)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }} className="mono">
                      {fmtMXNdec(s.priceFrom)}
                      <span style={{ color: "var(--text-4)", fontSize: 11 }}> /{s.unit}</span>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
                        <Clock size={12} style={{ color: "var(--text-4)" }} />
                        {entregaLabel(s)}
                      </span>
                    </td>
                    <td>
                      <BadgeNew tone={s.isActive ? "success" : "neutral"} dot>
                        {s.isActive ? "Activo" : "Inactivo"}
                      </BadgeNew>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => setForm({ mode: "edit", service: s })}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          aria-label="Editar"
                          title="Editar"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleActive(s)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28 }}
                          aria-label={s.isActive ? "Desactivar" : "Activar"}
                          title={s.isActive ? "Desactivar" : "Activar"}
                        >
                          {s.isActive ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(s)}
                          className="btn-new btn-new--ghost btn-new--sm"
                          style={{ padding: 0, width: 28, color: "var(--danger)" }}
                          aria-label="Eliminar"
                          title="Eliminar"
                        >
                          <Trash2 size={12} />
                        </button>
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

      {form &&
        (form.mode === "edit" ? (
          <ServicioForm
            key={form.service.id}
            mode="edit"
            service={form.service}
            onClose={() => setForm(null)}
            onSaved={handleSaved}
          />
        ) : (
          <ServicioForm key="new" mode="create" onClose={() => setForm(null)} onSaved={handleSaved} />
        ))}
    </div>
  );
}
