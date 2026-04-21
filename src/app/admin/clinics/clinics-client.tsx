"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, DollarSign, Activity, Clock, XCircle, Download } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";

const PLAN_PRICES: Record<string, number> = { BASIC: 49, PRO: 99, CLINIC: 249 };

interface Props { clinics: any[] }

export function AdminClinicsClient({ clinics: initial }: Props) {
  const router = useRouter();
  const [clinics, setClinics] = useState(initial);
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("all");
  const [loading, setLoading] = useState<string | null>(null);

  const counts = useMemo(() => {
    const now = Date.now();
    const active  = clinics.filter(c => !c.trialEndsAt || new Date(c.trialEndsAt).getTime() >= now).length;
    const trial   = clinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt).getTime() > now).length;
    const expired = clinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt).getTime() < now).length;
    const mrr     = clinics.reduce((s, c) => s + (PLAN_PRICES[c.plan] ?? 0), 0);
    return { all: clinics.length, active, trial, expired, mrr };
  }, [clinics]);

  const filtered = clinics.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = c.name.toLowerCase().includes(q) || c.slug.includes(q) || c.users[0]?.email?.toLowerCase().includes(q);
    const expired = c.trialEndsAt && new Date(c.trialEndsAt) < new Date();
    if (filter === "active")  return matchSearch && !expired;
    if (filter === "expired") return matchSearch && expired;
    if (filter === "trial")   return matchSearch && c.trialEndsAt && new Date(c.trialEndsAt) > new Date();
    return matchSearch;
  });

  async function updatePlan(clinicId: string, plan: string) {
    setLoading(clinicId);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error();
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, plan } : c));
      toast.success("Plan actualizado");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setLoading(null);
    }
  }

  async function extendTrial(clinicId: string, days: number) {
    setLoading(clinicId);
    try {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + days);
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: trialEndsAt.toISOString() }),
      });
      if (!res.ok) throw new Error();
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, trialEndsAt: trialEndsAt.toISOString() } : c));
      toast.success(`Trial extendido ${days} días`);
    } catch {
      toast.error("Error");
    } finally {
      setLoading(null);
    }
  }

  async function suspendClinic(clinicId: string) {
    if (!confirm("¿Suspender esta clínica?")) return;
    setLoading(clinicId);
    try {
      const past = new Date("2000-01-01");
      await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: past.toISOString() }),
      });
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, trialEndsAt: past.toISOString() } : c));
      toast.success("Clínica suspendida");
    } catch {
      toast.error("Error");
    } finally {
      setLoading(null);
    }
  }

  const filters = [
    { id: "all",     label: "Todas",     count: counts.all },
    { id: "active",  label: "Activas",   count: counts.active },
    { id: "trial",   label: "En trial",  count: counts.trial },
    { id: "expired", label: "Expiradas", count: counts.expired },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Clínicas
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            {clinics.length} clínicas registradas en el sistema
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Activas" value={String(counts.active)} icon={Activity}
          delta={{ value: `${counts.all ? Math.round((counts.active / counts.all) * 100) : 0}% del total`, direction: "up" }} />
        <KpiCard label="En trial" value={String(counts.trial)} icon={Clock}
          delta={{ value: "Periodo de prueba", direction: "up" }} />
        <KpiCard label="Expiradas" value={String(counts.expired)} icon={XCircle}
          delta={{ value: "No convertidas", direction: "down" }} />
        <KpiCard label="MRR total" value={formatCurrency(counts.mrr, "MXN")} icon={DollarSign}
          delta={{ value: `${counts.all} clínicas`, direction: "up" }} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field" style={{ position: "relative", flex: "1 1 280px", maxWidth: 360 }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", pointerEvents: "none" }}
          />
          <input
            className="input-new"
            style={{ paddingLeft: 34 }}
            placeholder="Buscar por nombre, slug, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`segment-new__btn ${filter === f.id ? "segment-new__btn--active" : ""}`}
            >
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <CardNew noPad>
        <table className="table-new">
          <thead>
            <tr>
              <th>Clínica</th>
              <th>Plan</th>
              <th>Contacto</th>
              <th>Pacientes</th>
              <th>Tokens IA</th>
              <th>Estado</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(clinic => {
              const expired   = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
              const trialDays = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
              const owner     = clinic.users[0];
              const isLoading = loading === clinic.id;
              const used      = clinic.aiTokensUsed ?? 0;
              const limit     = clinic.aiTokensLimit ?? 50000;
              const pct       = limit > 0 ? Math.round((used / limit) * 100) : 0;
              const tokenColor = pct > 90 ? "var(--danger)" : pct > 70 ? "var(--warning)" : "var(--success)";

              return (
                <tr key={clinic.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AvatarNew name={clinic.name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <Link
                          href={`/admin/clinics/${clinic.id}`}
                          style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none", display: "block" }}
                        >
                          {clinic.name}
                        </Link>
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {clinic.slug}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {clinic.specialty} · {clinic.country}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <BadgeNew tone={clinic.plan === "CLINIC" ? "brand" : clinic.plan === "PRO" ? "info" : "neutral"}>
                      {clinic.plan}
                    </BadgeNew>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                      {formatCurrency(PLAN_PRICES[clinic.plan] ?? 0, "MXN")}/mes
                    </div>
                    <select
                      value={clinic.plan}
                      onChange={e => updatePlan(clinic.id, e.target.value)}
                      disabled={isLoading}
                      className="input-new"
                      style={{ marginTop: 6, fontSize: 11, padding: "4px 6px", height: "auto" }}
                    >
                      <option value="BASIC">BASIC — $49/mes</option>
                      <option value="PRO">PRO — $99/mes</option>
                      <option value="CLINIC">CLINIC — $249/mes</option>
                    </select>
                  </td>
                  <td>
                    {owner ? (
                      <div>
                        <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {owner.firstName} {owner.lastName}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{owner.email}</div>
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                      {clinic._count.patients}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {clinic._count.appointments} citas
                    </div>
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {used.toLocaleString()}
                      <span style={{ color: "var(--text-3)" }}> / {limit.toLocaleString()}</span>
                    </div>
                    <div style={{ width: "100%", height: 4, background: "var(--bg-elev)", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(pct, 100)}%`,
                          background: tokenColor,
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                      {pct}% usado
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const subActive =
                        (clinic as any).subscriptionStatus === "active" ||
                        (clinic as any).subscriptionStatus === "paid";
                      if (subActive) {
                        return <BadgeNew tone="success" dot>Activa · mensual</BadgeNew>;
                      }
                      if (expired) {
                        return <BadgeNew tone="danger" dot>Trial expirado</BadgeNew>;
                      }
                      if (trialDays !== null && trialDays === 0) {
                        return <BadgeNew tone="danger" dot>Trial · expira hoy</BadgeNew>;
                      }
                      if (trialDays !== null && trialDays > 0) {
                        const tone = trialDays <= 3 ? "danger" : "warning";
                        return <BadgeNew tone={tone} dot>Trial · {trialDays}d restantes</BadgeNew>;
                      }
                      return <BadgeNew tone="neutral" dot>Sin trial</BadgeNew>;
                    })()}

                    {/* Cancelación solicitada */}
                    {(clinic as any).cancelRequested && (
                      <div style={{
                        marginTop: 4,
                        fontSize: 10,
                        color: "#fca5a5",
                        fontWeight: 500,
                      }}>
                        ⚠ Cancelación solicitada
                      </div>
                    )}

                    {/* Método de pago */}
                    {(clinic as any).paymentMethodCollected && (
                      <div style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: "var(--text-3)",
                      }}>
                        {(clinic as any).paymentMethodType === "card"
                          ? `💳 •••• ${(clinic as any).paymentMethodLast4 ?? "••••"}`
                          : (clinic as any).paymentMethodType === "paypal"
                            ? "💠 PayPal"
                            : "🏦 Transferencia"}
                      </div>
                    )}

                    <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                      {formatRelativeDate(clinic.createdAt)}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <ButtonNew
                        size="sm"
                        variant="secondary"
                        onClick={() => extendTrial(clinic.id, 30)}
                        disabled={isLoading}
                      >
                        +30 días
                      </ButtonNew>
                      <ButtonNew
                        size="sm"
                        variant="secondary"
                        onClick={() => extendTrial(clinic.id, 14)}
                        disabled={isLoading}
                      >
                        +14 días
                      </ButtonNew>
                      <ButtonNew
                        size="sm"
                        variant="ghost"
                        onClick={() => suspendClinic(clinic.id)}
                        disabled={isLoading}
                        style={{ color: "var(--danger)" }}
                      >
                        Suspender
                      </ButtonNew>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardNew>
    </div>
  );
}
