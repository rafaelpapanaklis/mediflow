"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, Building2, DollarSign, Search, Layers, TrendingUp,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import type { ClienteRow, ClienteAggStatus, ClienteTag } from "@/lib/admin/clientes";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const AGG_TONE: Record<ClienteAggStatus, Tone> = {
  activo: "success",
  trial: "info",
  mixto: "warning",
  churn: "danger",
};
const AGG_LABEL: Record<ClienteAggStatus, string> = {
  activo: "Activo",
  trial: "Trial",
  mixto: "Mixto",
  churn: "Churn",
};
const TAG_META: Record<ClienteTag, { label: string; tone: Tone }> = {
  vip: { label: "VIP", tone: "brand" },
  nuevo: { label: "Nuevo", tone: "info" },
  en_riesgo: { label: "En riesgo", tone: "danger" },
};
const PLAN_TONE: Record<string, Tone> = { CLINIC: "brand", PRO: "info", BASIC: "neutral" };

function healthColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning)";
  return "var(--danger)";
}

const ESTADOS: { id: string; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "activo", label: "Activos" },
  { id: "trial", label: "Trial" },
  { id: "mixto", label: "Mixtos" },
  { id: "churn", label: "Churn" },
];

export function ClientesClient({ clientes }: { clientes: ClienteRow[] }) {
  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState("all");
  const [plan, setPlan] = useState("all");
  const [soloMulti, setSoloMulti] = useState(false);
  const [mrrRange, setMrrRange] = useState("all");

  const kpis = useMemo(() => {
    const total = clientes.length;
    const multi = clientes.filter((c) => c.clinicsCount > 1).length;
    const mrr = clientes.reduce((s, c) => s + c.mrr, 0);
    const ticket = total > 0 ? mrr / total : 0;
    return { total, multi, mrr, ticket };
  }, [clientes]);

  const estadoCounts = useMemo(() => {
    const counts: Record<string, number> = { all: clientes.length, activo: 0, trial: 0, mixto: 0, churn: 0 };
    clientes.forEach((c) => { counts[c.aggStatus] = (counts[c.aggStatus] || 0) + 1; });
    return counts;
  }, [clientes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clientes.filter((c) => {
      if (q && !(c.ownerName.toLowerCase().includes(q) || c.ownerEmail.toLowerCase().includes(q))) return false;
      if (estado !== "all" && c.aggStatus !== estado) return false;
      if (plan !== "all" && c.plans.indexOf(plan) < 0) return false;
      if (soloMulti && c.clinicsCount < 2) return false;
      if (mrrRange === "paying" && c.mrr <= 0) return false;
      if (mrrRange === "689" && c.mrr < 689) return false;
      if (mrrRange === "1719" && c.mrr < 1719) return false;
      return true;
    });
  }, [clientes, search, estado, plan, soloMulti, mrrRange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Clientes
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: "4px 0 0" }}>
            Cada cliente es la cuenta dueña y agrupa todas sus clínicas y planes.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <KpiCard label="Clientes" value={String(kpis.total)} icon={Users}
          delta={{ value: `${kpis.multi} con varias clínicas`, direction: "up" }} />
        <KpiCard label="Multi-clínica" value={String(kpis.multi)} icon={Building2}
          delta={{ value: `${kpis.total ? Math.round((kpis.multi / kpis.total) * 100) : 0}% del total`, direction: "up" }} />
        <KpiCard label="MRR total" value={formatCurrency(kpis.mrr, "MXN")} icon={DollarSign}
          delta={{ value: "Suma de clínicas activas", direction: "up" }} />
        <KpiCard label="Ticket promedio" value={formatCurrency(Math.round(kpis.ticket), "MXN")} icon={TrendingUp}
          delta={{ value: "MRR por cliente", direction: "up" }} />
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input
            className="input-new"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            style={{ width: "100%", paddingLeft: 30 }}
          />
        </div>
        <div className="segment-new" style={{ display: "inline-flex", gap: 2, flexWrap: "wrap" }}>
          {ESTADOS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setEstado(f.id)}
              className={`segment-new__btn ${estado === f.id ? "segment-new__btn--active" : ""}`}
            >
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>{estadoCounts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <select className="input-new" value={plan} onChange={(e) => setPlan(e.target.value)} style={{ width: "auto" }}>
          <option value="all">Todos los planes</option>
          <option value="BASIC">BASIC</option>
          <option value="PRO">PRO</option>
          <option value="CLINIC">CLINIC</option>
        </select>
        <select className="input-new" value={mrrRange} onChange={(e) => setMrrRange(e.target.value)} style={{ width: "auto" }}>
          <option value="all">Cualquier MRR</option>
          <option value="paying">Pagando (&gt; $0)</option>
          <option value="689">≥ $689</option>
          <option value="1719">≥ $1,719</option>
        </select>
        <button
          type="button"
          onClick={() => setSoloMulti((v) => !v)}
          className={`segment-new__btn ${soloMulti ? "segment-new__btn--active" : ""}`}
          style={{ border: "1px solid var(--border-soft)", borderRadius: 8 }}
        >
          ≥ 2 clínicas
        </button>
      </div>

      {/* Tabla */}
      <CardNew noPad>
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Clínicas</th>
                <th>MRR</th>
                <th>Estado</th>
                <th>Health</th>
                <th>Pacientes</th>
                <th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.supabaseId}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AvatarNew name={c.ownerName} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <Link
                          href={`/admin/clientes/${c.supabaseId}`}
                          style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none", display: "block" }}
                        >
                          {c.ownerName}
                        </Link>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.ownerEmail}</div>
                        {c.affiliateName && (
                          <div style={{ fontSize: 10, color: "var(--text-4)" }}>vía {c.affiliateName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <BadgeNew tone={c.clinicsCount > 1 ? "brand" : "neutral"}>
                        {c.clinicsCount} {c.clinicsCount === 1 ? "clínica" : "clínicas"}
                      </BadgeNew>
                      {c.plans.map((p) => (
                        <BadgeNew key={p} tone={PLAN_TONE[p] ?? "neutral"}>{p}</BadgeNew>
                      ))}
                    </div>
                  </td>
                  <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                    {formatCurrency(c.mrr, "MXN")}
                  </td>
                  <td>
                    <BadgeNew tone={AGG_TONE[c.aggStatus]} dot>{AGG_LABEL[c.aggStatus]}</BadgeNew>
                    {c.tags.length > 0 && (
                      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                        {c.tags.map((t) => (
                          <BadgeNew key={t} tone={TAG_META[t].tone}>{TAG_META[t].label}</BadgeNew>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 48, height: 5, background: "var(--bg-elev-2)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${c.healthScore}%`, background: healthColor(c.healthScore), transition: "width 0.3s" }} />
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{c.healthScore}</span>
                    </div>
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>{c.totalPatients}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.totalAppointments} citas</div>
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {formatRelativeDate(c.createdAt)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    Sin clientes que coincidan con los filtros
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardNew>

      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-3)", fontSize: 12 }}>
        <Layers size={13} />
        {filtered.length} de {clientes.length} clientes
      </div>
    </div>
  );
}
