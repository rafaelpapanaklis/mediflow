"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Users, CheckCircle, Clock, XCircle } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { formatRelativeDate } from "@/lib/format";

interface Row {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  completedSteps: number;
  totalSteps: number;
  stuckOn: string | null;
  daysSinceSignup: number;
}

interface Step { id: string; label: string }

type Filter = "all" | "completed" | "in_progress" | "not_started";

function toneFromProgress(completed: number, total: number): "success" | "warning" | "danger" | "neutral" {
  if (completed === total) return "success";
  if (completed === 0)     return "danger";
  return "warning";
}

export function OnboardingClient({ rows, steps }: { rows: Row[]; steps: Step[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filter === "completed"   && r.completedSteps !== r.totalSteps) return false;
      if (filter === "in_progress" && (r.completedSteps === 0 || r.completedSteps === r.totalSteps)) return false;
      if (filter === "not_started" && r.completedSteps !== 0) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const stats = useMemo(() => {
    const completed   = rows.filter(r => r.completedSteps === r.totalSteps).length;
    const notStarted  = rows.filter(r => r.completedSteps === 0).length;
    const inProgress  = rows.length - completed - notStarted;
    return { completed, inProgress, notStarted };
  }, [rows]);

  const filters: { k: Filter; l: string; count: number }[] = [
    { k: "all",         l: "Todos",        count: rows.length },
    { k: "completed",   l: "Completados",  count: stats.completed },
    { k: "in_progress", l: "En progreso",  count: stats.inProgress },
    { k: "not_started", l: "Sin empezar",  count: stats.notStarted },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Dashboard de onboarding
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Progreso de configuración inicial por clínica. Detecta dónde se atoran los nuevos usuarios.
        </p>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Total clínicas"  value={String(rows.length)}       icon={Users} />
        <KpiCard label="Completadas"     value={String(stats.completed)}   icon={CheckCircle}
          delta={{ value: `${rows.length ? Math.round((stats.completed / rows.length) * 100) : 0}% del total`, direction: "up" }} />
        <KpiCard label="En progreso"     value={String(stats.inProgress)}  icon={Clock} />
        <KpiCard label="Sin empezar"     value={String(stats.notStarted)}  icon={XCircle}
          delta={{ value: "Abandonadas", direction: "down" }} />
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
            placeholder="Buscar clínica…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
          {filters.map(f => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              className={`segment-new__btn ${filter === f.k ? "segment-new__btn--active" : ""}`}
            >
              {f.l}
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid of clinic cards */}
      {filtered.length === 0 ? (
        <CardNew>
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Sin resultados
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {filtered.map(r => {
            const pct     = Math.round((r.completedSteps / r.totalSteps) * 100);
            const tone    = toneFromProgress(r.completedSteps, r.totalSteps);
            const isStale = r.daysSinceSignup > 7 && r.completedSteps < r.totalSteps;
            const barColor =
              pct === 100 ? "var(--success)" :
              pct === 0   ? "var(--danger)"  : "var(--warning)";

            return (
              <CardNew key={r.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <AvatarNew name={r.name} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link
                      href={`/admin/clinics/${r.id}`}
                      style={{ fontSize: 13, fontWeight: 600, color: "#c4b5fd", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {r.name}
                    </Link>
                    {r.email && (
                      <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.email}
                      </div>
                    )}
                  </div>
                  <BadgeNew tone={tone}>{r.completedSteps}/{r.totalSteps}</BadgeNew>
                </div>

                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: barColor, transition: "width 0.3s" }} />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                  <span>
                    Paso: <span style={{ color: "var(--text-1)" }}>{r.stuckOn ?? "Completado"}</span>
                  </span>
                  <span className="mono">{formatRelativeDate(r.createdAt)}</span>
                </div>

                {isStale && (
                  <div style={{ fontSize: 10, color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>
                    {r.daysSinceSignup} días sin avanzar
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {r.email ? (
                    <a
                      href={`mailto:${r.email}?subject=Tu%20onboarding%20en%20MediFlow&body=Hola,%20notamos%20que%20no%20has%20completado%20la%20configuración%20inicial.%20¿Podemos%20ayudarte?`}
                      style={{ flex: 1, textDecoration: "none" }}
                    >
                      <ButtonNew size="sm" variant="secondary" style={{ width: "100%" }}>
                        Contactar
                      </ButtonNew>
                    </a>
                  ) : (
                    <ButtonNew size="sm" variant="secondary" disabled style={{ flex: 1 }}>
                      Contactar
                    </ButtonNew>
                  )}
                  <Link href={`/admin/clinics/${r.id}`} style={{ flex: 1, textDecoration: "none" }}>
                    <ButtonNew size="sm" variant="ghost" style={{ width: "100%" }}>
                      Ver
                    </ButtonNew>
                  </Link>
                </div>
              </CardNew>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 20 }}>
        Pasos tracked: {steps.map(s => s.label).join(" · ")}
      </div>
    </div>
  );
}
